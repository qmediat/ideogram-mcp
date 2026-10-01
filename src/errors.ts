export class IdeogramApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IdeogramApiError";
  }

  toMcpError(): string {
    return `Ideogram API error ${this.code} (${this.status}): ${this.message}`;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** A failure before any response: DNS, TLS, a reset. A timeout is retried only for an idempotent request (an image
 * GET): a timed-out POST may have been accepted and started (and billed) the generation, and its multipart body of
 * up to 50 MB would be sent again. */
export function isRetryableNetworkError(error: unknown, idempotent = false): boolean {
  if (error instanceof TypeError) return true; // DNS, TLS, connection reset
  if (idempotent && error instanceof DOMException && error.name === "TimeoutError") return true;
  return false;
}

/** The name a network failure reports under (TypeError, TimeoutError, …), so a timeout is told from a DNS failure. */
export function networkErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
