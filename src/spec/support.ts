/**
 * Runtime support of the shipped release, apart from the operation's class: what `ideogram_api` serves and what the
 * curated tools cover. In 2.1.0 (step 1 of docs/DESIGN-ideogram-v2.md):
 *
 *   curated  the documented models of the eleven image families (the seven of 1.x, precise edit, remove background,
 *            remove object, layerize), and the generation lookup
 *   raw      every other /v2/image operation — spec_only behind `allow_undocumented`
 *   planned  every other exposable operation (video, tools, workflows, account, v1_only): later releases
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
]);

export const CURATED_OPERATIONS_OUTSIDE_FAMILIES: ReadonlySet<string> = new Set(["get_generation_v2"]);

export function supportOf(op: Operation): SupportStatus {
  if (!isExposable(op)) return "unsupported";
  if (CURATED_OPERATIONS_OUTSIDE_FAMILIES.has(op.id)) return "curated";
  const curatedFamily = op.family !== null && CURATED_FAMILIES.has(op.family);
  if (curatedFamily && op.class === "documented") return "curated";
  if (op.path.startsWith("/v2/image/")) return "raw";
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
