// The HTTP side of the tools, tested with a fake global fetch: the endpoint each tool posts to, the multipart fields,
// the per-image size cap. No network, no key beyond a dummy. Runs on the built package (`npm test` builds first).
import assert from "node:assert/strict";
import { mkdtemp, writeFile, truncate, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

process.env.IDEOGRAM_API_KEY = "dummy-key-for-tests";
process.env.IDEOGRAM_OUTPUT_DIR = await mkdtemp(join(tmpdir(), "ideogram-out-"));

const { handleEdit } = await import("../dist/tools/edit.js");
const { ideogramRequest, downloadImage } = await import("../dist/client.js");
const { validateFileSize } = await import("../dist/storage.js");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"); // a PNG signature is enough: the loader checks path and size
const dir = await mkdtemp(join(tmpdir(), "ideogram-in-"));
const image = join(dir, "image.png");
const mask = join(dir, "mask.png");
await writeFile(image, PNG);
await writeFile(mask, PNG);
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(process.env.IDEOGRAM_OUTPUT_DIR, { recursive: true, force: true });
});

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
  const calls = await capture(() =>
    handleEdit({ image, mask, prompt: "a red door", num_images: 2, rendering_speed: "TURBO", magic_prompt: "OFF", style_type: "REALISTIC", seed: 7 }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.ideogram.ai/v1/ideogram-v3/inpaint");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Api-Key"], "dummy-key-for-tests");
  const form = calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("prompt"), "a red door");
  assert.ok(form.get("image") instanceof Blob);
  assert.ok(form.get("mask") instanceof Blob);
  assert.deepEqual(
    ["num_images", "rendering_speed", "magic_prompt", "style_type", "seed"].map((k) => form.get(k)),
    ["2", "TURBO", "OFF", "REALISTIC", "7"],
    "every optional field reaches inpaint under its name",
  );
});

test("image and mask that together reach Ideogram's 50 MB request limit are refused before any upload", async () => {
  const a = join(dir, "a.png");
  const b = join(dir, "b.png");
  await writeFile(a, PNG);
  await writeFile(b, PNG);
  await truncate(a, 25 * 1024 * 1024);
  await truncate(b, 25 * 1024 * 1024);
  const calls = await capture(() => assert.rejects(() => handleEdit({ image: a, mask: b, prompt: "x" }), /under 50MB/));
  assert.equal(calls.length, 0, "nothing was uploaded");
  // just under the limit by file bytes alone is refused too: the multipart overhead has no room
  await truncate(b, 25 * 1024 * 1024 - 1024);
  await assert.rejects(() => handleEdit({ image: a, mask: b, prompt: "x" }), /under 50MB/);
});

test("a timed-out request is not retried: the server may have accepted and billed it", async () => {
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    n += 1;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  try {
    await assert.rejects(() => ideogramRequest("/v1/ideogram-v3/generate", new FormData()), /Network error/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(n, 1, "one attempt");
});

test("a timed-out image download is retried: a GET is idempotent and the image is already generated", async () => {
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    n += 1;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  try {
    await assert.rejects(() => downloadImage("https://ideogram.ai/api/images/x.png"), /TimeoutError/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(n, 4, "the first attempt and three retries");
});

test("the per-image cap is Ideogram's 25 MB: 25 MB passes, one byte more is refused by name", async () => {
  const big = join(dir, "big.png");
  await writeFile(big, PNG);
  await truncate(big, 25 * 1024 * 1024);
  await validateFileSize(big);
  await truncate(big, 25 * 1024 * 1024 + 1);
  await assert.rejects(() => validateFileSize(big), /25MB/);
});
