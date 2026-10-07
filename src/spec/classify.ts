/**
 * The ONE classification rule for the operations of the Ideogram specification. An operation's class follows from its
 * effective security and its capability, never from the age of its URL alone:
 *
 *   bearer_only  its effective security names BearerAuth alone — not reachable with an API key, never exposed
 *   internal     /manage/*, /mini-apps/*, /internal* — the web app's and the provider's own, never exposed
 *   documented   a /v2 path the docs index (developer.ideogram.ai/v2/llms.txt, read 2026-10-07) lists
 *   spec_only    any other /v2 path — reachable, undocumented; the raw call runs it only on explicit opt-in
 *   v1_only      a v1 or unversioned capability v2 lacks (training and its datasets/models, the v1 model variants…)
 *   legacy       every other v1 or unversioned path: v2 covers its capability — never exposed
 *
 * A /v2 path the index does not list defaults to spec_only, a v1 path not named below defaults to legacy: an operation
 * the provider adds is never exposed as documented without a reviewed change of these lists.
 *
 * This file imports nothing: the generator configuration loads it directly with Node's type stripping.
 */

export type OperationClass = "documented" | "spec_only" | "v1_only" | "legacy" | "internal" | "bearer_only";

export const OPERATION_CLASSES: readonly OperationClass[] = [
  "documented",
  "spec_only",
  "v1_only",
  "legacy",
  "internal",
  "bearer_only",
];

/** The classes an API key can reach and this server may expose (curated or through the raw call). */
export const EXPOSABLE_CLASSES: ReadonlySet<OperationClass> = new Set<OperationClass>(["documented", "spec_only", "v1_only"]);

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One security requirement object: the names of the schemes that together satisfy it. */
export type SecurityRequirement = readonly string[];

/** What classification reads from an operation. `security: null` = the document's default applies. */
export interface ClassifyInput {
  readonly method: HttpMethod;
  readonly path: string;
  readonly security: readonly SecurityRequirement[] | null;
}

/** The operation's key as the generator's filters and the docs index name it: `METHOD /path`. */
export function operationKey(op: { readonly method: HttpMethod; readonly path: string }): string {
  return `${op.method} ${op.path}`;
}

/** The documented v2 operations (66): the spec's /v2 operations reachable by API key, less the 20 the index omits. */
export const DOCUMENTED: ReadonlySet<string> = new Set([
  "GET /v2/account/api-keys",
  "GET /v2/account/invoices",
  "GET /v2/account/usage",
  "POST /v2/design/layerize/ideogram-3",
  "GET /v2/generations/{generation_id}",
  "POST /v2/image/describe/ideogram-3",
  "POST /v2/image/describe/ideogram-4",
  "POST /v2/image/generate/auto",
  "POST /v2/image/generate/gpt-image-2",
  "POST /v2/image/generate/gpt-image-2-5-flare",
  "POST /v2/image/generate/gpt-image-2-5-sunburst",
  "POST /v2/image/generate/ideogram-2",
  "POST /v2/image/generate/ideogram-2a",
  "POST /v2/image/generate/ideogram-3",
  "POST /v2/image/generate/ideogram-3-character",
  "POST /v2/image/generate/ideogram-3-custom-model",
  "POST /v2/image/generate/ideogram-3-transparent",
  "POST /v2/image/generate/ideogram-4",
  "POST /v2/image/generate/ideogram-4-5",
  "POST /v2/image/generate/ideogram-4-custom-model",
  "POST /v2/image/generate/ideogram-4-transparent",
  "POST /v2/image/generate/nano-banana-2",
  "POST /v2/image/generate/nano-banana-pro",
  "POST /v2/image/generate/p-image-ideogram",
  "POST /v2/image/generate/z-image",
  "POST /v2/image/inpaint/ideogram-3",
  "POST /v2/image/inpaint/ideogram-3-character",
  "POST /v2/image/inpaint/ideogram-3-custom-model",
  "POST /v2/image/precise-edit/ideogram-4-5",
  "POST /v2/image/reframe/ideogram-3",
  "POST /v2/image/reframe/nano-banana-2",
  "POST /v2/image/remix/auto",
  "POST /v2/image/remix/ideogram-3",
  "POST /v2/image/remix/ideogram-3-character",
  "POST /v2/image/remix/ideogram-3-custom-model",
  "POST /v2/image/remix/ideogram-4",
  "POST /v2/image/remove-background/ideogram-1",
  "POST /v2/image/remove-object/ideogram-1",
  "POST /v2/image/replace-background/gpt-image-2",
  "POST /v2/image/replace-background/ideogram-3",
  "POST /v2/image/upscale/auto",
  "POST /v2/image/upscale/nano-banana-pro",
  "POST /v2/image/upscale/topaz-bloom-2",
  "POST /v2/image/upscale/topaz-redefine",
  "POST /v2/image/upscale/topaz-standard-2",
  "POST /v2/image/upscale/topaz-text-refine",
  "POST /v2/image/upscale/topaz-wonder-3-5",
  "POST /v2/tool/ad-localizer",
  "POST /v2/tool/ad-resizer",
  "POST /v2/tool/ad-variations",
  "POST /v2/tool/colorways",
  "POST /v2/tool/ghost-mannequin",
  "POST /v2/tool/material-swap",
  "POST /v2/tool/model-pose-variants",
  "POST /v2/tool/sketch-to-render",
  "POST /v2/video/generate/kling-3-standard-image-to-video",
  "POST /v2/video/generate/kling-3-standard-text-to-video",
  "POST /v2/video/generate/minimax-h3-image-to-video",
  "POST /v2/video/generate/minimax-h3-reference-to-video",
  "POST /v2/video/generate/minimax-h3-text-to-video",
  "POST /v2/video/generate/seedance-2-5-image-to-video",
  "POST /v2/video/generate/seedance-2-5-reference-to-video",
  "POST /v2/video/generate/seedance-2-5-text-to-video",
  "POST /v2/video/generate/seedance-2-image-to-video",
  "POST /v2/video/generate/seedance-2-reference-to-video",
  "POST /v2/video/generate/seedance-2-text-to-video",
]);

/** The v1 and unversioned capabilities v2 lacks, by operation. */
export const V1_ONLY: ReadonlySet<string> = new Set([
  // custom-model training: datasets, the trained models, the train calls
  "GET /datasets",
  "POST /datasets",
  "GET /datasets/{dataset_id}",
  "POST /datasets/{dataset_id}/train_model",
  "POST /datasets/{dataset_id}/upload_assets",
  "GET /models",
  "GET /models/{model_id}",
  "POST /v1/ideogram-v3/train-model",
  "POST /v1/ideogram-v3/train-model-advanced",
  "POST /v1/ideogram-v4/train-model",
  "POST /v1/ideogram-v4/train-model-advanced",
  // tools without a v2 counterpart
  "POST /v1/ideogram-v4/magic-prompt",
  "POST /v1/snap-mask",
  "POST /v1/provenance/verify",
  "POST /v1/layerize-logos",
  "GET /v1/.well-known/jwks.json",
  "POST /v1/edit",
  "POST /v1/edit-lite",
  // model variants v2 does not sell
  "POST /v1/ideogram-v45/generate",
  "POST /v1/ideogram-v45/async/generate",
  "POST /v1/flux-2-klein/generate",
  "POST /v1/flux-2-klein/async/generate",
  "POST /v1/flux-2-klein-base/generate",
  "POST /v1/flux-2-klein-base/async/generate",
  "POST /v1/ernie/generate",
  "POST /v1/ernie/async/generate",
  "POST /v1/ideogram-v4-cfg-distilled/generate",
  "POST /v1/ideogram-v4-cfg-distilled/async/generate",
  "POST /v1/ideogram-v4-fp8/generate",
  "POST /v1/ideogram-v4/generate/stable",
  "POST /v1/ideogram-v3/generate-design",
  "POST /v1/ideogram-v4/generate-design",
  "POST /v1/ideogram-v4/async/generate-design",
  "POST /v1/ideogram-v3/graphic",
  "POST /v1/ideogram-v3/try-on",
  "POST /v1/ideogram-v4/image-to-image",
  "POST /v1/ideogram-v4/async/image-to-image",
  "POST /v1/p-image-ideogram/high/generate",
  "POST /v1/p-image-ideogram/medium/generate",
  "POST /v1/p-image-ideogram/low/generate",
  "POST /v1/p-image-ideogram/very-low/generate",
]);

const INTERNAL_PREFIXES: readonly string[] = ["/manage/", "/mini-apps/", "/internal"];

/** True when every requirement that applies is satisfied by BearerAuth alone (an API key satisfies none of them). */
export function isBearerOnly(effective: readonly SecurityRequirement[]): boolean {
  if (effective.length === 0) return false;
  return effective.every((requirement) => requirement.length > 0 && requirement.every((scheme) => scheme === "BearerAuth"));
}

/** The class of one operation; `documentSecurity` is the specification's top-level `security`. */
export function classify(op: ClassifyInput, documentSecurity: readonly SecurityRequirement[]): OperationClass {
  if (isBearerOnly(op.security ?? documentSecurity)) return "bearer_only";
  if (INTERNAL_PREFIXES.some((prefix) => op.path.startsWith(prefix))) return "internal";
  const key = operationKey(op);
  if (op.path.startsWith("/v2/")) return DOCUMENTED.has(key) ? "documented" : "spec_only";
  return V1_ONLY.has(key) ? "v1_only" : "legacy";
}
