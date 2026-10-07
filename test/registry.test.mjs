// The model registry against the snapshot: every /v2 model path is in the registry under its family, the registry
// names nothing the snapshot lacks, and the hand-kept newest table names documented models only.
import assert from "node:assert/strict";
import { test } from "node:test";

const { REGISTRY, NEWEST, modelsOf, documentedModelsOf, registryProblems } = await import("../dist/registry.js");
const { OPERATIONS, isExposable, modelOperation } = await import("../dist/spec/operations.js");

test("the registry and the newest table agree with the snapshot", () => {
  assert.deepEqual(registryProblems(), []);
});

test("every exposable /v2 model path is in the registry under its family, and every registry id has its path", () => {
  const fromSpec = OPERATIONS.filter((op) => isExposable(op) && op.model !== null).map((op) => `${op.family}/${op.model}`);
  const fromRegistry = [...REGISTRY].flatMap(([family, entry]) => entry.models.map((model) => `${family}/${model}`));
  assert.deepEqual([...fromRegistry].sort(), [...fromSpec].sort());
  for (const [family, entry] of REGISTRY) {
    for (const model of entry.models) assert.ok(modelOperation(family, model), `${family}/${model} has an operation`);
  }
});

test("the generate family offers the eighteen documented models of the snapshot", () => {
  assert.deepEqual([...documentedModelsOf("generate")].sort(), [
    "auto", "gpt-image-2", "gpt-image-2-5-flare", "gpt-image-2-5-sunburst", "ideogram-2", "ideogram-2a",
    "ideogram-3", "ideogram-3-character", "ideogram-3-custom-model", "ideogram-3-transparent", "ideogram-4",
    "ideogram-4-5", "ideogram-4-custom-model", "ideogram-4-transparent", "nano-banana-2", "nano-banana-pro",
    "p-image-ideogram", "z-image",
  ]);
});

test("a documented model comes before a spec-only one of the same family", () => {
  assert.deepEqual(modelsOf("reframe"), ["ideogram-3", "nano-banana-2", "auto", "bria-expand", "gpt-image-2-5-flare", "nano-banana-pro"]);
  assert.deepEqual(documentedModelsOf("reframe"), ["ideogram-3", "nano-banana-2"]);
});

test("the newest table names a documented model of its family for every entry", () => {
  for (const [family, model] of Object.entries(NEWEST)) {
    assert.ok(documentedModelsOf(family).includes(model), `${family}: ${model}`);
  }
  assert.equal(NEWEST.generate, "ideogram-4-5");
});
