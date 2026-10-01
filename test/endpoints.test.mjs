// The HTTP side of the tools, tested with a fake global fetch: the endpoint each tool posts to, the multipart fields,
// the per-image size cap. No network, no key beyond a dummy. Runs on the built package (`npm test` builds first).
import assert from "node:assert/strict";
import { mkdtemp, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.IDEOGRAM_API_KEY = "dummy-key-for-tests";
process.env.IDEOGRAM_OUTPUT_DIR = await mkdtemp(join(tmpdir(), "ideogram-out-"));

const { handleEdit } = await import("../dist/tools/edit.js");
const { validateFileSize } = await import("../dist/storage.js");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"); // a PNG signature is enough: the loader checks path and size
const dir = await mkdtemp(join(tmpdir(), "ideogram-in-"));
const image = join(dir, "image.png");
const mask = join(dir, "mask.png");
await writeFile(image, PNG);
await writeFile(mask, PNG);

/** Replaces global fetch for one call; returns what the tool posted. */
async function capture(run) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    // the real response shape: one image the safety filter dropped (url null), so nothing is downloaded
    const image = { prompt: "a red door", resolution: "1024x1024", is_image_safe: false, seed: 1, url: null, style_type: "GENERAL" };
    return new Response(JSON.stringify({ created: "2026-10-01T00:00:00Z", data: [image] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test("ideogram_edit posts to the inpaint endpoint (the edit endpoint is legacy) with image, mask and prompt", async () => {
  const calls = await capture(() => handleEdit({ image, mask, prompt: "a red door" }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.ideogram.ai/v1/ideogram-v3/inpaint");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Api-Key"], "dummy-key-for-tests");
  const form = calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("prompt"), "a red door");
  assert.ok(form.get("image") instanceof Blob);
  assert.ok(form.get("mask") instanceof Blob);
});

test("the per-image cap is Ideogram's 25 MB: 25 MB passes, one byte more is refused by name", async () => {
  const big = join(dir, "big.png");
  await writeFile(big, PNG);
  await truncate(big, 25 * 1024 * 1024);
  await validateFileSize(big);
  await truncate(big, 25 * 1024 * 1024 + 1);
  await assert.rejects(() => validateFileSize(big), /25MB/);
});
