// The account tools against the fake API: the usage query as sent (defaults, arrays repeated), the sums as decimal
// strings, the buckets handed on unchanged, a contract mismatch reported, the admin-only listings' 404 said as such.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeApi, testContext, tool } from "./support/fake-api.mjs";

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

const dir = await mkdtemp(join(tmpdir(), "ideogram-account-"));
after(() => rm(dir, { recursive: true, force: true }));

async function call(name, args, handler) {
  const api = await startFakeApi((req, n) => handler(req, n, api));
  try {
    const ctx = await testContext(api.base, join(dir, `out-${Math.random().toString(16).slice(2)}`));
    const result = await (await tool(name)).handler(ctx, args);
    return { result, requests: api.requests, ctx };
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

test("ideogram_usage: the default range is the last 7 days from midnight UTC by day (24 hours from the hour at 1h); the query carries what is given, arrays repeated", async () => {
  const { requests } = await call("ideogram_usage", {}, () => ({ json: usage })); // the fake clock's now is the epoch
  const url = new URL(requests[0].url, "http://x");
  assert.equal(url.pathname, "/v2/account/usage");
  assert.equal(url.searchParams.get("start_time"), "1969-12-25T00:00:00Z");
  assert.equal(url.searchParams.has("bucket_width"), false);
  assert.equal(url.searchParams.get("end_time"), "1970-01-01T00:00:00Z", "the end is always sent: the span the tool checked is the span the API sees");
  const hourly = await call("ideogram_usage", { bucket_width: "1h" }, () => ({ json: usage }));
  assert.equal(new URL(hourly.requests[0].url, "http://x").searchParams.get("start_time"), "1969-12-31T00:00:00Z", "24 hours before the epoch, on the hour");
  const ended = await call("ideogram_usage", { end_time: "2026-10-08T12:30:00Z" }, () => ({ json: usage }));
  assert.equal(new URL(ended.requests[0].url, "http://x").searchParams.get("start_time"), "2026-10-01T00:00:00Z", "7 days before the given end");
  const given = await call("ideogram_usage", { start_time: "2026-10-01T00:00:00Z", end_time: "2026-10-08T00:00:00Z", bucket_width: "1h", sources: ["api", "app"] }, () => ({ json: usage }));
  const q = new URL(given.requests[0].url, "http://x").searchParams;
  assert.deepEqual([q.get("start_time"), q.get("end_time"), q.get("bucket_width"), q.getAll("sources")], ["2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z", "1h", ["api", "app"]]);
});

test("ideogram_usage sums per product, unit and currency as decimals, hands the buckets on exactly as received (unknown fields kept) in a file and inline, counts an amount it cannot read", async () => {
  const sent = { buckets: usage.buckets.map((b, i) => (i === 0 ? { ...b, line_items: [...b.line_items, { product: "odd", description: "Odd", endpoint: "/x", cost_total: "1e3", currency_code: "USD", source: "api" }, { product: "half", description: "Half", endpoint: "/y", cost_total: "0.5", currency_code: "USD", source: "api", billed_units: { unit: "image", quantity: "+2", unit_price: "0.25" } }], provider_note: "kept" } : b)) };
  const { result, ctx } = await call("ideogram_usage", { start_time: "2026-10-03T00:00:00Z", end_time: "2026-10-06T00:00:00Z" }, () => ({ json: sent }));
  const out = text(result);
  assert.match(out, /Usage from 2026-10-03T00:00:00Z to 2026-10-06T00:00:00Z: 3 bucket\(s\) of 1d, 5 line item\(s\)\./);
  assert.match(out, /ideogram_v3_generation \(Ideogram 3\.0 generation, \/v2\/image\/generate\/ideogram-3\): 0\.18 USD · 3 image/);
  assert.match(out, /api_remove_background .*: 0\.01 USD · 1 image/);
  assert.match(out, /half \(Half, \/y\): 0\.5 USD\n/, "the cost of a line with an unreadable quantity is summed, its units are not");
  assert.match(out, /Total: 0\.69 USD/);
  assert.match(out, /2 amount\(s\) not summed \(not a decimal the sums read\): odd: cost_total 1e3 \(the line's cost left out\); half: quantity \+2 \(its cost is summed, its units are not\)/);
  const [head, json] = out.split(/Buckets as Ideogram sent them \(the shape ai-cost reads\): (\S+) \(\d+ bytes, owner-readable\)\n/).slice(1);
  assert.deepEqual(JSON.parse(json), sent.buckets, "the buckets as received, the unknown field kept");
  const files = await readdir(ctx.outputDir);
  assert.deepEqual(files, ["ideogram-usage-2026-10-03T000000Z-2026-10-06T000000Z--.json"], "named by the whole query");
  const { stat } = await import("node:fs/promises");
  assert.equal((await stat(join(ctx.outputDir, files[0]))).mode & 0o777, 0o600, "owner-readable");
  const again = await call("ideogram_usage", { start_time: "2026-10-03T00:00:00Z", end_time: "2026-10-06T00:00:00Z", bucket_width: "1h", sources: ["api"] }, () => ({ json: sent }));
  assert.deepEqual(await readdir(again.ctx.outputDir), ["ideogram-usage-2026-10-03T000000Z-2026-10-06T000000Z-1h-api.json"], "another width or source is another file");
  assert.deepEqual(JSON.parse(await readFile(join(ctx.outputDir, files[0]), "utf8")), sent.buckets, "the file is the same JSON");
  assert.ok(head.endsWith(files[0]));
  assert.equal(result.isError, undefined);
});

test("ideogram_usage: a large buckets JSON is written to the file and not printed; an empty answer says no bucket; a 404 names the admin key", async () => {
  const many = { buckets: Array.from({ length: 92 }, (_, i) => ({ start_time: `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`, end_time: "2026-10-01T00:00:00Z", line_items: Array.from({ length: 12 }, (_, j) => ({ product: `p${j}`, description: "x".repeat(40), endpoint: "/v2/image/generate/ideogram-3", cost_total: "0.06", currency_code: "USD", source: "api", billed_units: { unit: "image", quantity: "1", unit_price: "0.06" } })) })) };
  const { result } = await call("ideogram_usage", { start_time: "2026-07-01T00:00:00Z", end_time: "2026-10-01T00:00:00Z" }, () => ({ json: many }));
  assert.match(text(result), /not printed here, over 65536 bytes/);
  assert.doesNotMatch(text(result), /"product": "p0"/);
  const empty = await call("ideogram_usage", {}, () => ({ json: { buckets: [] } }));
  assert.match(text(empty.result), /Ideogram listed no bucket for this range\./);
  const denied = await call("ideogram_usage", {}, () => ({ status: 404, json: { error: "not found" } }));
  assert.equal(denied.result.isError, true);
  assert.match(text(denied.result), /Reading the usage needs an API key whose owner is an organization admin/);
});

test("ideogram_usage: a bad time, a range over the API's span, a start after the end and an empty sources are refused before any request; a body off the schema is a contract mismatch, not a success", async () => {
  const bad = await call("ideogram_usage", { start_time: "yesterday" }, () => ({ json: usage }));
  assert.equal(bad.result.isError, true);
  assert.match(text(bad.result), /start_time.*RFC 3339/s);
  assert.equal(bad.requests.length, 0);
  const long = await call("ideogram_usage", { start_time: "2026-01-01T00:00:00Z", end_time: "2026-06-01T00:00:00Z" }, () => ({ json: usage }));
  assert.match(text(long.result), /spans more than 92 days/);
  const longHourly = await call("ideogram_usage", { start_time: "2026-10-01T00:00:00Z", end_time: "2026-10-09T00:00:00Z", bucket_width: "1h" }, () => ({ json: usage }));
  assert.match(text(longHourly.result), /spans more than 168 hours/);
  const backwards = await call("ideogram_usage", { start_time: "2026-10-09T00:00:00Z", end_time: "2026-10-01T00:00:00Z" }, () => ({ json: usage }));
  assert.match(text(backwards.result), /is not before the end/);
  const none = await call("ideogram_usage", { sources: [] }, () => ({ json: usage }));
  assert.match(text(none.result), /sources/);
  assert.equal(long.requests.length + longHourly.requests.length + backwards.requests.length + none.requests.length, 0);
  const off = await call("ideogram_usage", {}, () => ({ json: { buckets: [{ start_time: "x" }] } }));
  assert.equal(off.result.isError, true);
  assert.match(text(off.result), /does not match its own specification/);
  assert.match(text(off.result), /As Ideogram sent it \(shown although it is off the specification\):\n\{\n  "buckets"/, "a listing off its schema still shows the data");
});

test("ideogram_invoices and ideogram_api_keys list what the API returns; a 404 says the key must be an organization admin's", async () => {
  const invoices = { invoices: [{ start_time: "2026-09-01T00:00:00Z", end_time: "2026-10-01T00:00:00Z", issued_time: "2026-10-01T00:00:00Z", paid_time: "2026-10-02T00:00:00Z", status: "paid", total: "12.34", currency_code: "USD", line_items: [{ description: "Ideogram 3.0 generation", cost_total: "12.34", currency_code: "USD", quantity: "205", unit_price: "0.06" }] }] };
  const inv = await call("ideogram_invoices", {}, () => ({ json: invoices }));
  assert.match(text(inv.result), /1 invoice\(s\)\.\n2026-09-01T00:00:00Z → 2026-10-01T00:00:00Z: 12\.34 USD, paid, paid 2026-10-02T00:00:00Z \(1 line item\(s\)\)/);
  assert.match(text(inv.result), /"description": "Ideogram 3\.0 generation"/, "the invoices as sent follow");
  const keys = { api_keys: [{ api_key_id: "a2V5", creation_time: "2026-09-01T00:00:00Z", redacted_api_key: "ideo••••", status: "active", label: "ci", creator_display_label: "qmt" }] };
  const k = await call("ideogram_api_keys", {}, () => ({ json: keys }));
  assert.match(text(k.result), /1 API key\(s\).*\nideo•••• \(a2V5\) active "ci", created 2026-09-01T00:00:00Z by qmt/);
  const denied = await call("ideogram_invoices", {}, () => ({ status: 404, json: { error: "not found" } }));
  assert.equal(denied.result.isError, true);
  assert.match(text(denied.result), /needs an API key whose owner is an organization admin .*\(its answer: .*not found/);
});

test("decimal sums never go through floats: 0.1 + 0.2 is 0.3, nine places kept, a non-decimal is null", async () => {
  const { decimalUnits, unitsText } = await import("../dist/tools/account.js");
  assert.equal(unitsText(decimalUnits("0.1") + decimalUnits("0.2")), "0.3");
  assert.equal(unitsText(decimalUnits("1.000000001") + decimalUnits("2")), "3.000000001");
  assert.equal(unitsText(decimalUnits("-0.5") + decimalUnits("0.25")), "-0.25");
  assert.equal(unitsText(decimalUnits("12")), "12");
  for (const whole of ["10", "20", "100", "1000"]) assert.equal(unitsText(decimalUnits(whole)), whole, "trailing zeros of the integer part stay");
  for (const bad of ["1e3", "+1", "1.0000000001", ""]) assert.equal(decimalUnits(bad), null, bad);
});
