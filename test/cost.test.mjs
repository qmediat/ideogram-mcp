// Prices from dry_run: the quote call, the decimal strings (never floats), the refusal of an operation that cannot
// be quoted without running it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeApi, testClientOptions, openBudget } from "./support/fake-api.mjs";

const { IdeogramClient } = await import("../dist/client.js");
const { quote, decimalString, microsToUsd, millisToCredits } = await import("../dist/cost.js");
const { operationById } = await import("../dist/spec/operations.js");

const req = (id, fields) => ({ op: operationById(id), path: {}, query: {}, headers: {}, body: { media: "json", fields, files: [], jsonParts: [] }, dryRun: false });

test("decimal strings: micros to 6 places, millis to 3, exact for amounts a float cannot hold", () => {
  assert.equal(microsToUsd(60000), "0.060000");
  assert.equal(microsToUsd(0), "0.000000");
  assert.equal(microsToUsd(123456789n), "123.456789");
  assert.equal(millisToCredits(60), "0.060");
  assert.equal(decimalString(9007199254740993n, 6), "9007199254.740993");
  assert.equal(decimalString(-5, 3), "-0.005");
  assert.throws(() => decimalString(0.5, 6), /not an integer/);
});

test("a quote sends dry_run=true and returns USD and credits as decimal strings", async () => {
  const api = await startFakeApi(() => ({
    json: { object: "price_quote", billing_identifier: "ideogram-3-default", quantity: 2, usd_micros: 120000, credit_millis: 120, qualifier: "estimate", upper_bound_usd_micros: 150000 },
  }));
  try {
    const client = new IdeogramClient(testClientOptions(api.base).options);
    const outcome = await quote(client, req("post_generate_image_v2_ideogram_v3", { prompt: "x", num_images: 2 }), openBudget());
    assert.equal(api.requests[0].url, "/v2/image/generate/ideogram-3?dry_run=true");
    assert.deepEqual(outcome, {
      kind: "quote",
      quote: { operation: "post_generate_image_v2_ideogram_v3", model: "ideogram-3", billingIdentifier: "ideogram-3-default", quantity: 2, usd: "0.120000", credits: "0.120", qualifier: "estimate", upperBoundUsd: "0.150000" },
    });
  } finally {
    await api.close();
  }
});

test("an operation without dry_run (describe) is refused locally: a quote request could run and bill it", async () => {
  const api = await startFakeApi(() => ({ json: {} }));
  try {
    const client = new IdeogramClient(testClientOptions(api.base).options);
    await assert.rejects(() => quote(client, req("post_describe_image_ideogram_v3", {}), openBudget()), /does not declare dry_run/);
    assert.equal(api.requests.length, 0);
  } finally {
    await api.close();
  }
});

test("a dry run answered with something other than a PriceQuote is a ContractMismatch", async () => {
  const api = await startFakeApi(() => ({ json: { generation_id: "g", seed: 1 } }));
  try {
    const client = new IdeogramClient(testClientOptions(api.base).options);
    const outcome = await quote(client, req("post_generate_image_v2_ideogram_v3", { prompt: "x" }), openBudget());
    assert.equal(outcome.kind, "contract_mismatch");
  } finally {
    await api.close();
  }
});
