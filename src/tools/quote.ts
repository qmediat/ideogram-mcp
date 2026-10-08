/**
 * ideogram_quote: the price of exactly the call a curated tool would make, from the API's own dry run (nothing is
 * generated, stored or billed). An operation without `dry_run` is refused before anything is sent.
 */
import { z } from "zod/v4";
import { quote } from "../cost.js";
import type { Quote } from "../cost.js";
import type { ToolDefinition } from "./context.js";
import { quoteRefusal } from "../spec/overlay.js";
import { resolveModel } from "./compat.js";
import { FAMILY_TOOLS } from "./curated.js";
import { prepare, variantsOf } from "./family.js";
import { outcomeResult, textResult } from "./results.js";

export function quoteText(q: Quote): string {
  const bound = q.upperBoundUsd === null ? "" : ` (an estimate: at most ${q.upperBoundUsd} USD)`;
  return [
    `Quote for ${q.operation}${q.model === null ? "" : ` (model ${q.model})`}: ${q.usd} USD ${q.qualifier}${bound}.`,
    `Credits: ${q.credits} at your account's own credit rate. Billing identifier: ${q.billingIdentifier}; quantity: ${q.quantity}.`,
    "Nothing was generated or billed.",
  ].join("\n");
}

const TOOL_NAMES = FAMILY_TOOLS.map((spec) => spec.name) as [string, ...string[]];

export const QUOTE_TOOL: ToolDefinition = {
  name: "ideogram_quote",
  title: "Price a call",
  description:
    "Ask Ideogram what a call would cost before making it: give the curated tool's name and the arguments you would pass it. Answers USD and credits from the API's own dry run (exact, or an estimate with its upper bound). Nothing is generated or billed.",
  inputSchema: z.object({
    tool: z.enum(TOOL_NAMES).describe("The curated tool whose call to price"),
    arguments: z.record(z.string(), z.unknown()).optional().describe("The arguments you would pass that tool"),
  }),
  handler: async (ctx, args) => {
    const spec = FAMILY_TOOLS.find((s) => s.name === args.tool);
    if (spec === undefined) return textResult(`Unknown tool ${String(args.tool)}; one of ${TOOL_NAMES.join(", ")}`, true);
    const given = (args.arguments ?? {}) as Record<string, unknown>;
    // the quote refusal first: an unquotable operation (describe) is refused before any file is read or sized
    const model = resolveModel(spec.family, given, spec.defaultModel).model;
    const variant = variantsOf(spec).find((v) => v.model === model);
    const refusal = variant === undefined ? null : quoteRefusal(variant.op);
    if (refusal !== null) return textResult(refusal, true);
    const call = await prepare(spec, given);
    const outcome = await quote(ctx.client, call.req, ctx.budget);
    if (outcome.kind !== "quote") return outcomeResult(ctx, outcome, call.notes);
    const mapped = call.notes.length === 0 ? "" : `\nMapped from the 1.x inputs: ${call.notes.join("; ")}`;
    return textResult(quoteText(outcome.quote) + mapped);
  },
};
