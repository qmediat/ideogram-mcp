// The v2 HTTP client against a fake API (node:http): the four request locations, typed 402/429, the retry rule
// (never after a possible acceptance), the streamed download cap and the per-operation upload limits.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startFakeApi, testClientOptions, realBudget, PNG } from "./support/fake-api.mjs";

const { IdeogramClient } = await import("../dist/client.js");
const { IdeogramApiError } = await import("../dist/errors.js");
const { operationById } = await import("../dist/spec/operations.js");
const { loadUploads } = await import("../dist/uploads.js");
const { COUNTERS } = await import("../dist/counters.js");
const { TOOL_CALL_MS, toolCallBudget } = await import("../dist/budget.js");

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

test("a download redirect is never followed: the hop would skip the host allow-list (1.x blocked it too)", async () => {
  const target = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  const api = await startFakeApi(() => ({ status: 302, headers: { location: `${target.base}/elsewhere.png` }, body: "" }));
  try {
    const { options } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).download(`${api.base}/x.png`, join(dir, "redirected")).catch((e) => e);
    assert.equal(error.code, "REDIRECT_BLOCKED");
    assert.match(error.message, /302/);
    assert.equal(target.requests.length, 0, "the redirect target was never fetched");
  } finally {
    await api.close();
    await target.close();
  }
});

test("a 429 whose Retry-After is longer than the client waits is not retried, and the error carries the value", async () => {
  const api = await startFakeApi(() => ({ status: 429, headers: { "retry-after": "900" }, json: INFLIGHT }));
  try {
    const { options, sleeps, budget } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" }), budget).catch((e) => e);
    assert.deepEqual([error.status, error.details.retryAfterS, api.requests.length, sleeps], [429, 900, 1, []]);
    assert.match(error.toMcpError(), /retry after 900 s/);
  } finally {
    await api.close();
  }
});

test("a 2xx whose body is cut off is a typed error that says the job may be running, never a bare TypeError", async () => {
  const api = await startFakeApi(() => (res) => {
    res.writeHead(200, { "content-type": "application/json", "content-length": "60" });
    res.write('{"generation_id":"g'); // the headers and the first bytes reach the client before the connection drops
    setTimeout(() => res.destroy(), 30);
  });
  try {
    const { options } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" })).catch((e) => e);
    assert.ok(error instanceof IdeogramApiError, `${error?.constructor?.name}: ${error?.message}`);
    assert.equal(error.code, "RESPONSE_READ_FAILED");
    assert.match(error.message, /may be running and billed/);
    assert.equal(api.requests.length, 1, "not sent again");
  } finally {
    await api.close();
  }
});

test("a POST has one 55 s deadline: 429s with Retry-After 20 are retried twice, the third sleep would end past it", async () => {
  const api = await startFakeApi(() => ({ status: 429, headers: { "retry-after": "20" }, json: INFLIGHT }));
  try {
    const { options, sleeps, budget } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" }), budget).catch((e) => e);
    assert.equal(TOOL_CALL_MS, 55_000);
    assert.deepEqual(sleeps, [20000, 20000], "40 s slept; a third 20 s sleep plus an attempt would pass 55 s");
    assert.deepEqual([error.status, error.details.retryAfterS, api.requests.length], [429, 20, 3]);
  } finally {
    await api.close();
  }
});

test("the call's budget bounds one attempt below the client's timeout: a hanging poll fails within it", async () => {
  const api = await startFakeApi(() => () => {}); // never answers
  try {
    const { options } = testClientOptions(api.base, { maxRetries: 0, requestTimeoutMs: 60_000 });
    const op = operationById("get_generation_v2");
    const started = Date.now();
    const error = await new IdeogramClient(options).call(request(op, null, { path: { generation_id: "g" } }), realBudget(150)).catch((e) => e);
    assert.equal(error.code, "CALL_TIMEOUT");
    assert.match(error.message, /time ran out while the request was in flight/);
    assert.ok(Date.now() - started < 5_000, "failed on the call's deadline, not the client's timeout");
  } finally {
    await api.close();
  }
});

test("a 2xx POST answered with a non-JSON body is INVALID_JSON and says the job may be billed", async () => {
  const api = await startFakeApi(() => ({ status: 200, headers: { "content-type": "text/html" }, body: "<html>gateway</html>" }));
  try {
    const { options } = testClientOptions(api.base);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" })).catch((e) => e);
    assert.equal(error.code, "INVALID_JSON");
    assert.match(error.message, /may be running and billed/);
  } finally {
    await api.close();
  }
});

test("the call's budget is the whole budget: a hanging poll is not retried past it", async () => {
  const api = await startFakeApi(() => () => {});
  try {
    const { options, sleeps } = testClientOptions(api.base, { maxRetries: 3, requestTimeoutMs: 60_000 });
    const op = operationById("get_generation_v2");
    const started = Date.now();
    const error = await new IdeogramClient(options).call(request(op, null, { path: { generation_id: "g" } }), realBudget(300)).catch((e) => e);
    assert.equal(error.code, "CALL_TIMEOUT");
    assert.ok(Date.now() - started < 3_000, `${Date.now() - started} ms: no second 300 ms attempt after the first used the budget`);
    assert.ok(api.requests.length <= 2, `${api.requests.length} attempts`);
    assert.deepEqual(sleeps, [], "no retry sleep: the budget was spent");
  } finally {
    await api.close();
  }
});

test("the deadline counts attempt time, not sleep alone: a 429 answered after 40 s with Retry-After 30 is not resent", async () => {
  const slowApi = await startFakeApi(() => ({ status: 429, headers: { "retry-after": "30" }, json: INFLIGHT }));
  try {
    const { options, sleeps, clock, budget } = testClientOptions(slowApi.base);
    // the first attempt "takes" 40 s on the fake clock: the server advances it before answering
    slowApi.server.on("request", () => { clock.t += 40_000; });
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" }), budget).catch((e) => e);
    assert.deepEqual([error.status, error.details.retryAfterS, slowApi.requests.length, sleeps], [429, 30, 1, []], "40 + 30 + 1 > 55: no resend at 70 s");
  } finally {
    await slowApi.close();
  }
});

test("a download 429 honours Retry-After inside the download's deadline", async () => {
  const api = await startFakeApi((_req, n) => (n === 1 ? { status: 429, headers: { "retry-after": "5" }, json: {} } : { status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  try {
    const { options, sleeps, budget } = testClientOptions(api.base);
    const saved = await new IdeogramClient(options).download(`${api.base}/x.png`, join(dir, "ra"), budget);
    assert.equal(saved.bytes, PNG.length);
    assert.deepEqual(sleeps, [5000], "Retry-After, not the exponential step");
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

test("the caller's cancellation aborts the attempt and nothing is resent: CANCELLED, one request", async () => {
  const api = await startFakeApi(() => () => {}); // never answers
  try {
    const { options, sleeps, clock } = testClientOptions(api.base, { maxRetries: 3 });
    const cancel = new AbortController();
    const budget = toolCallBudget(clock, cancel.signal);
    setTimeout(() => cancel.abort(), 50);
    const error = await new IdeogramClient(options).call(request(generateOp, { prompt: "x" }), budget).catch((e) => e);
    assert.deepEqual([error.code, api.requests.length, sleeps], ["CANCELLED", 1, []]);
    assert.match(error.message, /cancelled by the caller/);
  } finally {
    await api.close();
  }
});

test("a budget already spent makes no request at all: CALL_TIMEOUT before the first attempt, for a call and a download", async () => {
  const api = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  try {
    const { options, clock } = testClientOptions(api.base);
    const budget = toolCallBudget(clock);
    clock.t += TOOL_CALL_MS + 1;
    const client = new IdeogramClient(options);
    const call = await client.call(request(generateOp, { prompt: "x" }), budget).catch((e) => e);
    const download = await client.download(`${api.base}/x.png`, join(dir, "spent"), budget).catch((e) => e);
    assert.deepEqual([call.code, download.code, api.requests.length], ["CALL_TIMEOUT", "CALL_TIMEOUT", 0]);
  } finally {
    await api.close();
  }
});
