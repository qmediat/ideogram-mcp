/**
 * The account tools (step 2 of docs/DESIGN-ideogram-v2.md): usage and spend as the API bills it, the invoices, the
 * API keys. Reads only — a GET with query parameters checked against the operation's generated schema and the API's
 * stated range limits, the answer against its response schema (a mismatch is reported, never passed off), nothing
 * generated or billed; all three need an organization-admin key (Ideogram answers 404 to any other, said as such).
 * ideogram_usage sums what the buckets carry (decimal strings, never floats; an amount it cannot read is counted,
 * not summed) and hands the buckets on exactly as received — written to a file in the output directory, inline too
 * when small: the shape ai-cost reads.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiRequest } from "../client.js";
import { decimalString } from "../cost.js";
import { IdeogramApiError } from "../errors.js";
import { zGetAccountUsageResponse, zListAccountApiKeysResponse, zListAccountInvoicesResponse } from "../generated/zod.gen.js";
import { contractMismatch } from "../lifecycle.js";
import { operationById } from "../spec/operations.js";
import type { Operation } from "../spec/operations.js";
import type { QueryValue } from "../wire.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import type { ToolArguments } from "./family.js";
import { jsonText, outcomeResult, textResult } from "./results.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PLACES = 9; // every amount the API sends fits nine decimals
const SCALE = 10n ** BigInt(PLACES);
/** The buckets' JSON is printed inline up to this size; above it the file in the output directory is the answer. */
const INLINE_JSON_BYTES = 64 * 1024;

/** The API's range rules per bucket width: the default window this tool asks for, and the most one request may span. */
const WIDTHS = {
  "1d": { defaultMs: 7 * DAY_MS, maxMs: 92 * DAY_MS, limit: "92 days" },
  "1h": { defaultMs: 24 * HOUR_MS, maxMs: 168 * HOUR_MS, limit: "168 hours" },
} as const;
type Width = keyof typeof WIDTHS;

function operation(id: string): Operation {
  const op = operationById(id);
  if (op === null) throw new Error(`the snapshot lacks ${id}`);
  return op;
}

const USAGE = operation("get_account_usage");
const INVOICES = operation("get_account_invoices");
const API_KEYS = operation("get_account_api_keys");

/** A decimal string as scaled integer units (nine places), or null for what is not such a decimal. */
export function decimalUnits(text: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (m === null) return null;
  const [, sign, whole, fraction = ""] = m;
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(PLACES, "0"));
  return sign === "-" ? -units : units;
}

/** Scaled units as a decimal string without trailing zeros. */
export function unitsText(units: bigint): string {
  return decimalString(units, PLACES).replace(/\.?0+$/, "");
}

/** One GET of the operation with its query; the answer parsed by the schema (and kept raw), or a contract mismatch. */
async function read<T extends z.ZodType>(ctx: ToolContext, op: Operation, query: Readonly<Record<string, QueryValue>>, schema: T): Promise<{ ok: true; data: z.infer<T>; raw: unknown } | { ok: false; result: CallToolResult }> {
  const req: ApiRequest = { op, path: {}, query, headers: {}, body: null, dryRun: false };
  const answer = await ctx.client.call(req, ctx.budget);
  const parsed = schema.safeParse(answer.body);
  if (parsed.success) return { ok: true, data: parsed.data as z.infer<T>, raw: answer.body };
  return { ok: false, result: await outcomeResult(ctx, contractMismatch(answer.status, answer.body, parsed.error), []) };
}

/** The three listings answer 404 to a key another member owns: said as such, with the API's own words. */
function adminOnly(error: unknown, what: string): CallToolResult | null {
  if (error instanceof IdeogramApiError && error.status === 404) {
    return textResult(`${what} needs an API key whose owner is an organization admin — Ideogram answers 404 to a key owned by another member (its answer: ${error.message}).`, true);
  }
  return null;
}

type Usage = z.infer<typeof zGetAccountUsageResponse>;
type LineItem = Usage["buckets"][number]["line_items"][number];

interface ProductTotal {
  product: string;
  description: string;
  endpoint: string;
  currency: string;
  unit: string | null;
  cost: bigint;
  quantity: bigint | null;
  items: number;
}

interface Sums {
  readonly totals: Map<string, ProductTotal>;
  unreadable: string[];
}

function addLine(sums: Sums, item: LineItem): void {
  const cost = decimalUnits(item.cost_total);
  const quantity = item.billed_units === undefined ? undefined : decimalUnits(item.billed_units.quantity);
  if (cost === null || quantity === null) {
    sums.unreadable.push(`${item.product}: ${cost === null ? `cost_total ${item.cost_total}` : `quantity ${item.billed_units?.quantity ?? ""}`}`);
    return;
  }
  const unit = item.billed_units?.unit ?? null;
  const key = [item.product, item.currency_code, unit ?? ""].join("\u0000");
  const row = sums.totals.get(key) ?? { product: item.product, description: item.description, endpoint: item.endpoint, currency: item.currency_code, unit, cost: 0n, quantity: null, items: 0 };
  row.cost += cost;
  row.items += 1;
  if (quantity !== undefined) row.quantity = (row.quantity ?? 0n) + quantity;
  sums.totals.set(key, row);
}

function summaryLines(usage: Usage, width: Width): string[] {
  const sums: Sums = { totals: new Map(), unreadable: [] };
  for (const bucket of usage.buckets) for (const item of bucket.line_items) addLine(sums, item);
  if (usage.buckets.length === 0) return ["Ideogram listed no bucket for this range."];
  const items = usage.buckets.reduce((n, b) => n + b.line_items.length, 0);
  const lines = [`Usage from ${usage.buckets[0].start_time} to ${usage.buckets.at(-1)?.end_time}: ${usage.buckets.length} bucket(s) of ${width}, ${items} line item(s).`];
  const byCurrency = new Map<string, bigint>();
  for (const t of [...sums.totals.values()].sort((a, b) => (a.cost > b.cost ? -1 : 1))) {
    const units = t.quantity === null ? "" : ` · ${unitsText(t.quantity)} ${t.unit ?? "unit(s)"}`;
    lines.push(`  ${t.product} (${t.description}, ${t.endpoint}): ${unitsText(t.cost)} ${t.currency}${units}`);
    byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0n) + t.cost);
  }
  if (items === 0) lines.push("  nothing billed in this range");
  for (const [currency, cost] of byCurrency) lines.push(`Total: ${unitsText(cost)} ${currency}`);
  if (sums.unreadable.length > 0) lines.push(`${sums.unreadable.length} amount(s) not summed (not a decimal the sums read): ${sums.unreadable.join("; ")}`);
  return lines;
}

/** The buckets exactly as received: written to a file in the output directory, inline too when small. */
async function bucketsLines(ctx: ToolContext, raw: unknown, start: string, end: string): Promise<string[]> {
  const body = raw as { buckets?: unknown };
  const text = JSON.stringify(body.buckets ?? [], null, 2) ?? "[]";
  const name = `ideogram-usage-${start.replace(/[^0-9TZ]/g, "")}-${end.replace(/[^0-9TZ]/g, "")}.json`;
  await mkdir(ctx.outputDir, { recursive: true });
  const path = join(ctx.outputDir, name);
  await writeFile(path, text);
  const head = `Buckets as Ideogram sent them (the shape ai-cost reads): ${path} (${text.length} bytes)`;
  return text.length <= INLINE_JSON_BYTES ? [head, text] : [`${head}; not printed here, over ${INLINE_JSON_BYTES} bytes`];
}

const UsageInput = z.object({
  start_time: z.string().optional().describe("Start of the range, RFC 3339 (e.g. 2026-10-01T00:00:00Z); default 7 days (1d) or 24 hours (1h) before the end"),
  end_time: z.string().optional().describe("End of the range, exclusive, RFC 3339; default now"),
  bucket_width: z.enum(["1d", "1h"]).optional().describe("1d (a range of at most 92 days) or 1h (at most 168 hours); default 1d"),
  sources: z.array(z.enum(["api", "app"])).min(1).optional().describe("api (API requests), app (web-app usage) or both; default both"),
});

const toRfc3339 = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The range as the API takes it: both ends RFC 3339, start before end, at most the width's span. */
function rangeOf(ctx: ToolContext, input: z.infer<typeof UsageInput>): { start: string; end: string | undefined } | string {
  const width = WIDTHS[input.bucket_width ?? "1d"];
  const endMs = input.end_time === undefined ? ctx.clock.now() : Date.parse(input.end_time);
  if (!Number.isFinite(endMs)) return `end_time ${input.end_time} is not an RFC 3339 time (e.g. 2026-10-08T00:00:00Z)`;
  let start = input.start_time;
  if (start === undefined) {
    const from = new Date(endMs - width.defaultMs);
    if (input.bucket_width === "1h") from.setUTCMinutes(0, 0, 0);
    else from.setUTCHours(0, 0, 0, 0);
    start = toRfc3339(from.getTime());
  }
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) return `start_time ${start} is not an RFC 3339 time (e.g. 2026-10-01T00:00:00Z)`;
  if (startMs >= endMs) return `start_time ${start} is not before the end ${input.end_time ?? "(now)"}`;
  if (endMs - startMs > width.maxMs) return `the range spans more than ${width.limit}, the most one request may cover at ${input.bucket_width ?? "1d"}; page by moving start_time`;
  return { start, end: input.end_time };
}

async function runUsage(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = UsageInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_usage: ${input.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ")}`, true);
  const range = rangeOf(ctx, input.data);
  if (typeof range === "string") return textResult(`ideogram_usage: ${range}`, true);
  const query: Record<string, QueryValue> = { start_time: range.start };
  if (range.end !== undefined) query.end_time = range.end;
  if (input.data.bucket_width !== undefined) query.bucket_width = input.data.bucket_width;
  if (input.data.sources !== undefined) query.sources = input.data.sources;
  const checked = USAGE.schemas.query?.safeParse(query);
  if (checked !== undefined && !checked.success) return textResult(`ideogram_usage: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} (RFC 3339 times, e.g. 2026-10-01T00:00:00Z)`, true);
  try {
    const answer = await read(ctx, USAGE, query, zGetAccountUsageResponse);
    if (!answer.ok) return answer.result;
    const width = input.data.bucket_width ?? "1d";
    const end = answer.data.buckets.at(-1)?.end_time ?? range.end ?? toRfc3339(ctx.clock.now());
    return textResult([...summaryLines(answer.data, width), ...(await bucketsLines(ctx, answer.raw, range.start, end))].join("\n"));
  } catch (error) {
    return adminOnly(error, "Reading the usage") ?? Promise.reject(error);
  }
}

async function runInvoices(ctx: ToolContext): Promise<CallToolResult> {
  try {
    const answer = await read(ctx, INVOICES, {}, zListAccountInvoicesResponse);
    if (!answer.ok) return answer.result;
    const rows = answer.data.invoices.map((inv) => `${inv.start_time} → ${inv.end_time}: ${inv.total} ${inv.currency_code}, ${inv.status}${inv.paid_time ? `, paid ${inv.paid_time}` : ""} (${inv.line_items.length} line item(s))`);
    const raw = (answer.raw as { invoices?: unknown }).invoices ?? [];
    return textResult([`${rows.length} invoice(s).`, ...rows, "Invoices as Ideogram sent them:", jsonText(raw)].join("\n"));
  } catch (error) {
    return adminOnly(error, "Listing invoices") ?? Promise.reject(error);
  }
}

async function runApiKeys(ctx: ToolContext): Promise<CallToolResult> {
  try {
    const answer = await read(ctx, API_KEYS, {}, zListAccountApiKeysResponse);
    if (!answer.ok) return answer.result;
    const rows = answer.data.api_keys.map((k) => `${k.redacted_api_key} (${k.api_key_id}) ${k.status}${k.label ? ` "${k.label}"` : ""}, created ${k.creation_time}${k.creator_display_label ? ` by ${k.creator_display_label}` : ""}`);
    return textResult([`${rows.length} API key(s), newest first (key material redacted by Ideogram).`, ...rows].join("\n"));
  } catch (error) {
    return adminOnly(error, "Listing API keys") ?? Promise.reject(error);
  }
}

const ADMIN = "Needs an API key whose owner is an organization admin. Reads only.";

export const USAGE_TOOL: ToolDefinition = {
  name: "ideogram_usage",
  title: "Usage and spend",
  description: `Your organization's billed API usage as Ideogram reports it: dense time buckets of line items (product, endpoint, cost, units, the redacted API key), summed per product, unit and currency here, the buckets written unchanged to a file in the output directory (the shape ai-cost reads; printed too when small). Default: the last 7 days by day. ${ADMIN}`,
  inputSchema: UsageInput,
  handler: runUsage,
};

export const INVOICES_TOOL: ToolDefinition = {
  name: "ideogram_invoices",
  title: "Invoices",
  description: `Your organization's invoices with their line items — the billing record the usage reconciles against. ${ADMIN}`,
  inputSchema: z.object({}),
  handler: (ctx) => runInvoices(ctx),
};

export const API_KEYS_TOOL: ToolDefinition = {
  name: "ideogram_api_keys",
  title: "API keys",
  description: `The API keys in your organization, newest first, key material redacted (the id and the redacted prefix match the usage report's line items). ${ADMIN}`,
  inputSchema: z.object({}),
  handler: (ctx) => runApiKeys(ctx),
};

export const ACCOUNT_TOOLS: readonly ToolDefinition[] = [USAGE_TOOL, INVOICES_TOOL, API_KEYS_TOOL];
