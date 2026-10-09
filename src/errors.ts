/** The account or usage limit that rejected a generation (402 / 429 `GenerationErrorResponse.reject_reason`). */
export type RejectReason =
  | "insufficient_funds"
  | "subscription_required"
  | "daily_limit"
  | "priority_credit_required"
  | "inflight_limit"
  | "feature_limit";

/** What a 402 / 429 / 4xx body and its headers add to the status. */
export interface ApiErrorDetails {
  readonly rejectReason?: RejectReason;
  readonly retryAfterS?: number;
  readonly maxInflight?: number;
  readonly taskCompletionSpeed?: string;
}

/** What the caller can do about each reject reason. */
export const REJECT_REMEDY: Readonly<Record<RejectReason, string>> = {
  insufficient_funds: "add credits to the API account (https://ideogram.ai/manage-api)",
  subscription_required: "this model or feature needs an API subscription on the account",
  daily_limit: "the account's daily limit is reached; it resets the next day",
  priority_credit_required: "this request needs priority credits on the account",
  inflight_limit: "too many generations are in progress; wait for one to finish (ideogram_generation) and retry",
  feature_limit: "the account's plan does not include this feature",
};

export class IdeogramApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ApiErrorDetails = {},
  ) {
    super(message);
    this.name = "IdeogramApiError";
  }

  toMcpError(): string {
    const parts = [`Ideogram API error ${this.code} (${this.status}): ${this.message}`];
    const { rejectReason, maxInflight, retryAfterS } = this.details;
    if (rejectReason) parts.push(`reason: ${rejectReason} — ${REJECT_REMEDY[rejectReason]}`);
    if (maxInflight !== undefined) parts.push(`the account may run ${maxInflight} generation(s) at once`);
    if (retryAfterS !== undefined) parts.push(`retry after ${retryAfterS} s`);
    return parts.join("; ");
  }
}

/** The connection-phase failures (the request never left this machine): DNS, a refused or timed-out connect. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function causeCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

/** True when the request certainly never reached the server, so sending it again cannot create a second job. */
export function failedBeforeSending(error: unknown): boolean {
  const code = causeCode(error);
  return code !== undefined && NOT_SENT_CODES.has(code);
}

/** Any failure before a response — retried only for an idempotent request (a GET). */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof DOMException && error.name === "TimeoutError";
}

/** The name a network failure reports under (TypeError, TimeoutError, …) and its cause's code. */
export function networkErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = causeCode(error);
  return `${error.name}: ${error.message}${code ? ` (${code})` : ""}`;
}
