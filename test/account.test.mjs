// The account tools against the fake API: the usage query as sent (defaults, arrays repeated), the sums as decimal
// strings, the buckets handed on unchanged, a contract mismatch reported, the admin-only listings' 404 said as such.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeApi, testContext, tool } from "./support/fake-api.mjs";

async function call(name, args, handler) {
  const api = await startFakeApi((req, n) => handler(req, n, api));
  try {
    const ctx = await testContext(api.base, "/tmp/unused");
    const result = await (await tool(name)).handler(ctx, args);
    return { result, requests: api.requests };
  } finally {
    await api.close();
  }
}
const text = (result) => result.content.map((c) => c.text).join("\n");

const usage = {
  buckets: [
    { start_time: "2026-10-03T00:00:00Z", end_time: "2026-10-04T00:00:00Z", line_items: [
      { product: "ideogram_v3_generation", description: "Ideogram 3.0 generation", endpoint: "/v2/image/generate/ideogram-3", cost_total: "0.120000", currency_code: "USD", source: "api", billed_units: { unit: "image", quantity: "2", unit_price: "0.060000" }, api_key: { id: "k1", redacted_key: "ideo••••" } },
      { product: "api_remove_background", description: "Background removal", endpoint: "/v2/image/remove-background/ideogram-1", cost_total: "0.010000", currency_code: "USD", source: "api", billed_units: { unit: "image", quantity: "1", unit_price: "0.010000" } },
    ] },
    { start_time: "2026-10-04T00:00:00Z", end_time: "2026-10-05T00:00:00Z", line_items: [] },
    { start_time: "2026-10-05T00:00:00Z", end_time: "2026-10-06T00:00:00Z", line_items: [
      { product: "ideogram_v3_generation", description: "Ideogram 3.0 generation", endpoint: "/v2/image/generate/ideogram-3", cost_total: "0.060000", currency_code: "USD", source: "app", user_email: "a@b.c", billed_units: { unit: "image", quantity: "1", unit_price: "0.060000" } },
    ] },
  ],
};

test("ideogram_usage: the default range is the last 7 days from midnight UTC, by day; the query carries what is given, arrays repeated", async () => {
  const { requests } = await call("ideogram_usage", {}, () => ({ json: usage }));
  const url = new URL(requests[0].url, "http://x");
  assert.equal(url.pathname, "/v2/account/usage");
  assert.match(url.searchParams.get("start_time"), /^\d{4}-\d\d-\d\dT00:00:00Z$/);
  assert.equal(url.searchParams.has("bucket_width"), false);
  const given = await call("ideogram_usage", { start_time: "2026-10-01T00:00:00Z", end_time: "2026-10-08T00:00:00Z", bucket_width: "1h", sources: ["api", "app"] }, () => ({ json: usage }));
  const q = new URL(given.requests[0].url, "http://x").searchParams;
  assert.deepEqual([q.get("start_time"), q.get("end_time"), q.get("bucket_width"), q.getAll("sources")], ["2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z", "1h", ["api", "app"]]);
});

test("ideogram_usage sums per product and per currency as decimals and hands the buckets on unchanged", async () => {
  const { result } = await call("ideogram_usage", { start_time: "2026-10-03T00:00:00Z" }, () => ({ json: usage }));
  const out = text(result);
  assert.match(out, /Usage from 2026-10-03T00:00:00Z to 2026-10-06T00:00:00Z: 3 bucket\(s\) of 1d, 3 line item\(s\)\./);
  assert.match(out, /ideogram_v3_generation \(Ideogram 3\.0 generation, \/v2\/image\/generate\/ideogram-3\): 0\.18 USD · 3 image/);
  assert.match(out, /api_remove_background .*: 0\.01 USD · 1 image/);
  assert.match(out, /Total: 0\.19 USD/);
  const json = out.split("Buckets as Ideogram reports them (the shape ai-cost reads):\n")[1];
  assert.deepEqual(JSON.parse(json), usage.buckets, "the buckets as received");
  assert.equal(result.isError, undefined);
});

test("ideogram_usage: a bad time is refused before any request; a body off the schema is a contract mismatch, not a success", async () => {
  const bad = await call("ideogram_usage", { start_time: "yesterday" }, () => ({ json: usage }));
  assert.equal(bad.result.isError, true);
  assert.match(text(bad.result), /start_time.*RFC 3339/s);
  assert.equal(bad.requests.length, 0);
  const off = await call("ideogram_usage", {}, () => ({ json: { buckets: [{ start_time: "x" }] } }));
  assert.equal(off.result.isError, true);
  assert.match(text(off.result), /does not match its own specification/);
});

test("ideogram_invoices and ideogram_api_keys list what the API returns; a 404 says the key must be an organization admin's", async () => {
  const invoices = { invoices: [{ start_time: "2026-09-01T00:00:00Z", end_time: "2026-10-01T00:00:00Z", issued_time: "2026-10-01T00:00:00Z", paid_time: "2026-10-02T00:00:00Z", status: "paid", total: "12.34", currency_code: "USD", line_items: [{ description: "Ideogram 3.0 generation", cost_total: "12.34", currency_code: "USD", quantity: "205", unit_price: "0.06" }] }] };
  const inv = await call("ideogram_invoices", {}, () => ({ json: invoices }));
  assert.match(text(inv.result), /1 invoice\(s\)\.\n2026-09-01T00:00:00Z → 2026-10-01T00:00:00Z: 12\.34 USD, paid, paid 2026-10-02T00:00:00Z \(1 line item\(s\)\)/);
  const keys = { api_keys: [{ api_key_id: "a2V5", creation_time: "2026-09-01T00:00:00Z", redacted_api_key: "ideo••••", status: "active", label: "ci", creator_display_label: "qmt" }] };
  const k = await call("ideogram_api_keys", {}, () => ({ json: keys }));
  assert.match(text(k.result), /1 API key\(s\).*\nideo•••• \(a2V5\) active "ci", created 2026-09-01T00:00:00Z by qmt/);
  const denied = await call("ideogram_invoices", {}, () => ({ status: 404, json: { error: "not found" } }));
  assert.equal(denied.result.isError, true);
  assert.match(text(denied.result), /needs an API key whose owner is an organization admin/);
});

test("decimal sums never go through floats: 0.1 + 0.2 is 0.3, nine places kept, a non-decimal refused", async () => {
  const { decimalUnits, unitsText } = await import("../dist/tools/account.js");
  assert.equal(unitsText(decimalUnits("0.1") + decimalUnits("0.2")), "0.3");
  assert.equal(unitsText(decimalUnits("1.000000001") + decimalUnits("2")), "3.000000001");
  assert.equal(unitsText(decimalUnits("-0.5") + decimalUnits("0.25")), "-0.25");
  assert.throws(() => decimalUnits("1e3"), /not a decimal amount/);
});
