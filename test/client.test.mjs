// The v2 HTTP client against a fake API (node:http): the four request locations, typed 402/429, the retry rule
// (never after a possible acceptance), the streamed download cap and the per-operation upload limits.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startFakeApi, testClientOptions, PNG } from "./support/fake-api.mjs";

const { IdeogramClient } = await import("../dist/client.js");
const { IdeogramApiError } = await import("../dist/errors.js");
const { operationById } = await import("../dist/spec/operations.js");
const { loadUploads } = await import("../dist/uploads.js");
const { COUNTERS } = await import("../dist/counters.js");

const dir = await mkdtemp(join(tmpdir(), "ideogram-client-"));
after(() => rm(dir, { recursive: true, force: true }));

const generateOp = operationById("post_generate_image_v2_ideogram_v3");
const request = (op, fields, extra = {}) => ({
  op,
  path: {},
  query: {},
  headers: {},
  body: fields === null ? null : { media: "json", fields, files: [], jsonParts: op.facts.jsonParts },
  dryRun: false,
  ...extra,
});

test("a call sends the Api-Key header, the JSON body, and dry_run as a query parameter", async () => {
  const api = await startFakeApi(() => ({ json: { object: "price_quote" } }));
  try {
    const { options } = testClientOptions(api.base);
    const result = await new IdeogramClient(options).call(request(generateOp, { prompt: "a cat" }, { dryRun: true }));
    assert.deepEqual(result.body, { object: "price_quote" });
    const [sent] = api.requests;
    assert.equal(sent.url, "/v2/image/generate/ideogram-3?dry_run=true");
    assert.equal(sent.headers["api-key"], "dummy-key-for-tests");
    assert.equal(sent.headers.authorization, undefined, "never a Bearer token");
    assert.equal(sent.headers["content-type"], "application/json");
    assert.equal(sent.body.toString(), '{"prompt":"a cat"}');
  } finally {
    await api.close();
  }
});

test("a 402 is typed from GenerationErrorResponse, names the remedy and is never retried", async () => {
  const api = await startFakeApi(() => ({ status: 402, json: { error: "Not enough credits", reject_reason: "insufficient_funds" } }));
  try {
    const { options } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" })).catch((e) => e);
    assert.ok(error instanceof IdeogramApiError);
    assert.deepEqual([error.status, error.details.rejectReason], [402, "insufficient_funds"]);
    assert.match(error.toMcpError(), /add credits/);
    assert.equal(api.requests.length, 1);
  } finally {
    await api.close();
  }
});

const INFLIGHT = { error: "Too many in flight", reject_reason: "inflight_limit", max_inflight_requests: 2, task_completion_speed: "fast" };

test("a 429 is an explicit rejection before acceptance: it is retried after Retry-After", async () => {
  const api = await startFakeApi((_req, n) => (n < 3 ? { status: 429, headers: { "retry-after": "7" }, json: INFLIGHT } : { json: { generation_id: "g", seed: 1 } }));
  try {
    const { options, sleeps } = testClientOptions(api.base);
    const result = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" }));
    assert.deepEqual(result.body, { generation_id: "g", seed: 1 });
    assert.deepEqual(sleeps, [7000, 7000], "Retry-After honoured");
    assert.equal(api.requests.length, 3);
  } finally {
    await api.close();
  }
});

test("a 429 that outlasts the retries is typed with the in-flight limit", async () => {
  const api = await startFakeApi(() => ({ status: 429, json: INFLIGHT }));
  try {
    const { options } = testClientOptions(api.base, { maxRetries: 1 });
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" })).catch((e) => e);
    assert.deepEqual([error.status, error.details.rejectReason, error.details.maxInflight], [429, "inflight_limit", 2]);
    assert.match(error.toMcpError(), /2 generation\(s\) at once/);
    assert.equal(api.requests.length, 2);
  } finally {
    await api.close();
  }
});

test("a POST answered 500 is not sent again: the job may have been accepted and billed", async () => {
  const api = await startFakeApi(() => ({ status: 500, json: { message: "boom" } }));
  try {
    const { options } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" })).catch((e) => e);
    assert.equal(error.status, 500);
    assert.equal(api.requests.length, 1, "one attempt");
  } finally {
    await api.close();
  }
});

test("a POST whose connection drops after the body was sent is not sent again, and the error says why", async () => {
  const api = await startFakeApi(() => (res, req) => req.socket.destroy());
  try {
    const { options } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" })).catch((e) => e);
    assert.equal(error.code, "NETWORK_ERROR");
    assert.match(error.message, /may have reached Ideogram/);
    assert.equal(api.requests.length, 1);
  } finally {
    await api.close();
  }
});

test("a POST whose connection was refused (never sent) is retried", async () => {
  const probe = http.createServer();
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  let api;
  const { options } = testClientOptions(`http://127.0.0.1:${port}`, {
    sleep: async () => {
      if (api) return;
      api = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"generation_id":"g","seed":1}'); }); });
      await new Promise((done) => api.listen(port, "127.0.0.1", done));
    },
  });
  try {
    const result = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" }));
    assert.equal(result.body.generation_id, "g");
  } finally {
    await new Promise((done) => api?.close(done) ?? done());
  }
});

test("a GET (a poll) is retried on a 503", async () => {
  const api = await startFakeApi((_req, n) => (n === 1 ? { status: 503, json: {} } : { json: { ok: true } }));
  try {
    const { options } = testClientOptions(api.base);
    const op = operationById("get_generation_v2");
    const retriesBefore = COUNTERS.retries;
    const result = await new IdeogramClient(options).call(request(op, null, { path: { generation_id: "a/b" } }));
    assert.deepEqual(result.body, { ok: true });
    assert.equal(api.requests[0].url, "/v2/generations/a%2Fb", "the path id is percent-encoded");
    assert.equal(COUNTERS.retries, retriesBefore + 1, "the retry is counted");
  } finally {
    await api.close();
  }
});

test("a download is streamed to disk and stops at the cap: the rest is never read, nothing is left behind", async () => {
  const total = 100 * 1024 * 1024;
  let written = 0;
  const chunk = Buffer.alloc(1024 * 1024, 7);
  const api = await startFakeApi(() => async (res) => {
    res.writeHead(200, { "content-type": "image/png" });
    while (written < total && !res.destroyed) {
      written += chunk.length;
      if (!res.write(chunk)) await new Promise((done) => { res.once("drain", done); res.once("close", done); });
    }
    res.end();
  });
  const out = join(dir, "capped");
  try {
    const { options } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).download(`${api.base}/big.png`, out).catch((e) => e);
    assert.equal(error.code, "DOWNLOAD_TOO_LARGE");
    assert.ok(written < total, `the server stopped at ${written} of ${total} bytes`);
    assert.deepEqual(await readdir(out), [], "the partial file was removed");
  } finally {
    await api.close();
  }
});

test("a download is saved under the output directory with the extension of its media type", async () => {
  const api = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/webp" }, body: PNG }));
  try {
    const { options } = testClientOptions(api.base);
    const saved = await new IdeogramClient(options).download(`${api.base}/x`, join(dir, "ok"));
    assert.match(saved.path, /ideogram-\d+-[0-9a-f]{8}\.webp$/);
    assert.equal(saved.bytes, PNG.length);
    const refused = await new IdeogramClient(options).download("https://example.com/x.png", dir).catch((e) => e);
    assert.equal(refused.code, "SSRF_BLOCKED");
  } finally {
    await api.close();
  }
});

test("upload limits are the operation's: describe refuses an 11 MB image before reading it, remix takes it", async () => {
  const big = join(dir, "big.png");
  await writeFile(big, PNG);
  await truncate(big, 11 * 1024 * 1024);
  const describe = operationById("post_describe_image_ideogram_v3");
  await assert.rejects(() => loadUploads(describe, [{ field: "image", path: big }]), /over 10\.0 MB \(the limit Ideogram states/);
  const remix = operationById("post_remix_image_v2_ideogram_v3");
  const [part] = await loadUploads(remix, [{ field: "image", path: big }]);
  assert.deepEqual([part.field, part.filename, part.contentType, part.bytes.byteLength], ["image", "image.png", "image/png", 11 * 1024 * 1024]);
});

test("an upload to a field the operation lacks, or too many files, is refused naming the fields", async () => {
  const image = join(dir, "i.png");
  await writeFile(image, PNG);
  const generate45 = operationById("post_generate_image_v2_ideogram45");
  await assert.rejects(() => loadUploads(generate45, [{ field: "image", path: image }]), /not a file field .* images, mask/);
  const six = Array.from({ length: 6 }, () => ({ field: "images", path: image }));
  await assert.rejects(() => loadUploads(generate45, six), /at most 5 files/);
  await assert.rejects(() => loadUploads(generate45, [{ field: "mask", path: image }, { field: "mask", path: image }]), /takes one file/);
});
