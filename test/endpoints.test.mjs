// The HTTP side of the tools, tested with a fake global fetch: the endpoint each tool posts to, the multipart fields,
// the per-image size cap. No network, no key beyond a dummy. Runs on the built package (`npm test` builds first).
import assert from "node:assert/strict";
import { mkdtemp, writeFile, truncate, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

process.env.IDEOGRAM_API_KEY = "dummy-key-for-tests";
process.env.IDEOGRAM_OUTPUT_DIR = await mkdtemp(join(tmpdir(), "ideogram-out-"));

const { handleEdit, editInputSchema } = await import("../dist/tools/edit.js");
const { handleGenerate, generateInputSchema } = await import("../dist/tools/generate.js");
const { handleRemix, remixInputSchema } = await import("../dist/tools/remix.js");
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

test("the style controls reach every v3 generation endpoint under the API's field names", async () => {
  const ref = join(dir, "ref.png");
  const character = join(dir, "character.png");
  const charMask = join(dir, "character-mask.png");
  await writeFile(ref, PNG);
  await writeFile(character, PNG);
  await writeFile(charMask, PNG);
  const shared = {
    style_reference_images: [ref],
    character_reference_image: character,
    character_reference_mask: charMask,
    style_codes: ["A1B2C3D4", "ffffffff"],
    style_preset: "VINTAGE_POSTER",
    color_palette: { members: [{ color_hex: "#FF0000", color_weight: 0.7 }, { color_hex: "#00FF00" }] },
  };
  const calls = await capture(async () => {
    await handleGenerate({ prompt: "a poster", ...shared, resolution: "1536x640", custom_model_uri: "model/brand/version/3", enable_copyright_detection: true });
    await handleRemix({ image, prompt: "a poster", ...shared, resolution: "1536x640" });
    await handleEdit({ image, mask, prompt: "a poster", ...shared });
  });
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      "https://api.ideogram.ai/v1/ideogram-v3/generate",
      "https://api.ideogram.ai/v1/ideogram-v3/remix",
      "https://api.ideogram.ai/v1/ideogram-v3/inpaint",
    ],
  );
  for (const call of calls) {
    const form = call.init.body;
    assert.deepEqual(form.getAll("style_codes"), ["A1B2C3D4", "ffffffff"], "a list is repeated fields");
    assert.equal(form.get("style_preset"), "VINTAGE_POSTER");
    const palette = form.get("color_palette");
    assert.equal(palette.type, "application/json", "the palette is one JSON part, as the OpenAPI spec declares it");
    assert.deepEqual(JSON.parse(await palette.text()), shared.color_palette);
    assert.equal(form.getAll("style_reference_images").length, 1);
    assert.ok(form.get("style_reference_images") instanceof Blob);
    assert.ok(form.get("character_reference_images") instanceof Blob);
    assert.ok(form.get("character_reference_images_mask") instanceof Blob);
  }
  // what only some endpoints take is sent only there
  const [generate, remix, inpaint] = calls.map((c) => c.init.body);
  assert.equal(generate.get("resolution"), "1536x640");
  assert.equal(remix.get("resolution"), "1536x640");
  assert.equal(inpaint.get("resolution"), null, "inpaint has no resolution parameter");
  assert.equal(generate.get("custom_model_uri"), "model/brand/version/3");
  assert.equal(generate.get("enable_copyright_detection"), "true");
  for (const form of [remix, inpaint]) {
    assert.equal(form.get("custom_model_uri"), null);
    assert.equal(form.get("enable_copyright_detection"), null);
  }
});

test("the tools refuse what the API refuses: resolution with aspect_ratio, a palette with both forms, a control an endpoint lacks", async () => {
  const calls = await capture(async () => {
    await assert.rejects(() => handleGenerate({ prompt: "x", resolution: "1024x1024", aspect_ratio: "1x1" }), /cannot be combined/);
    await assert.rejects(() => handleRemix({ image, prompt: "x", resolution: "1024x1024", aspect_ratio: "1x1" }), /cannot be combined/);
  });
  assert.equal(calls.length, 0);
  const both = { name: "EMBER", members: [{ color_hex: "#FF0000" }] };
  assert.equal(generateInputSchema.safeParse({ prompt: "x", color_palette: both }).success, false, "name and members together are refused, never silently reduced");
  assert.equal(generateInputSchema.safeParse({ prompt: "x", resolution: "9999x9999" }).success, false, "only Ideogram's 69 sizes");
  assert.equal(editInputSchema.safeParse({ image, mask, prompt: "x", resolution: "1024x1024" }).success, true, "zod drops an unknown key…");
  assert.equal("resolution" in editInputSchema.shape, false, "…because inpaint has no such parameter in its schema");
  assert.equal("custom_model_uri" in remixInputSchema.shape, false);
});

test("remix and edit measure their reference images against the request limit and refuse a mask without its image", async () => {
  const big1 = join(dir, "rbig1.png");
  const big2 = join(dir, "rbig2.png");
  await writeFile(big1, PNG);
  await writeFile(big2, PNG);
  await truncate(big1, 25 * 1024 * 1024);
  await truncate(big2, 25 * 1024 * 1024);
  const calls = await capture(async () => {
    await assert.rejects(() => handleRemix({ image: big1, prompt: "x", style_reference_images: [big2] }), /under 50MB/);
    await assert.rejects(() => handleEdit({ image, mask, prompt: "x", style_reference_images: [big1, big2] }), /under 50MB/);
    await assert.rejects(() => handleRemix({ image, prompt: "x", character_reference_mask: image }), /needs character_reference_image/);
    await assert.rejects(() => handleEdit({ image, mask, prompt: "x", character_reference_mask: image }), /needs character_reference_image/);
  });
  assert.equal(calls.length, 0, "nothing was uploaded");
});

test("a character mask without its image, a bad style code and a bad palette colour are refused before any upload", async () => {
  const calls = await capture(() => assert.rejects(() => handleGenerate({ prompt: "x", character_reference_mask: image }), /needs character_reference_image/));
  assert.equal(calls.length, 0);
  assert.equal(generateInputSchema.safeParse({ prompt: "x", style_codes: ["xyz"] }).success, false);
  assert.equal(generateInputSchema.safeParse({ prompt: "x", color_palette: { members: [{ color_hex: "red" }] } }).success, false);
  assert.equal(generateInputSchema.safeParse({ prompt: "x", color_palette: { name: "EMBER" } }).success, true);
  assert.equal(generateInputSchema.safeParse({ prompt: "x", resolution: "1024x1024" }).success, true);
  assert.equal(generateInputSchema.safeParse({ prompt: "x", resolution: "big" }).success, false);
});

test("reference images count against the 50 MB request limit before any file is read", async () => {
  const big1 = join(dir, "big1.png");
  const big2 = join(dir, "big2.png");
  await writeFile(big1, PNG);
  await writeFile(big2, PNG);
  await truncate(big1, 25 * 1024 * 1024);
  await truncate(big2, 25 * 1024 * 1024);
  const calls = await capture(() =>
    assert.rejects(() => handleGenerate({ prompt: "x", style_reference_images: [big1, big2] }), /under 50MB/),
  );
  assert.equal(calls.length, 0, "nothing was uploaded");
});

test("model 4.0 posts text_prompt to the v4 endpoint and refuses the 3.0-only parameters instead of dropping them", async () => {
  const calls = await capture(() =>
    handleGenerate({ prompt: "a cat", model: "4.0", resolution: "1024x1024", rendering_speed: "QUALITY", enable_copyright_detection: false }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.ideogram.ai/v1/ideogram-v4/generate");
  const form = calls[0].init.body;
  assert.equal(form.get("text_prompt"), "a cat");
  assert.equal(form.get("prompt"), null, "the v4 field name, not the v3 one");
  assert.equal(form.get("resolution"), "1024x1024");
  assert.equal(form.get("rendering_speed"), "QUALITY");
  assert.equal(form.get("enable_copyright_detection"), "false");
  const refused = await capture(() =>
    assert.rejects(() => handleGenerate({ prompt: "a cat", model: "4.0", style_type: "REALISTIC", seed: 1 }), /does not take: style_type, seed/),
  );
  assert.equal(refused.length, 0);
  const flash = await capture(() => assert.rejects(() => handleGenerate({ prompt: "a cat", model: "4.0", rendering_speed: "FLASH" }), /no FLASH/));
  assert.equal(flash.length, 0, "refused before any request");
});
