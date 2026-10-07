/**
 * The reviewed overlay over the generated code — what the specification states only in prose or not at all:
 *
 * - the quote allow-list: only an operation that declares `dry_run` may be quoted (one that does not could run and
 *   bill), and a `dry_run` call answers with `PriceQuote` although no operation's response references it;
 * - the upload limits per operation and field, as the field descriptions state them (extracted by the generator;
 *   an unstated field takes the largest per-file limit the specification states anywhere);
 * - the semantic constraints: rules the API enforces that its schemas cannot express. Each is anchored to the phrase
 *   of the specification that states it; test/overlay.test.mjs checks the anchor both ways, so a provider change of
 *   that prose fails the suite instead of leaving a stale rule.
 */
import type { ZodType } from "zod/v4";
import type { FileFieldFacts } from "./facts.js";
import { generatedComponent, isExposable } from "./operations.js";
import type { Operation } from "./operations.js";

/** A request body's fields as the caller gave them, after the operation's generated schema accepted them. */
export type BodyFields = Readonly<Record<string, unknown>>;

/** A megabyte as the specification states limits ("max 10MB"): decimal, the smaller reading. */
export const MB = 1_000_000;
/** The per-file limit of a file field whose description states none: the largest one the specification states. */
export const UNSTATED_FILE_BYTES = 50 * MB;
/** This server's cap on a whole request when the specification states none for the operation (no v2 operation does):
 * the files are read into memory and sent in one body, so a request is bounded here, not by the machine's memory. */
export const UNSTATED_REQUEST_BYTES = 100 * MB;

export interface RequestLimit {
  readonly maxBytes: number;
  /** false when the specification states no cap for this operation and UNSTATED_REQUEST_BYTES applies. */
  readonly stated: boolean;
}

export function quoteAllowed(op: Operation): boolean {
  return isExposable(op) && op.dryRun;
}

/** Why an operation cannot be quoted, or null when it can. */
export function quoteRefusal(op: Operation): string | null {
  if (!isExposable(op)) return `${op.id} is not exposed (class ${op.class})`;
  if (!op.dryRun) {
    return `${op.id} does not declare dry_run: a quote request could run and bill it, so this server never sends one`;
  }
  return null;
}

const PRICE_QUOTE = generatedComponent("PriceQuote");

/** The schema the 200 body of a call must match: PriceQuote for a dry run, else the operation's response. */
export function responseSchemaFor(op: Operation, dryRun: boolean): ZodType | null {
  if (!dryRun) return op.schemas.response;
  if (PRICE_QUOTE === null) throw new Error("the generated code lacks PriceQuote: regenerate src/generated/");
  return PRICE_QUOTE;
}

export interface FileLimit {
  readonly field: string;
  readonly array: boolean;
  readonly maxItems: number | null;
  readonly maxBytes: number;
  /** false when the specification states no limit for this field and UNSTATED_FILE_BYTES applies. */
  readonly stated: boolean;
}

function fileLimit(field: FileFieldFacts): FileLimit {
  return {
    field: field.name,
    array: field.array,
    maxItems: field.maxItems,
    maxBytes: field.maxBytes ?? UNSTATED_FILE_BYTES,
    stated: field.maxBytes !== null,
  };
}

export function fileLimitsOf(op: Operation): readonly FileLimit[] {
  return op.facts.fileFields.map(fileLimit);
}

/** The whole-request cap: the specification's when it states one, else this server's. */
export function requestLimitOf(op: Operation): RequestLimit {
  const stated = op.facts.requestMaxBytes;
  return stated === null ? { maxBytes: UNSTATED_REQUEST_BYTES, stated: false } : { maxBytes: stated, stated: true };
}

/** Why an encoded request body may not be sent, or null: the whole body (fields, part headers and files) against the cap. */
export function requestBytesRefusal(op: Operation, bodyBytes: number): string | null {
  const limit = requestLimitOf(op);
  if (bodyBytes <= limit.maxBytes) return null;
  const source = limit.stated ? "the limit Ideogram states for this request" : "this server's cap for a request Ideogram states no limit for";
  return `the request body is ${(bodyBytes / MB).toFixed(1)} MB; ${op.id} takes at most ${(limit.maxBytes / MB).toFixed(0)} MB (${source})`;
}

export interface Constraint {
  readonly id: string;
  /** The operation ids the rule applies to. */
  readonly operations: ReadonlySet<string>;
  /** The request field whose description states the rule, and the phrase that states it. */
  readonly anchor: { readonly field: string; readonly phrase: RegExp };
  readonly text: string;
  /** true when the fields break the rule. */
  readonly violated: (fields: BodyFields) => boolean;
}

function given(fields: BodyFields, name: string): boolean {
  const value = fields[name];
  if (value === undefined || value === null) return false;
  return !Array.isArray(value) || value.length > 0;
}

function anyGiven(fields: BodyFields, names: readonly string[]): boolean {
  return names.some((name) => given(fields, name));
}

const STYLE_REFERENCES: readonly string[] = [
  "style_codes",
  "style_reference_images",
  "style_reference_asset_identifiers",
  "style_reference_collection_id",
];

export const CONSTRAINTS: readonly Constraint[] = [
  {
    id: "resolution-or-aspect-ratio",
    operations: new Set([
      "post_generate_image_v2_ideogram_v2",
      "post_generate_image_v2_ideogram_v2_a",
      "post_generate_image_v2_ideogram_v3",
      "post_generate_image_v2_ideogram_v3_character",
      "post_generate_image_v2_ideogram_v3_custom_model",
      "post_generate_image_v2_ideogram_v3_transparent",
      "post_generate_image_v2_p_image_ideogram",
      "post_remix_image_v2_ideogram_v3",
      "post_remix_image_v2_ideogram_v3_character",
      "post_remix_image_v2_ideogram_v3_custom_model",
      "post_generate_design_v3",
      "post_generate_graphic_v3",
      "post_v1_edit_image",
    ]),
    anchor: { field: "aspect_ratio", phrase: /Cannot be combined with `?resolution`?/ },
    text: "resolution and aspect_ratio cannot be combined; give one",
    violated: (f) => given(f, "resolution") && given(f, "aspect_ratio"),
  },
  {
    id: "image-or-asset",
    operations: new Set([
      "post_precise_edit_image_v2_ideogram45",
      "post_tool_remix",
      "post_remix_image_v2_ideogram_v3",
      "post_remix_image_v2_ideogram_v3_character",
      "post_remix_image_v2_ideogram_v3_custom_model",
      "post_remix_image_v2_ideogram_v4",
    ]),
    anchor: { field: "image_asset_identifier", phrase: /never both/ },
    text: "image and image_asset_identifier are alternatives; give one",
    violated: (f) => given(f, "image") && given(f, "image_asset_identifier"),
  },
  {
    id: "mask-needs-source-file",
    operations: new Set([
      "post_generate_image_v2_gpt_image25_flare",
      "post_generate_image_v2_gpt_image25_sunburst",
      "post_precise_edit_image_v2_ideogram45",
    ]),
    anchor: { field: "mask", phrase: /requires source `images`|Requires `image` as raw bytes/ },
    text: "mask needs the source image as a file in the same request (image / images)",
    violated: (f) => given(f, "mask") && !anyGiven(f, ["image", "images"]),
  },
  {
    id: "style-preset-alone",
    operations: new Set([
      "post_generate_image_v2_ideogram_v3",
      "post_generate_image_v2_ideogram_v3_custom_model",
      "post_inpaint_image_v2_ideogram_v3",
      "post_inpaint_image_v2_ideogram_v3_custom_model",
      "post_remix_image_v2_ideogram_v3",
      "post_remix_image_v2_ideogram_v3_custom_model",
    ]),
    anchor: { field: "style_preset", phrase: /Cannot be combined with style codes or style references/ },
    text: "style_preset cannot be combined with style codes or style references",
    violated: (f) => given(f, "style_preset") && anyGiven(f, STYLE_REFERENCES),
  },
  {
    id: "inpaint-source-and-mask",
    operations: new Set([
      "post_inpaint_image_v2_ideogram_v3",
      "post_inpaint_image_v2_ideogram_v3_character",
      "post_inpaint_image_v2_ideogram_v3_custom_model",
    ]),
    anchor: { field: "mask", phrase: /Black marks the region to repaint/ },
    text: "inpaint needs the source (image or image_asset_identifier) and the mask (mask or mask_asset_identifier)",
    violated: (f) => !anyGiven(f, ["image", "image_asset_identifier"]) || !anyGiven(f, ["mask", "mask_asset_identifier"]),
  },
  {
    id: "character-mask-needs-character",
    operations: new Set([
      "post_generate_image_v2_ideogram_v3_character",
      "post_inpaint_image_v2_ideogram_v3_character",
      "post_remix_image_v2_ideogram_v3_character",
    ]),
    anchor: { field: "character_reference_mask", phrase: /character/ },
    text: "character_reference_mask needs character_reference_images",
    violated: (f) => given(f, "character_reference_mask") && !given(f, "character_reference_images"),
  },
  {
    // Stated by the API at run time (400 "A character reference is required: provide a character_reference_collection_id,
    // character_reference_asset_identifiers, or character_reference_images"), not by the prose: the anchor only pins the
    // field's presence on the three character operations.
    id: "character-needs-reference",
    operations: new Set([
      "post_generate_image_v2_ideogram_v3_character",
      "post_inpaint_image_v2_ideogram_v3_character",
      "post_remix_image_v2_ideogram_v3_character",
    ]),
    anchor: { field: "character_reference_images", phrase: /character/ },
    text: "a character model needs a character reference: character_reference_images, character_reference_asset_identifiers or character_reference_collection_id",
    violated: (f) => !anyGiven(f, ["character_reference_images", "character_reference_asset_identifiers", "character_reference_collection_id"]),
  },
  {
    id: "source-size-needs-images",
    operations: new Set(["post_generate_image_v2_ideogram45"]),
    anchor: { field: "size", phrase: /"source" is rejected/ },
    text: 'size "source" needs source images (images or image_asset_identifiers)',
    violated: (f) => f.size === "source" && !anyGiven(f, ["images", "image_asset_identifiers"]),
  },
];

/** The sentences of every constraint the fields break for the operation; empty when none. */
export function constraintViolations(op: Operation, fields: BodyFields): string[] {
  return CONSTRAINTS.filter((c) => c.operations.has(op.id) && c.violated(fields)).map((c) => c.text);
}
