// A generation from request to outcome against a fake API: sync, async → completed, async → failed, a bounded wait
// that ends Pending with the id, a body the schema rejects → ContractMismatch, the poll schedule.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeApi, testClientOptions, fakeClock } from "./support/fake-api.mjs";

const { IdeogramClient } = await import("../dist/client.js");
const { execute, resume, asAsync, fetchGeneration, POLL_CAP_MS } = await import("../dist/lifecycle.js");
const { operationById } = await import("../dist/spec/operations.js");
const { COUNTERS } = await import("../dist/counters.js");

const op = (id) => operationById(id);
const jsonRequest = (operation, fields) => ({
  op: operation,
  path: {},
  query: {},
  headers: {},
  body: { media: "json", fields, files: [], jsonParts: [] },
  dryRun: false,
});
const image = { url: "https://ideogram.ai/api/images/a.png", prompt: "p", resolution: "1024x1024", is_image_safe: true, seed: 3 };
/** A polled item carries its kind (the spec's discriminator); a synchronous one does not. */
const polledImage = { ...image, object_type: "image.generation" };

async function run(handler, req, waitS = 45) {
  const api = await startFakeApi(handler);
  try {
    const clock = fakeClock();
    const client = new IdeogramClient(testClientOptions(api.base).options);
    const outcome = await execute(client, req, { waitS, clock });
    return { outcome, requests: api.requests, clock };
  } finally {
    await api.close();
  }
}

test("a synchronous operation (describe) completes in one call", async () => {
  const body = { created: "2026-10-07T00:00:00Z", description_id: "d1", descriptions: [{ text: "a red door" }] };
  const { outcome, requests } = await run(() => ({ json: body }), jsonRequest(op("post_describe_image_ideogram_v3"), {}));
  assert.equal(outcome.kind, "completed");
  assert.deepEqual(outcome.payload, { kind: "description", descriptionId: "d1", texts: ["a red door"], jsonPrompt: null });
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].body).async, undefined, "describe takes no async field");
});

test("an async-capable generation is sent with async: true, returns at acceptance, then completes by polling", async () => {
  const handler = (req, n) => {
    if (req.method === "POST") return { json: { generation_id: "g1", seed: 3 } };
    if (n === 2) return { json: { generation_id: "g1", status: "pending", created: "2026-10-07T00:00:00Z" } };
    return { json: { generation_id: "g1", status: "completed", created: "2026-10-07T00:00:00Z", response_type: "url", usage_cost_usd_micros: 60000, data: [polledImage] } };
  };
  const { outcome, requests, clock } = await run(handler, jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "a cat" }));
  assert.equal(JSON.parse(requests[0].body).async, true);
  assert.deepEqual(requests.slice(1).map((r) => r.url), ["/v2/generations/g1", "/v2/generations/g1"]);
  assert.equal(outcome.kind, "completed");
  assert.equal(outcome.generationId, "g1");
  assert.equal(outcome.usageCostUsdMicros, 60000n);
  assert.deepEqual(outcome.payload.items.map((i) => [i.url, i.seed, i.isImageSafe]), [[image.url, 3, true]]);
  assert.deepEqual(clock.sleeps, [2000, 3000], "2 s, then ×1.5");
});

test("a failed generation is Failed with the API's reason", async () => {
  const handler = (req) =>
    req.method === "POST"
      ? { json: { generation_id: "g2", seed: 1 } }
      : { json: { generation_id: "g2", status: "failed", created: "2026-10-07T00:00:00Z", failure_reason: "content_policy_violation" } };
  const { outcome } = await run(handler, jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x" }));
  assert.deepEqual(outcome, { kind: "failed", generationId: "g2", failureReason: "content_policy_violation" });
});

test("a wait that runs out ends Pending with the generation id, and the schedule is 2 s ×1.5", async () => {
  const pending = { generation_id: "g3", status: "pending", created: "2026-10-07T00:00:00Z" };
  const handler = (req) => (req.method === "POST" ? { json: { generation_id: "g3", seed: 1 } } : { json: pending });
  const { outcome, clock } = await run(handler, jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x" }), 20);
  assert.deepEqual(outcome, { kind: "pending", generationId: "g3", note: null });
  assert.deepEqual(clock.sleeps, [2000, 3000, 4500, 6750], "the next delay (10.1 s) would pass the 20 s deadline");
});

test("wait_s 0 returns the id at acceptance without polling; wait_s over 50 is held to 50", async () => {
  const handler = (req) => (req.method === "POST" ? { json: { generation_id: "g4", seed: 1 } } : { json: { generation_id: "g4", status: "pending", created: "2026-10-07T00:00:00Z" } });
  const zero = await run(handler, jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x" }), 0);
  assert.deepEqual([zero.outcome.kind, zero.requests.length], ["pending", 1]);
  const long = await run(handler, jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x" }), 600);
  assert.ok(long.clock.t <= 50_000, `waited ${long.clock.t} ms`);
});

test("an acknowledgement-only operation (replace background) is polled although it takes no async field", async () => {
  const handler = (req) =>
    req.method === "POST"
      ? { json: { generation_id: "g5" } }
      : { json: { generation_id: "g5", status: "completed", created: "2026-10-07T00:00:00Z", data: [polledImage] } };
  const { outcome, requests } = await run(handler, jsonRequest(op("post_replace_background_ideogram_v3"), { prompt: "beach" }));
  assert.equal(JSON.parse(requests[0].body).async, undefined);
  assert.equal(outcome.kind, "completed");
});

test("a 2xx body the generated schema rejects is a ContractMismatch, never a success, and it is counted", async () => {
  const before = COUNTERS.contractMismatches;
  const { outcome } = await run(() => ({ json: { generation_id: "g6", seed: "not-a-number", data: [] } }), jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x" }));
  assert.equal(outcome.kind, "contract_mismatch");
  assert.equal(outcome.generationId, "g6", "the id is kept so the paid job is not lost");
  assert.match(outcome.issues.join("\n"), /^seed: /m);
  assert.equal(COUNTERS.contractMismatches, before + 1);
});

test("a completed poll in the API's real shape (created with a +00:00 offset and microseconds, asset_id null) is Completed", async () => {
  // Captured live 2026-10-07 (values anonymised): the spec's example and the generator's z.iso.datetime() disagree on the offset form.
  const real = {
    created: "2026-10-07T15:09:24.239178+00:00", generation_id: "gReal", status: "completed", response_type: "url",
    data: [{ asset_id: null, is_image_safe: true, object_type: "image.generation", prompt: "p", resolution: "1024x1024", seed: 7, url: "https://ideogram.ai/api/images/a.png" }],
  };
  const handler = (req) => (req.method === "POST" ? { json: { generation_id: "gReal", seed: 7 } } : { json: real });
  const { outcome } = await run(handler, jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x" }));
  assert.equal(outcome.kind, "completed", JSON.stringify(outcome).slice(0, 300));
  assert.equal(outcome.payload.items[0].seed, 7);
});

test("a poll answered 503 keeps the id as pending with the error; a 404 is the answer about the id and is thrown", async () => {
  const flaky = await startFakeApi(() => ({ status: 503, json: { message: "upstream" } }));
  const gone = await startFakeApi(() => ({ status: 404, json: { message: "no such generation" } }));
  try {
    const pending = await resume(new IdeogramClient(testClientOptions(flaky.base).options), "gX", { waitS: 10, clock: fakeClock() });
    assert.equal(pending.kind, "pending");
    assert.match(pending.note, /upstream/);
    const error = await resume(new IdeogramClient(testClientOptions(gone.base).options), "gX", { waitS: 10, clock: fakeClock() }).catch((e) => e);
    assert.equal(error.status, 404, "a 404 is never 'still running'");
    assert.match(error.message, /no such generation/);
  } finally {
    await flaky.close();
    await gone.close();
  }
  assert.equal(POLL_CAP_MS, 30_000);
});

test("asAsync adds async: true only when the caller left it unset; an explicit async: false (ideogram_api) is kept", () => {
  const req = jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x" });
  assert.equal(asAsync(req).body.fields.async, true);
  const explicit = jsonRequest(op("post_generate_image_v2_ideogram_v3"), { prompt: "x", async: false });
  assert.equal(asAsync(explicit).body.fields.async, false);
});

test("a poll carries the wait's remaining time as its timeout: a hanging API ends the poll as pending with the timeout noted", async () => {
  const api = await startFakeApi(() => () => {});
  try {
    const client = new IdeogramClient(testClientOptions(api.base, { maxRetries: 0, requestTimeoutMs: 60_000 }).options);
    const started = Date.now();
    const outcome = await fetchGeneration(client, "gHang", 200);
    assert.equal(outcome.kind, "pending");
    assert.match(outcome.note, /TimeoutError/);
    assert.ok(Date.now() - started < 5_000);
  } finally {
    await api.close();
  }
});
