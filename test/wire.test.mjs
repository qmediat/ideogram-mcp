// Independently authored wire fixtures: the exact bytes a known-good request puts on the wire (multipart with a file
// and a JSON-encoded part, a JSON body, repeated query arrays, the path id), and the semantic refusals that must
// stop a request before any byte is sent. The expected bytes below are written by hand from the specification's
// serialization rules, not captured from this code.
import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startFakeApi, testClientOptions, testContext, tool, PNG } from "./support/fake-api.mjs";

const { IdeogramClient } = await import("../dist/client.js");
const { operationById } = await import("../dist/spec/operations.js");

const dir = await mkdtemp(join(tmpdir(), "ideogram-wire-"));
after(() => rm(dir, { recursive: true, force: true }));
const png = join(dir, "photo.png");
await writeFile(png, PNG);

const CRLF = "\r\n";
const textPart = (name, value) => `--test-boundary${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`;
const jsonPart = (name, json) =>
  `--test-boundary${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}Content-Type: application/json${CRLF}${CRLF}${json}${CRLF}`;
const fileHead = (name, filename) =>
  `--test-boundary${CRLF}Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}Content-Type: image/png${CRLF}${CRLF}`;
const END = `--test-boundary--${CRLF}`;

async function sent(name, args) {
  const api = await startFakeApi((req) => (req.method === "POST" ? { json: { generation_id: "g", seed: 1 } } : { json: { generation_id: "g", status: "pending", created: "2026-10-07T00:00:00Z" } }));
  try {
    const ctx = await testContext(api.base, dir);
    await (await tool(name)).handler(ctx, args);
    return api.requests;
  } finally {
    await api.close();
  }
}

test("multipart generate with a file: text parts, a repeated list, a JSON part, then the file — byte for byte", async () => {
  const [req] = await sent("ideogram_generate", {
    prompt: "a red door",
    style_codes: ["ABCD1234", "00ff00ff"],
    color_palette: { name: "ember" },
    style_reference_images: [png],
    wait_s: 0,
  });
  assert.equal(req.url, "/v2/image/generate/ideogram-3");
  assert.equal(req.headers["content-type"], "multipart/form-data; boundary=test-boundary");
  const expected = Buffer.concat([
    Buffer.from(
      textPart("prompt", "a red door") +
        textPart("style_codes", "ABCD1234") +
        textPart("style_codes", "00ff00ff") +
        jsonPart("color_palette", '{"name":"ember"}') +
        textPart("async", "true") +
        fileHead("style_reference_images", "style_reference_images.png"),
    ),
    PNG,
    Buffer.from(CRLF + END),
  ]);
  assert.equal(req.body.toString("latin1"), expected.toString("latin1"));
  assert.equal(req.headers["content-length"], String(expected.length));
});

test("a JSON remix by asset reference: the fields in the caller's order, async last", async () => {
  const [req] = await sent("ideogram_remix", {
    prompt: "night",
    image_asset_identifier: { asset_type: "UPLOAD", asset_id: "abc" },
    image_weight: 40,
    wait_s: 0,
  });
  assert.equal(req.url, "/v2/image/remix/ideogram-3");
  assert.equal(req.headers["content-type"], "application/json");
  assert.equal(req.body.toString(), '{"prompt":"night","image_asset_identifier":{"asset_type":"UPLOAD","asset_id":"abc"},"image_weight":40,"async":true}');
});

test("a query array is sent as repeated name=value pairs (account usage), dry_run as one more pair", async () => {
  const api = await startFakeApi(() => ({ json: { buckets: [] } }));
  try {
    const client = new IdeogramClient(testClientOptions(api.base).options);
    const op = operationById("get_account_usage");
    await client.call({ op, path: {}, query: { start_time: "2026-10-01T00:00:00Z", sources: ["api", "web app"] }, headers: {}, body: null, dryRun: false });
    assert.equal(api.requests[0].url, "/v2/account/usage?start_time=2026-10-01T00%3A00%3A00Z&sources=api&sources=web+app");
    assert.equal(api.requests[0].body.length, 0);
  } finally {
    await api.close();
  }
});

test("the generation id goes in the path, percent-encoded", async () => {
  const requests = await sent("ideogram_generation", { generation_id: "a/b c", wait_s: 0 });
  assert.equal(requests[0].url, "/v2/generations/a%2Fb%20c");
  assert.equal(requests[0].method, "GET");
});

test("semantic refusals send nothing: a mask without its image, size source without images, a 60 MB describe upload", async () => {
  const big = join(dir, "big.png");
  await writeFile(big, PNG);
  await truncate(big, 60 * 1024 * 1024);
  const cases = [
    ["ideogram_api", { operation: "post_precise_edit_image_v2_ideogram45", params: { body: { prompt: "x" } }, files: [{ field: "mask", path: png }] }, /mask needs the source image/],
    ["ideogram_generate", { model: "ideogram-4-5", prompt: "x", size: "source" }, /size "source" needs source images/],
    ["ideogram_describe", { image: big }, /over 10\.0 MB/],
  ];
  for (const [name, args, message] of cases) {
    const api = await startFakeApi(() => ({ json: {} }));
    try {
      const ctx = await testContext(api.base, dir);
      await assert.rejects(() => tool(name).then((t) => t.handler(ctx, args)), message);
      assert.equal(api.requests.length, 0, name);
    } finally {
      await api.close();
    }
  }
});
