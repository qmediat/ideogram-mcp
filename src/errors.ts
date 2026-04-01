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

export function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // DNS, TLS, connection reset
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  return false;
}
