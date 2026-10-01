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

/** A failure before any response: DNS, TLS, a reset. A TIMEOUT is not retried: the server may have accepted the
 * request and started (and billed) the generation, and a multipart body of up to 50 MB would be sent again. */
export function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // DNS, TLS, connection reset
  return false;
}
