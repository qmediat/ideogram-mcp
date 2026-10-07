/**
 * The facts `scripts/spec-generate.mjs` extracts from the specification for every operation, written to
 * `src/generated/operations.gen.ts`. Facts only — no judgement: the class, family, model and support of an operation
 * are derived from them by `src/spec/classify.ts` and `src/spec/operations.ts`.
 */
import type { HttpMethod, SecurityRequirement } from "./classify.js";

export type BodyMedia = "multipart" | "json";
export type ParameterLocation = "path" | "query" | "header";

export interface ParameterFacts {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly required: boolean;
  /** An array parameter, serialized as repeated `name=value` pairs (OpenAPI `form` style, `explode: true`). */
  readonly array: boolean;
}

export interface FileFieldFacts {
  readonly name: string;
  /** Several files under one field name. */
  readonly array: boolean;
  readonly maxItems: number | null;
  /** The per-file limit the field's description states, in bytes (MB read as MiB); null when it states none. */
  readonly maxBytes: number | null;
}

export interface SpecOperationFacts {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  /** The operation's own `security`; null when the document's default applies. */
  readonly security: readonly SecurityRequirement[] | null;
  readonly summary: string;
  readonly deprecated: boolean;
  readonly bodies: readonly BodyMedia[];
  readonly requiredBody: boolean;
  /** The request body's component: the multipart one when the operation takes multipart, else the JSON one. */
  readonly requestSchema: string | null;
  /** The component per media type: they differ for an operation whose multipart and JSON bodies differ. */
  readonly requestSchemas: { readonly multipart: string | null; readonly json: string | null };
  readonly responseSchema: string | null;
  /** The top-level property names of the 200 response schema. */
  readonly responseProperties: readonly string[];
  /** The operation declares the `dry_run` query parameter. */
  readonly dryRun: boolean;
  /** The request body takes `async`. */
  readonly asyncField: boolean;
  readonly parameters: readonly ParameterFacts[];
  readonly fileFields: readonly FileFieldFacts[];
  /** The whole-request cap a field description states, in bytes; null when none does. */
  readonly requestMaxBytes: number | null;
  /** Multipart fields the specification encodes as `application/json` parts. */
  readonly jsonParts: readonly string[];
}
