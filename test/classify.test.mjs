// The one classification rule (src/spec/classify.ts) over the committed snapshot: every operation falls into exactly
// one class, the counts are the ones the rule gives for the 2026-10-07 snapshot, and nothing an API key cannot reach or
// the provider keeps for itself is ever exposable. Runs on the built package (`npm test` builds first).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { classify, isBearerOnly, DOCUMENTED, V1_ONLY, EXPOSABLE_CLASSES, OPERATION_CLASSES, operationKey } = await import(
  "../dist/spec/classify.js"
);
const { SPEC_OPERATIONS, SPEC_DOCUMENT_SECURITY } = await import("../dist/generated/operations.gen.js");

const classOf = (op) => classify(op, SPEC_DOCUMENT_SECURITY);
const keysOf = (cls) => SPEC_OPERATIONS.filter((op) => classOf(op) === cls).map(operationKey);

test("the snapshot's 200 operations fall into the six classes with the counts the rule gives", () => {
  assert.equal(SPEC_OPERATIONS.length, 200);
  const counts = Object.fromEntries(OPERATION_CLASSES.map((cls) => [cls, keysOf(cls).length]));
  assert.deepEqual(counts, {
    documented: 66,
    spec_only: 20,
    v1_only: 41,
    legacy: 32,
    internal: 9,
    bearer_only: 32,
  });
});

test("every documented and every v1_only entry names an operation of the snapshot (no stale list entry)", () => {
  const keys = new Set(SPEC_OPERATIONS.map(operationKey));
  for (const key of [...DOCUMENTED, ...V1_ONLY]) assert.ok(keys.has(key), `${key} is in the snapshot`);
  assert.equal(DOCUMENTED.size, 66);
});

test("a documented path is never spec_only, and every /v2 path the index omits is spec_only", () => {
  for (const key of keysOf("spec_only")) assert.equal(DOCUMENTED.has(key), false, key);
  assert.deepEqual(keysOf("documented").sort(), [...DOCUMENTED].sort());
  const unlisted = { method: "POST", path: "/v2/image/generate/a-model-added-tomorrow", security: null };
  assert.equal(classOf(unlisted), "spec_only", "a new /v2 operation is never documented by default");
});

test("the spec-only operations are the twenty the docs index omits", () => {
  assert.deepEqual(keysOf("spec_only").sort(), [
    "GET /v2/assets/reference-usage",
    "POST /v2/image/reframe/auto",
    "POST /v2/image/reframe/bria-expand",
    "POST /v2/image/reframe/gpt-image-2-5-flare",
    "POST /v2/image/reframe/nano-banana-pro",
    "POST /v2/tool/living-image",
    "POST /v2/tool/model-swap",
    "POST /v2/tool/packshots",
    "POST /v2/tool/product-360-video",
    "POST /v2/tool/skechers-style-editor",
    "POST /v2/tool/sole-swap",
    "POST /v2/tool/swan-s-logo-design",
    "POST /v2/tool/swan-s-logo-install",
    "POST /v2/tool/swap-product",
    "POST /v2/tool/text-layerizer",
    "POST /v2/tool/vectorizer",
    "POST /v2/video/edit/seedance-2",
    "POST /v2/workflow/lookbook",
    "POST /v2/workflow/precise-masked-edit",
    "POST /v2/workflow/virtual-try-on",
  ]);
});

test("a Bearer-only operation is never exposable, whatever its path", () => {
  for (const op of SPEC_OPERATIONS.filter((o) => isBearerOnly(o.security ?? SPEC_DOCUMENT_SECURITY))) {
    assert.equal(classOf(op), "bearer_only", operationKey(op));
    assert.equal(EXPOSABLE_CLASSES.has(classOf(op)), false);
  }
  assert.deepEqual(
    keysOf("bearer_only").filter((k) => k.includes("/v2/")).sort(),
    ["GET /v2/integrations", "POST /v2/integrations/{integration_type}/assets/search"],
    "a /v2 path does not make a Bearer-only operation documented",
  );
});

test("the document default (API key OR Bearer) is not Bearer-only; an operation open to no scheme is not either", () => {
  assert.equal(isBearerOnly([["ApiKeyAuth"], ["BearerAuth"]]), false);
  assert.equal(isBearerOnly([["BearerAuth"]]), true);
  assert.equal(isBearerOnly([]), false);
  assert.equal(isBearerOnly([[]]), false, "an empty requirement means anonymous access, not Bearer");
});

test("class follows capability and auth, not URL age: /datasets and /models are v1_only, /generate is legacy", () => {
  const byKey = new Map(SPEC_OPERATIONS.map((op) => [operationKey(op), classOf(op)]));
  for (const key of ["GET /datasets", "POST /datasets/{dataset_id}/train_model", "GET /models", "GET /models/{model_id}"]) {
    assert.equal(byKey.get(key), "v1_only", key);
  }
  for (const key of ["POST /generate", "POST /edit", "POST /describe", "POST /v1/ideogram-v3/generate", "POST /v1/ideogram-v3/inpaint"]) {
    assert.equal(byKey.get(key), "legacy", key);
  }
  assert.equal(byKey.get("POST /mini-apps/publish"), "internal", "an API-key path the provider keeps for itself");
  assert.equal(byKey.get("POST /internal/batch"), "internal");
});

test("the generated code covers exactly the exposable operations and keeps PriceQuote", () => {
  const zod = readFileSync(new URL("../src/generated/zod.gen.ts", import.meta.url), "utf8");
  const exported = new Set([...zod.matchAll(/^export const (z\w+) =/gm)].map((m) => m[1].toLowerCase()));
  assert.ok(exported.has("zpricequote"), "PriceQuote is generated although no operation references it");
  for (const op of SPEC_OPERATIONS) {
    const base = `z${op.id.replaceAll("_", "")}`;
    const generated = ["body", "query", "path", "response"].some((suffix) => exported.has(`${base}${suffix}`));
    assert.equal(generated, EXPOSABLE_CLASSES.has(classOf(op)), `${operationKey(op)} generated iff exposable`);
  }
});
