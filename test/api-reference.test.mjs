// docs/API-REFERENCE.md is generated from Operation[] (scripts/api-reference.mjs): the committed file must be exactly
// what the snapshot renders, so a hand edit or a stale file fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { render } = await import("../scripts/api-reference.mjs");

test("the committed API reference is what the snapshot renders", async () => {
  const committed = readFileSync(new URL("../docs/API-REFERENCE.md", import.meta.url), "utf8");
  assert.equal(committed, await render(), "run: npm run build && node scripts/api-reference.mjs");
});

test("the reference lists every family with its models and the fields of each served operation", async () => {
  const text = await render();
  assert.match(text, /\| documented \| 66 \| yes \|/);
  assert.match(text, /### generate\n\n\| model \| operation/);
  assert.match(text, /#### ideogram-4-5 — `POST \/v2\/image\/generate\/ideogram-4-5`/);
  assert.match(text, /\| `quality` \| one of very_low, low, medium, high \|/);
  assert.doesNotMatch(text, /#### seedance-2-text-to-video/, "a planned operation is listed, not detailed");
});
