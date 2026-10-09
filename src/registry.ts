/**
 * The model registry: for every family, the model ids the snapshot's /v2 paths name (in the specification's order),
 * and the hand-kept table of Ideogram's newest model per family. `registryProblems()` lists every disagreement between
 * the two; the test suite fails on any (test/registry.test.mjs), so a provider change that retires a model the table
 * names cannot ship unnoticed.
 */
import { isExposable, OPERATIONS } from "./spec/operations.js";
import type { Family } from "./spec/operations.js";

/** Ideogram's newest model per family, kept by hand (a release decision, not a fact of the specification). */
export const NEWEST: Readonly<Partial<Record<Family, string>>> = {
  generate: "ideogram-4-5",
  precise_edit: "ideogram-4-5",
  remix: "ideogram-4",
  describe: "ideogram-4",
  inpaint: "ideogram-3",
  reframe: "ideogram-3",
  replace_background: "ideogram-3",
  layerize: "ideogram-3",
};

export interface FamilyModels {
  readonly family: Family;
  /** Every model of the family on an exposable /v2 path, documented first, each group in the specification's order. */
  readonly models: readonly string[];
  readonly documented: readonly string[];
}

function familyModels(family: Family): FamilyModels {
  const ops = OPERATIONS.filter((op) => op.family === family && op.model !== null && isExposable(op));
  const documented = ops.filter((op) => op.class === "documented").map((op) => op.model as string);
  const rest = ops.filter((op) => op.class !== "documented").map((op) => op.model as string);
  return { family, models: [...documented, ...rest], documented };
}

function modelFamilies(): Family[] {
  const families = new Set<Family>();
  for (const op of OPERATIONS) if (op.model !== null && op.family !== null) families.add(op.family);
  return [...families];
}

export const REGISTRY: ReadonlyMap<Family, FamilyModels> = new Map(modelFamilies().map((f) => [f, familyModels(f)]));

export function modelsOf(family: Family): readonly string[] {
  return REGISTRY.get(family)?.models ?? [];
}

export function documentedModelsOf(family: Family): readonly string[] {
  return REGISTRY.get(family)?.documented ?? [];
}

/** Every disagreement between the newest table and the snapshot, as sentences; empty when they agree. */
export function registryProblems(): string[] {
  const problems: string[] = [];
  for (const [family, newest] of Object.entries(NEWEST) as [Family, string][]) {
    const models = documentedModelsOf(family);
    if (!models.includes(newest)) {
      problems.push(`NEWEST.${family} = ${newest} is not a documented model of the snapshot (it has: ${models.join(", ") || "none"})`);
    }
  }
  for (const op of OPERATIONS) {
    if (!op.path.startsWith("/v2/") || !isExposable(op) || op.family === null) continue;
    const modelPath = /^\/v2\/(image|design|video)\//.test(op.path);
    if (modelPath && op.model === null) problems.push(`${op.key} is a model path without a model id`);
  }
  return problems;
}
