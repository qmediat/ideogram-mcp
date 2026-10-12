/**
 * Runtime support of the shipped release, apart from the operation's class: what `ideogram_api` serves and what the
 * curated tools cover (step 5 of docs/DESIGN-ideogram-v2.md):
 *
 *   curated  the documented models of the eleven image families (the seven of 1.x, precise edit, remove background,
 *            remove object, layerize), the generation lookup, the three documented account operations, the training
 *            operations the four training tools cover (v1-only: the index keeps training on v1), the three video
 *            families (text, image, reference to video), the twelve single-operation tools (the documented commercial
 *            tools and the v1 utilities)
 *   raw      every other /v2/image operation, every spec_only or v1_only operation of a curated family (the v1 model
 *            variants, the webhook JWKS), the one training operation no tool covers (train_dataset_model), the video
 *            edit, every tool and workflow operation no tool wraps (spec_only and customer-specific: behind
 *            `allow_undocumented`)
 *   planned  nothing: every exposable operation is curated or raw
 *
 * Classes legacy, internal and bearer_only are never supported.
 */
import { isExposable, OPERATIONS } from "./operations.js";
import type { Family, Operation } from "./operations.js";

export type SupportStatus = "curated" | "raw" | "planned" | "unsupported";

/** The families whose documented models the curated tools of this release cover. */
export const CURATED_FAMILIES: ReadonlySet<Family> = new Set<Family>([
  "generate",
  "precise_edit",
  "inpaint",
  "remix",
  "reframe",
  "replace_background",
  "remove_background",
  "remove_object",
  "upscale",
  "describe",
  "layerize",
  "account",
  "video_text",
  "video_image",
  "video_reference",
]);

export const CURATED_OPERATIONS_OUTSIDE_FAMILIES: ReadonlySet<string> = new Set([
  "get_generation_v2",
  "list_datasets",
  "get_dataset",
  "create_dataset",
  "upload_dataset_assets",
  "list_custom_models",
  "get_custom_model",
  "train_model_v4",
  "train_model_v4_advanced",
  "train_model_v3",
  "train_model_v3_advanced",
  // the single-operation tools (src/tools/commercial.ts): the documented commercial tools and the v1 utilities
  "post_ad_localizer",
  "post_ad_resizer",
  "post_ad_variations",
  "post_colorways",
  "post_ghost_mannequin",
  "post_material_swap",
  "post_model_pose_variants",
  "post_sketch_to_render",
  "post_magic_prompt_v4",
  "post_layerize_logos",
  "post_provenance_verify",
  "post_snap_mask",
]);

/** Families served through `ideogram_api` in full, whatever the class of their operations (the training family is
 * v1-only; the tool and workflow families hold the spec-only and customer-specific operations — skechers, swan,
 * sole-swap, the workflows — that no curated tool wraps). */
export const RAW_FAMILIES: ReadonlySet<Family> = new Set<Family>(["training", "video_edit", "tool", "workflow"]);

export function supportOf(op: Operation): SupportStatus {
  if (!isExposable(op)) return "unsupported";
  if (CURATED_OPERATIONS_OUTSIDE_FAMILIES.has(op.id)) return "curated";
  const curatedFamily = op.family !== null && CURATED_FAMILIES.has(op.family);
  if (curatedFamily && op.class === "documented") return "curated";
  if (op.path.startsWith("/v2/image/") || (curatedFamily && (op.class === "spec_only" || op.class === "v1_only")))
    return "raw"; // a v1 model variant of a curated family (ernie, flux, the v4 tiers, the p-image tiers…) runs raw
  if (op.family !== null && RAW_FAMILIES.has(op.family)) return "raw";
  return "planned";
}

/** Whether `ideogram_api` may run the operation in this release. */
export function servedByRawCall(op: Operation): boolean {
  const status = supportOf(op);
  return status === "curated" || status === "raw";
}

export function operationsWithSupport(status: SupportStatus): readonly Operation[] {
  return OPERATIONS.filter((op) => supportOf(op) === status);
}
