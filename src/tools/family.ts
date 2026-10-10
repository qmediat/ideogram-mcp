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
import { constraintViolations, sourceRefusal } from "../spec/overlay.js";
import { bodySchemaFor, modelOperation } from "../spec/operations.js";
import type { Family, Operation } from "../spec/operations.js";
import { loadUploads } from "../uploads.js";
import type { FileRef } from "../uploads.js";
import { adaptFields, resolveModel } from "./compat.js";
import { CONTROL_FIELDS, FIELD_TEXT, PRIVATE_FIELD, RESERVED_FIELDS, WAIT_TEXT } from "./fields.js";

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

/** A definition this short costs more as a `$ref` (34 bytes) than inline: zod hoists every reused schema, a bare
 * `{"type":"string"}` included. Such definitions are put back in place (lossless). */
const INLINE_DEFINITION_BYTES = 34;

export function inlineSmallDefinitions(json: JsonObject): void {
  const definitions = json.definitions as JsonObject;
  const small = new Map<string, string>();
  for (const [name, def] of Object.entries(definitions)) {
    const text = JSON.stringify(def);
    if (text.length <= INLINE_DEFINITION_BYTES) small.set(`#/definitions/${name}`, text);
  }
  const walk = (node: unknown, expanding: ReadonlySet<string>): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item, expanding));
    if (node === null || typeof node !== "object") return node;
    const o = node as JsonObject;
    const ref = typeof o.$ref === "string" && Object.keys(o).length === 1 ? o.$ref : undefined;
    if (ref !== undefined && small.has(ref) && !expanding.has(ref)) {
      return walk(JSON.parse(small.get(ref) as string), new Set([...expanding, ref])); // an inlined definition may hold a $ref of its own; a cycle keeps the $ref
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v, expanding)]));
  };
  json.oneOf = walk(json.oneOf, new Set());
  for (const [name, def] of Object.entries(definitions)) definitions[name] = walk(def, new Set());
  // a definition is dropped only when nothing refers to it any more (a $ref beside other keys is left as it is)
  const remaining = new Set((JSON.stringify(json).match(/"#\/definitions\/[^"]+"/g) ?? []).map((ref) => JSON.parse(ref) as string));
  for (const ref of small.keys()) if (!remaining.has(ref)) delete definitions[ref.replace("#/definitions/", "")];
}

function variantJsonSchemas(spec: FamilyToolSpec): { oneOf: unknown[]; definitions: unknown } {
  const variants = variantsOf(spec).map((v) => {
    const model = v.model === spec.defaultModel ? z.literal(v.model).optional() : z.literal(v.model);
    return z.object({ model, ...v.schema.shape });
  });
  const json = z.toJSONSchema(z.union(variants), { io: "input", reused: "ref", target: "draft-7", unrepresentable: "any" }) as {
    anyOf?: JsonObject[];
    definitions?: JsonObject;
  };
  const definitions = json.definitions ?? {};
  if (!Array.isArray(json.anyOf)) throw new Error(`${spec.name}: the variants did not render as a union (${variants.length} model(s))`);
  for (const v of json.anyOf) {
    const props = v.properties as JsonObject;
    for (const key of Object.keys(props)) props[key] = unwrapRef(props[key]);
  }
  hoistShared(json.anyOf, definitions);
  const shaped: JsonObject = { oneOf: json.anyOf, definitions };
  inlineSmallDefinitions(shaped);
  return { oneOf: shaped.oneOf as unknown[], definitions: shaped.definitions };
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
    if (value === undefined) continue; // an absent optional (an in-process caller's; JSON cannot carry it)
    if (!fileFields.has(name)) body[name] = value;
    else for (const path of Array.isArray(value) ? value : [value]) files.push({ field: name, path: String(path) });
  }
  return { body, files };
}

/** The fields are checked against the schema of the format they are sent in (as `ideogram_api` checks them, the file
 * fields present as their paths): a call without a file goes as JSON, whose schema may require what the multipart one
 * leaves optional (remove background by JSON needs the asset). */
function checkMediaSchema(op: Operation, media: "json" | "multipart", fields: Readonly<Record<string, unknown>>): void {
  const schema = bodySchemaFor(op, media);
  if (schema === null) return;
  const parsed = schema.safeParse(fields);
  if (parsed.success) return;
  const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`);
  throw new Error(`${op.id} sent as ${media} refuses the input:\n${issues.join("\n")}`);
}

/** The request one operation call becomes: multipart when files go with it, else JSON when the operation takes it. */
export async function buildRequest(op: Operation, fields: Readonly<Record<string, unknown>>): Promise<ApiRequest> {
  const { body, files } = splitFiles(op, fields);
  const takesJson = op.facts.bodies.includes("json");
  if (files.length > 0 && !op.facts.bodies.includes("multipart")) throw new Error(`${op.id} takes no files`);
  const media = files.length === 0 && takesJson ? "json" : "multipart";
  checkMediaSchema(op, media, fields);
  const uploads = await loadUploads(op, files);
  return { op, path: {}, query: {}, headers: {}, body: { media, fields: body, files: uploads, jsonParts: op.facts.jsonParts }, dryRun: false };
}

const WaitInput = z.number().int().min(0).max(WAIT_MAX_S).optional();

/** The shared source rule (src/spec/overlay.ts), said with the tool's name: before the schema and before any request. */
function checkSource(spec: FamilyToolSpec, variant: ModelVariant, fields: Readonly<Record<string, unknown>>): void {
  const refusal = sourceRefusal(variant.op, fields);
  if (refusal !== null) throw new Error(refusal.replace(variant.op.id, spec.name));
}

/** `private: true` unless the caller set it, on a model that takes the field; a null is "not set" (the schemas accept
 * it, multipart would drop it and JSON would send it — either way the API's own default would apply). */
function withPrivateDefault(variant: ModelVariant, fields: Record<string, unknown>): Record<string, unknown> {
  if (!variant.fields.has(PRIVATE_FIELD) || (fields[PRIVATE_FIELD] !== undefined && fields[PRIVATE_FIELD] !== null)) return fields;
  return { ...fields, [PRIVATE_FIELD]: true };
}

/** Turns a curated tool's arguments into one checked request of the chosen model. */
export async function prepare(spec: FamilyToolSpec, args: ToolArguments): Promise<PreparedCall> {
  const resolved = resolveModel(spec.family, args, spec.defaultModel);
  const variant = variantsOf(spec).find((v) => v.model === resolved.model);
  if (variant === undefined) {
    throw new Error(`${spec.name} has no model ${resolved.model}; one of: ${variantsOf(spec).map((v) => v.model).join(", ")}`);
  }
  const wait = WaitInput.safeParse(args.wait_s);
  if (!wait.success) throw new Error(`wait_s must be a whole number of seconds from 0 to ${WAIT_MAX_S}`);
  const legacy = new Set(Object.keys(spec.legacyInputs ?? {})); // a legacy input of ANOTHER tool is a foreign field, refused by name
  const requestFields = Object.fromEntries(Object.entries(args).filter(([name]) => !CONTROL_FIELDS.has(name) && !legacy.has(name)));
  const adapted = adaptFields(requestFields, variant.fields);
  checkSource(spec, variant, adapted.fields);
  const fields = withPrivateDefault(variant, adapted.fields);
  checkFields(spec, variant, fields);
  const req = await buildRequest(variant.op, fields);
  return { req, notes: [...resolved.notes, ...adapted.notes], waitS: wait.data ?? WAIT_DEFAULT_S, variant };
}
