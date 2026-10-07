/**
 * One curated tool per family, with a `model` and the exact fields of that model. The per-model field sets are the
 * generated request schemas of the family's documented models (never written by hand), less the fields the tool
 * manages itself (RESERVED_FIELDS). The advertised schema is an object with `model` and `wait_s` whose `oneOf` holds
 * one variant per model; the MCP SDK passes the arguments through and `prepare` checks them, in this order: the 1.x
 * adapter, the model-field refusal (naming the models that take the field), the model's schema, the semantic
 * constraints, the uploads.
 */
import { z } from "zod/v4";
import type { ZodType } from "zod/v4";
import type { ApiRequest } from "../client.js";
import { WAIT_DEFAULT_S, WAIT_MAX_S } from "../lifecycle.js";
import { documentedModelsOf } from "../registry.js";
import { constraintViolations } from "../spec/overlay.js";
import { modelOperation } from "../spec/operations.js";
import type { Family, Operation } from "../spec/operations.js";
import { loadUploads } from "../uploads.js";
import type { FileRef } from "../uploads.js";
import { adaptFields, resolveModel } from "./compat.js";
import { CONTROL_FIELDS, FIELD_TEXT, RESERVED_FIELDS, WAIT_TEXT } from "./fields.js";

/** A tool's arguments as the MCP client sent them; `prepare` validates them against the chosen model. */
export type ToolArguments = Readonly<Record<string, unknown>>;

export interface FamilyToolSpec {
  readonly name: string;
  readonly family: Family;
  readonly defaultModel: string;
  readonly title: string;
  readonly description: string;
  /** Inputs a 1.x caller may still send that are not request fields (deprecated, mapped by the adapter). */
  readonly legacyInputs?: Readonly<Record<string, ZodType>>;
}

export interface ModelVariant {
  readonly model: string;
  readonly op: Operation;
  readonly fields: ReadonlySet<string>;
  readonly schema: z.ZodObject;
}

export interface PreparedCall {
  readonly req: ApiRequest;
  readonly notes: readonly string[];
  readonly waitS: number;
  readonly variant: ModelVariant;
}

function variantOf(family: Family, model: string): ModelVariant {
  const op = modelOperation(family, model);
  const body = op?.schemas.body;
  if (op === null || !(body instanceof z.ZodObject)) throw new Error(`${family}/${model} has no generated object body`);
  const shape = Object.fromEntries(Object.entries(body.shape).filter(([name]) => !RESERVED_FIELDS.has(name)));
  return { model, op, fields: new Set(Object.keys(shape)), schema: z.object(shape) };
}

const VARIANTS = new Map<string, readonly ModelVariant[]>();

/** The variants of every documented model of the tool's family, in the registry's order. */
export function variantsOf(spec: FamilyToolSpec): readonly ModelVariant[] {
  const cached = VARIANTS.get(spec.name);
  if (cached !== undefined) return cached;
  const variants = documentedModelsOf(spec.family).map((model) => variantOf(spec.family, model));
  if (!variants.some((v) => v.model === spec.defaultModel)) throw new Error(`${spec.name}: no model ${spec.defaultModel}`);
  VARIANTS.set(spec.name, variants);
  return variants;
}

type JsonObject = Record<string, unknown>;

/** `{allOf: [{$ref}]}` (zod's form of a reused schema in a property) is `{$ref}` when it has nothing beside it. */
function unwrapRef(schema: unknown): unknown {
  const s = schema as JsonObject;
  const allOf = s?.allOf as JsonObject[] | undefined;
  return Object.keys(s ?? {}).length === 1 && allOf?.length === 1 && typeof allOf[0].$ref === "string" ? allOf[0] : schema;
}

/** Moves every property schema that occurs in two or more variants into `definitions` (lossless; the advertised
 * schema's bytes are a cost every client pays — docs/DESIGN-ideogram-v2.md section 5). */
function hoistShared(variants: JsonObject[], definitions: JsonObject): void {
  const seen = new Map<string, number>();
  for (const v of variants) for (const p of Object.values(v.properties as JsonObject)) seen.set(JSON.stringify(p), (seen.get(JSON.stringify(p)) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const [text, count] of seen) {
    if (count < 2 || text.length < 24 || text.startsWith('{"$ref"')) continue;
    const name = `shared${names.size}`;
    names.set(text, name);
    definitions[name] = JSON.parse(text);
  }
  for (const v of variants) {
    const props = v.properties as JsonObject;
    for (const [key, p] of Object.entries(props)) {
      const name = names.get(JSON.stringify(p));
      if (name !== undefined) props[key] = { $ref: `#/definitions/${name}` };
    }
  }
}

function variantJsonSchemas(spec: FamilyToolSpec): { oneOf: unknown[]; definitions: unknown } {
  const variants = variantsOf(spec).map((v) => {
    const model = v.model === spec.defaultModel ? z.literal(v.model).optional() : z.literal(v.model);
    return z.object({ model, ...v.schema.shape });
  });
  const json = z.toJSONSchema(z.union(variants), { io: "input", reused: "ref", target: "draft-7", unrepresentable: "any" }) as {
    anyOf: JsonObject[];
    definitions?: JsonObject;
  };
  const definitions = json.definitions ?? {};
  for (const v of json.anyOf) {
    const props = v.properties as JsonObject;
    for (const key of Object.keys(props)) props[key] = unwrapRef(props[key]);
  }
  hoistShared(json.anyOf, definitions);
  return { oneOf: json.anyOf, definitions };
}

/** The schema tools/list advertises: `model`, `wait_s`, each described field once, and one exact variant per model. */
export function advertisedSchema(spec: FamilyToolSpec): z.ZodObject {
  const models = variantsOf(spec).map((v) => v.model);
  const used = new Set(variantsOf(spec).flatMap((v) => [...v.fields]));
  const described = Object.entries(FIELD_TEXT).filter(([name]) => used.has(name));
  return z
    .looseObject({
      model: z
        .string()
        .optional()
        .meta({ enum: models, description: `The model (default ${spec.defaultModel}); each takes the fields of its variant below` }),
      wait_s: z.number().int().min(0).max(WAIT_MAX_S).optional().describe(WAIT_TEXT),
      ...Object.fromEntries(described.map(([name, text]) => [name, z.unknown().optional().describe(text)])),
      ...spec.legacyInputs,
    })
    .meta(variantJsonSchemas(spec));
}

function refusalFor(spec: FamilyToolSpec, variant: ModelVariant, field: string): string {
  if (RESERVED_FIELDS.has(field)) {
    return field === "async" ? "`async` is managed by this tool: use wait_s" : `\`${field}\` is available through ideogram_api only`;
  }
  const takers = variantsOf(spec).filter((v) => v.fields.has(field)).map((v) => v.model);
  const who = takers.length === 0 ? `no ${spec.name} model takes it` : `the models that take it: ${takers.join(", ")}`;
  return `\`${field}\` is not a parameter of ${variant.model}; ${who}`;
}

function checkFields(spec: FamilyToolSpec, variant: ModelVariant, fields: Readonly<Record<string, unknown>>): void {
  const foreign = Object.keys(fields).filter((name) => fields[name] !== undefined && !variant.fields.has(name));
  if (foreign.length > 0) throw new Error(foreign.map((f) => refusalFor(spec, variant, f)).join("\n"));
  const parsed = variant.schema.safeParse(fields);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`);
    throw new Error(`${variant.model} refuses the input:\n${issues.join("\n")}`);
  }
  const violations = constraintViolations(variant.op, fields);
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

/** Moves the file fields' paths out of the body into file references. */
export function splitFiles(op: Operation, fields: Readonly<Record<string, unknown>>): { body: Record<string, unknown>; files: FileRef[] } {
  const fileFields = new Set(op.facts.fileFields.map((f) => f.name));
  const body: Record<string, unknown> = {};
  const files: FileRef[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!fileFields.has(name)) body[name] = value;
    else for (const path of Array.isArray(value) ? value : [value]) files.push({ field: name, path: String(path) });
  }
  return { body, files };
}

/** The request one operation call becomes: multipart when files go with it, else JSON when the operation takes it. */
export async function buildRequest(op: Operation, fields: Readonly<Record<string, unknown>>): Promise<ApiRequest> {
  const { body, files } = splitFiles(op, fields);
  const takesJson = op.facts.bodies.includes("json");
  if (files.length > 0 && !op.facts.bodies.includes("multipart")) throw new Error(`${op.id} takes no files`);
  const uploads = await loadUploads(op, files);
  const media = files.length === 0 && takesJson ? "json" : "multipart";
  return { op, path: {}, query: {}, headers: {}, body: { media, fields: body, files: uploads, jsonParts: op.facts.jsonParts }, dryRun: false };
}

const WaitInput = z.number().int().min(0).max(WAIT_MAX_S).optional();

/** Turns a curated tool's arguments into one checked request of the chosen model. */
export async function prepare(spec: FamilyToolSpec, args: ToolArguments): Promise<PreparedCall> {
  const resolved = resolveModel(spec.family, args, spec.defaultModel);
  const variant = variantsOf(spec).find((v) => v.model === resolved.model);
  if (variant === undefined) {
    throw new Error(`${spec.name} has no model ${resolved.model}; one of: ${variantsOf(spec).map((v) => v.model).join(", ")}`);
  }
  const wait = WaitInput.safeParse(args.wait_s);
  if (!wait.success) throw new Error(`wait_s must be a whole number of seconds from 0 to ${WAIT_MAX_S}`);
  const requestFields = Object.fromEntries(Object.entries(args).filter(([name]) => !CONTROL_FIELDS.has(name)));
  const adapted = adaptFields(requestFields, variant.fields);
  checkFields(spec, variant, adapted.fields);
  const req = await buildRequest(variant.op, adapted.fields);
  return { req, notes: [...resolved.notes, ...adapted.notes], waitS: wait.data ?? WAIT_DEFAULT_S, variant };
}
