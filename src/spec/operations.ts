/**
 * Operation[]: every operation of the committed snapshot with its class, family, model, body media, async kind,
 * `dry_run` flag and generated zod schemas. Built once from the generated facts (`src/generated/operations.gen.ts`)
 * and the generated schemas (`src/generated/zod.gen.ts`) — never written by hand. An exposable /v2 operation whose
 * path no family rule recognises fails loudly when this module loads.
 */
import type { ZodType } from "zod/v4";
import { SPEC_DOCUMENT_SECURITY, SPEC_OPERATIONS } from "../generated/operations.gen.js";
import * as generated from "../generated/zod.gen.js";
import { classify, EXPOSABLE_CLASSES, operationKey } from "./classify.js";
import type { HttpMethod, OperationClass } from "./classify.js";
import type { BodyMedia, SpecOperationFacts } from "./facts.js";

export type Family =
  | "generate"
  | "precise_edit"
  | "inpaint"
  | "remix"
  | "reframe"
  | "upscale"
  | "replace_background"
  | "remove_background"
  | "remove_object"
  | "describe"
  | "layerize"
  | "video_text"
  | "video_image"
  | "video_reference"
  | "video_edit"
  | "tool"
  | "workflow"
  | "generation"
  | "account"
  | "training";

/** optional: the body takes `async`; only: the 200 is an acknowledgement (a generation id, no payload); none. */
export type AsyncKind = "optional" | "only" | "none";

/** The documentation index; the snapshot carries no per-operation documentation URL. */
export const DOCS_INDEX_URL = "https://developer.ideogram.ai/v2/llms.txt";

export interface OperationSchemas {
  readonly body: ZodType | null;
  readonly query: ZodType | null;
  readonly path: ZodType | null;
  readonly response: ZodType | null;
}

export interface Operation {
  readonly id: string;
  readonly key: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly class: OperationClass;
  /** null for an operation outside the exposable classes. */
  readonly family: Family | null;
  /** The model a /v2 model path names (its last segment); null for tools, workflows, v1 and account operations. */
  readonly model: string | null;
  /** The body this server sends: multipart when the operation takes it (files), else JSON, else none. */
  readonly body: BodyMedia | "none";
  readonly async: AsyncKind;
  readonly dryRun: boolean;
  /** Always null with the 2026-10-07 snapshot (no per-operation URL in it); see DOCS_INDEX_URL. */
  readonly docsUrl: string | null;
  readonly summary: string;
  readonly facts: SpecOperationFacts;
  readonly schemas: OperationSchemas;
}

interface FamilyMatch {
  readonly family: Family;
  readonly model: string | null;
}

const IMAGE_FAMILIES: Readonly<Record<string, Family>> = {
  generate: "generate",
  "precise-edit": "precise_edit",
  inpaint: "inpaint",
  remix: "remix",
  reframe: "reframe",
  upscale: "upscale",
  "replace-background": "replace_background",
  "remove-background": "remove_background",
  "remove-object": "remove_object",
  describe: "describe",
};

const VIDEO_SUFFIXES: readonly (readonly [string, Family])[] = [
  ["-text-to-video", "video_text"],
  ["-image-to-video", "video_image"],
  ["-reference-to-video", "video_reference"],
];

function imageFamily(segment: string, model: string): FamilyMatch | null {
  const family = IMAGE_FAMILIES[segment];
  return family === undefined ? null : { family, model };
}

function videoFamily(model: string): FamilyMatch | null {
  const hit = VIDEO_SUFFIXES.find(([suffix]) => model.endsWith(suffix));
  return hit === undefined ? null : { family: hit[1], model };
}

/** The /v2 path rules, first match wins. */
const V2_RULES: readonly (readonly [RegExp, (m: RegExpExecArray) => FamilyMatch | null])[] = [
  [/^\/v2\/image\/([a-z-]+)\/([a-z0-9-]+)$/, (m) => imageFamily(m[1], m[2])],
  [/^\/v2\/design\/layerize\/([a-z0-9-]+)$/, (m) => ({ family: "layerize", model: m[1] })],
  [/^\/v2\/video\/generate\/([a-z0-9-]+)$/, (m) => videoFamily(m[1])],
  [/^\/v2\/video\/edit\/([a-z0-9-]+)$/, (m) => ({ family: "video_edit", model: m[1] })],
  [/^\/v2\/tool\//, () => ({ family: "tool", model: null })],
  [/^\/v2\/workflow\//, () => ({ family: "workflow", model: null })],
  [/^\/v2\/generations\//, () => ({ family: "generation", model: null })],
  [/^\/v2\/(account|assets)\//, () => ({ family: "account", model: null })],
];

/** The v1_only capabilities by path, first match wins: what each one is the v1 form of. */
const V1_RULES: readonly (readonly [RegExp, Family])[] = [
  [/^\/(datasets|models)(\/|$)|\/train-model/, "training"],
  [/^\/v1\/\.well-known\//, "account"],
  [/^\/v1\/edit(-lite)?$/, "precise_edit"],
  [/\/layerize-logos$/, "layerize"],
  [/\/try-on$/, "workflow"],
  [/\/image-to-image$/, "remix"],
  [/\/(magic-prompt|snap-mask|provenance\/verify)$/, "tool"],
  [/\/(generate|generate-design|graphic)(\/stable)?$/, "generate"],
];

function v2Family(path: string): FamilyMatch | null {
  for (const [pattern, match] of V2_RULES) {
    const m = pattern.exec(path);
    if (m !== null) return match(m);
  }
  return null;
}

function v1Family(path: string): FamilyMatch | null {
  const hit = V1_RULES.find(([pattern]) => pattern.test(path));
  return hit === undefined ? null : { family: hit[1], model: null };
}

function familyOf(facts: SpecOperationFacts, cls: OperationClass): FamilyMatch | null {
  if (!EXPOSABLE_CLASSES.has(cls)) return null;
  const match = cls === "v1_only" ? v1Family(facts.path) : v2Family(facts.path);
  if (match === null) throw new Error(`no family rule recognises ${operationKey(facts)} (${cls})`);
  return match;
}

const PAYLOAD_KEYS: readonly string[] = ["data", "descriptions", "json_prompt", "api_keys", "invoices", "buckets", "assets"];

function asyncKindOf(facts: SpecOperationFacts): AsyncKind {
  if (facts.asyncField) return "optional";
  const props = facts.responseProperties;
  const acknowledgement = props.includes("generation_id") && !props.some((p) => PAYLOAD_KEYS.includes(p));
  return acknowledgement ? "only" : "none";
}

/** The generated schemas by lower-cased export name (the generator's names are a case transform of operationId). */
const GENERATED_BY_NAME: ReadonlyMap<string, ZodType> = new Map(
  Object.entries(generated).map(([name, schema]) => [name.toLowerCase(), schema as ZodType]),
);

/** The generated schema of one part of an operation, by the generator's naming rule (`z<OperationId><Part>`). */
export function generatedSchema(operationId: string, part: "body" | "query" | "path" | "response"): ZodType | null {
  return GENERATED_BY_NAME.get(`z${operationId.replaceAll("_", "")}${part}`.toLowerCase()) ?? null;
}

export function generatedComponent(name: string): ZodType | null {
  return GENERATED_BY_NAME.get(`z${name}`.toLowerCase()) ?? null;
}

function schemasOf(id: string): OperationSchemas {
  return {
    body: generatedSchema(id, "body"),
    query: generatedSchema(id, "query"),
    path: generatedSchema(id, "path"),
    response: generatedSchema(id, "response"),
  };
}

function buildOperation(facts: SpecOperationFacts): Operation {
  const cls = classify(facts, SPEC_DOCUMENT_SECURITY);
  const match = familyOf(facts, cls);
  const exposable = EXPOSABLE_CLASSES.has(cls);
  return Object.freeze({
    id: facts.id,
    key: operationKey(facts),
    method: facts.method,
    path: facts.path,
    class: cls,
    family: match?.family ?? null,
    model: match?.model ?? null,
    body: facts.bodies[0] ?? "none",
    async: asyncKindOf(facts),
    dryRun: facts.dryRun,
    docsUrl: null,
    summary: facts.summary,
    facts,
    schemas: exposable ? schemasOf(facts.id) : { body: null, query: null, path: null, response: null },
  });
}

/** Every operation of the snapshot, in the specification's order. */
export const OPERATIONS: readonly Operation[] = Object.freeze(SPEC_OPERATIONS.map(buildOperation));

const BY_ID: ReadonlyMap<string, Operation> = new Map(OPERATIONS.map((op) => [op.id, op]));

export function operationById(id: string): Operation | null {
  return BY_ID.get(id) ?? null;
}

export function isExposable(op: Operation): boolean {
  return EXPOSABLE_CLASSES.has(op.class);
}

/** The /v2 model operation of a family and model, or null. */
export function modelOperation(family: Family, model: string): Operation | null {
  return OPERATIONS.find((op) => op.family === family && op.model === model && op.path.startsWith("/v2/")) ?? null;
}
