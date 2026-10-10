/**
 * The account tools (step 2 of docs/DESIGN-ideogram-v2.md): usage and spend as the API bills it, the invoices, the
 * API keys. Reads only — a GET with query parameters checked against the operation's generated schema, the answer
 * against its response schema (a mismatch is reported, never passed off), nothing generated or billed.
 * ideogram_usage sums what the buckets carry (decimal strings, never floats) and hands the buckets on unchanged:
 * the shape ai-cost reads.
 */
import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiRequest } from "../client.js";
import { IdeogramApiError } from "../errors.js";
import { zGetAccountUsageResponse, zListAccountApiKeysResponse, zListAccountInvoicesResponse } from "../generated/zod.gen.js";
import { contractMismatch } from "../lifecycle.js";
import { operationById } from "../spec/operations.js";
import type { Operation } from "../spec/operations.js";
import type { QueryValue } from "../wire.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import type { ToolArguments } from "./family.js";
import { jsonText, outcomeResult, textResult } from "./results.js";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 7;
const SCALE = 1_000_000_000n; // nine decimals: every amount the API sends fits

function operation(id: string): Operation {
  const op = operationById(id);
  if (op === null) throw new Error(`the snapshot lacks ${id}`);
  return op;
}

const USAGE = operation("get_account_usage");
const INVOICES = operation("get_account_invoices");
const API_KEYS = operation("get_account_api_keys");

/** A decimal string as scaled integer units (nine places); refuses what is not a decimal. */
export function decimalUnits(text: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (m === null) throw new Error(`not a decimal amount: ${text}`);
  const [, sign, whole, fraction = ""] = m;
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, "0"));
  return sign === "-" ? -units : units;
}

export function unitsText(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(9, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/** One GET of the operation with its query; the answer parsed by the schema, or a contract mismatch outcome. */
async function read<T extends z.ZodType>(ctx: ToolContext, op: Operation, query: Readonly<Record<string, QueryValue>>, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; result: CallToolResult }> {
  const req: ApiRequest = { op, path: {}, query, headers: {}, body: null, dryRun: false };
  const answer = await ctx.client.call(req, ctx.budget);
  const parsed = schema.safeParse(answer.body);
  if (parsed.success) return { ok: true, data: parsed.data as z.infer<T> };
  return { ok: false, result: await outcomeResult(ctx, contractMismatch(answer.status, answer.body, parsed.error), []) };
}

/** The two admin-only listings answer 404 to a key another member owns: said as such, never as "not found". */
function adminOnly(error: unknown, what: string): CallToolResult | null {
  if (error instanceof IdeogramApiError && error.status === 404) {
    return textResult(`${what} needs an API key whose owner is an organization admin (Ideogram answers 404 to a key owned by another member).`, true);
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
  cost: bigint;
  quantity: bigint | null;
  unit: string | null;
  items: number;
}

function addLine(totals: Map<string, ProductTotal>, item: LineItem): void {
  const key = `${item.product}\u0000${item.currency_code}`;
  const row = totals.get(key) ?? { product: item.product, description: item.description, endpoint: item.endpoint, currency: item.currency_code, cost: 0n, quantity: null, unit: null, items: 0 };
  row.cost += decimalUnits(item.cost_total);
  row.items += 1;
  if (item.billed_units !== undefined) {
    row.quantity = (row.quantity ?? 0n) + decimalUnits(item.billed_units.quantity);
    row.unit = item.billed_units.unit;
  }
  totals.set(key, row);
}

function usageLines(usage: Usage, width: string): string[] {
  const totals = new Map<string, ProductTotal>();
  for (const bucket of usage.buckets) for (const item of bucket.line_items) addLine(totals, item);
  const first = usage.buckets[0]?.start_time ?? "?";
  const last = usage.buckets.at(-1)?.end_time ?? "?";
  const lines = [`Usage from ${first} to ${last}: ${usage.buckets.length} bucket(s) of ${width}, ${[...totals.values()].reduce((n, t) => n + t.items, 0)} line item(s).`];
  const byCurrency = new Map<string, bigint>();
  for (const t of [...totals.values()].sort((a, b) => (a.cost > b.cost ? -1 : 1))) {
    const units = t.quantity === null ? "" : ` · ${unitsText(t.quantity)} ${t.unit ?? "unit(s)"}`;
    lines.push(`  ${t.product} (${t.description}, ${t.endpoint}): ${unitsText(t.cost)} ${t.currency}${units}`);
    byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0n) + t.cost);
  }
  if (byCurrency.size === 0) lines.push("  nothing billed in this range");
  for (const [currency, cost] of byCurrency) lines.push(`Total: ${unitsText(cost)} ${currency}`);
  lines.push("Buckets as Ideogram reports them (the shape ai-cost reads):", jsonText(usage.buckets));
  return lines;
}

const UsageInput = z.object({
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  bucket_width: z.enum(["1d", "1h"]).optional(),
  sources: z.array(z.enum(["api", "app"])).optional(),
});

function defaultStart(ctx: ToolContext): string {
  const start = new Date(ctx.clock.now() - DEFAULT_DAYS * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function runUsage(ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const input = UsageInput.safeParse(args);
  if (!input.success) return textResult(`ideogram_usage: ${input.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ")}`, true);
  const query: Record<string, QueryValue> = { start_time: input.data.start_time ?? defaultStart(ctx) };
  if (input.data.end_time !== undefined) query.end_time = input.data.end_time;
  if (input.data.bucket_width !== undefined) query.bucket_width = input.data.bucket_width;
  if (input.data.sources !== undefined) query.sources = input.data.sources;
  const checked = USAGE.schemas.query?.safeParse(query);
  if (checked !== undefined && !checked.success) return textResult(`ideogram_usage: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} (RFC 3339 times, e.g. 2026-10-01T00:00:00Z)`, true);
  const answer = await read(ctx, USAGE, query, zGetAccountUsageResponse);
  if (!answer.ok) return answer.result;
  return textResult(usageLines(answer.data, input.data.bucket_width ?? "1d").join("\n"));
}

async function runInvoices(ctx: ToolContext): Promise<CallToolResult> {
  try {
    const answer = await read(ctx, INVOICES, {}, zListAccountInvoicesResponse);
    if (!answer.ok) return answer.result;
    const rows = answer.data.invoices.map((inv) => `${inv.start_time} → ${inv.end_time}: ${inv.total} ${inv.currency_code}, ${inv.status}${inv.paid_time ? `, paid ${inv.paid_time}` : ""} (${inv.line_items.length} line item(s))`);
    return textResult([`${rows.length} invoice(s).`, ...rows, "Invoices as Ideogram reports them:", jsonText(answer.data.invoices)].join("\n"));
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

export const USAGE_TOOL: ToolDefinition = {
  name: "ideogram_usage",
  title: "Usage and spend",
  description:
    "Your organization's billed API usage as Ideogram reports it: dense time buckets of line items (product, endpoint, cost, units, the redacted API key), summed per product and per currency here, the buckets handed on unchanged (the shape ai-cost reads). Default: the last 7 days by day. Reads only.",
  inputSchema: z.object({
    start_time: z.string().optional().describe("Start of the range, RFC 3339 (e.g. 2026-10-01T00:00:00Z); default 7 days ago, midnight UTC"),
    end_time: z.string().optional().describe("End of the range, exclusive, RFC 3339; default now"),
    bucket_width: z.enum(["1d", "1h"]).optional().describe("1d (ranges up to 92 days) or 1h (up to 168 hours); default 1d"),
    sources: z.array(z.enum(["api", "app"])).optional().describe("api (API requests), app (web-app usage) or both; default both"),
  }),
  handler: runUsage,
};

export const INVOICES_TOOL: ToolDefinition = {
  name: "ideogram_invoices",
  title: "Invoices",
  description: "Your organization's invoices with their line items — the billing record the usage reconciles against. Needs an organization-admin key. Reads only.",
  inputSchema: z.object({}),
  handler: (ctx) => runInvoices(ctx),
};

export const API_KEYS_TOOL: ToolDefinition = {
  name: "ideogram_api_keys",
  title: "API keys",
  description: "The API keys in your organization, newest first, key material redacted (the id and the redacted prefix match the usage report's line items). Needs an organization-admin key. Reads only.",
  inputSchema: z.object({}),
  handler: (ctx) => runApiKeys(ctx),
};

export const ACCOUNT_TOOLS: readonly ToolDefinition[] = [USAGE_TOOL, INVOICES_TOOL, API_KEYS_TOOL];
