/**
 * Prices from the API itself: a `dry_run` call of the operation returns a PriceQuote (nothing generated, stored or
 * billed; the overlay binds PriceQuote to every operation that declares `dry_run`). Amounts stay integers (the
 * generated schemas parse int64 as bigint) until they are printed: USD from millionths (6 places), credits from
 * thousandths (3 places), as decimal strings — never through a float.
 */
import type { CallBudget } from "./budget.js";
import type { ApiRequest, IdeogramClient } from "./client.js";
import { asAsync, contractMismatch } from "./lifecycle.js";
import type { ContractMismatch } from "./lifecycle.js";
import { quoteRefusal } from "./spec/overlay.js";
import { zPriceQuote } from "./generated/zod.gen.js";

export interface Quote {
  readonly operation: string;
  readonly model: string | null;
  readonly billingIdentifier: string;
  readonly quantity: number;
  /** USD, six decimal places. */
  readonly usd: string;
  /** Credits at the caller's own credit rate, three decimal places. */
  readonly credits: string;
  readonly qualifier: "exact" | "estimate";
  /** The most an estimate can cost, USD with six places; null for an exact quote. */
  readonly upperBoundUsd: string | null;
}

export type QuoteOutcome = { readonly kind: "quote"; readonly quote: Quote } | ContractMismatch;

/** An integer amount of 10^-places units as a decimal string: decimalString(60000, 6) = "0.060000". */
export function decimalString(units: number | bigint, places: number): string {
  if (typeof units === "number" && !Number.isSafeInteger(units)) throw new Error(`${units} is not an integer amount`);
  const value = BigInt(units);
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(places + 1, "0");
  return `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

export const microsToUsd = (micros: number | bigint): string => decimalString(micros, 6);
export const millisToCredits = (millis: number | bigint): string => decimalString(millis, 3);

/** Asks the API for the price of a request; refuses an operation that cannot be quoted without running it. */
export async function quote(client: IdeogramClient, req: ApiRequest, budget: CallBudget): Promise<QuoteOutcome> {
  const refusal = quoteRefusal(req.op);
  if (refusal !== null) throw new Error(refusal);
  const result = await client.call({ ...asAsync(req), dryRun: true }, budget); // the very request execute() would send
  const checked = zPriceQuote.safeParse(result.body);
  if (!checked.success) return contractMismatch(result.status, result.body, checked.error);
  const q = checked.data;
  return {
    kind: "quote",
    quote: {
      operation: req.op.id,
      model: req.op.model,
      billingIdentifier: q.billing_identifier,
      quantity: q.quantity,
      usd: microsToUsd(q.usd_micros),
      credits: millisToCredits(q.credit_millis),
      qualifier: q.qualifier,
      upperBoundUsd: q.upper_bound_usd_micros === undefined ? null : microsToUsd(q.upper_bound_usd_micros),
    },
  };
}
