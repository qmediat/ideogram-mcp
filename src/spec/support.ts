/**
 * Runtime support of the shipped release, apart from the operation's class: what `ideogram_api` serves and what the
 * curated tools cover. In 2.3.0 (step 3 of docs/DESIGN-ideogram-v2.md):
 *
 *   curated  the documented models of the eleven image families (the seven of 1.x, precise edit, remove background,
 *            remove object, layerize), the generation lookup, the three documented account operations, and the
 *            training operations the four training tools cover (v1-only: the index keeps training on v1)
 *   raw      every other /v2/image operation, every spec_only operation of a curated family (behind
 *            `allow_undocumented`), and the one training operation no tool covers (train_dataset_model)
 *   planned  every other exposable operation (video, tools, workflows, the other v1_only): later releases
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
]);

/** Families served through `ideogram_api` in full, whatever the class of their operations (the training family is v1-only). */
export const RAW_FAMILIES: ReadonlySet<Family> = new Set<Family>(["training"]);

export function supportOf(op: Operation): SupportStatus {
  if (!isExposable(op)) return "unsupported";
  if (CURATED_OPERATIONS_OUTSIDE_FAMILIES.has(op.id)) return "curated";
  const curatedFamily = op.family !== null && CURATED_FAMILIES.has(op.family);
  if (curatedFamily && op.class === "documented") return "curated";
  if (op.path.startsWith("/v2/image/") || (curatedFamily && op.class === "spec_only")) return "raw";
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
