import { getConfig } from "./config.js";
import { IdeogramApiError, isRetryableStatus, isRetryableNetworkError } from "./errors.js";

const BASE_URL = "https://api.ideogram.ai";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50 MB cap on image downloads

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "ideogram.ai",
  "api.ideogram.ai",
  "d2gu96o5zk2m7w.cloudfront.net", // Ideogram CDN (observed)
]);

function isAllowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  for (const allowed of ALLOWED_DOWNLOAD_HOSTS) {
    if (lower === allowed || lower.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number, response?: Response): number {
  const retryAfter = response?.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0 && seconds < 300) return seconds * 1000;
  }
  return (2 ** attempt) * 1000 + Math.random() * 500;
}

async function drainBody(response: Response): Promise<void> {
  try { await response.arrayBuffer(); } catch { /* ignore drain errors */ }
}

async function parseErrorResponse(response: Response): Promise<IdeogramApiError> {
  try {
    const body = await response.json() as { code?: string; message?: string };
    return new IdeogramApiError(
      response.status,
      body.code ?? `HTTP_${response.status}`,
      body.message ?? response.statusText,
    );
  } catch {
    return new IdeogramApiError(
      response.status,
      `HTTP_${response.status}`,
      response.statusText,
    );
  }
}

function validateDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IdeogramApiError(0, "INVALID_URL", `Invalid download URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new IdeogramApiError(0, "SSRF_BLOCKED", `Only HTTPS downloads allowed, got: ${parsed.protocol}`);
  }

  if (!isAllowedHost(parsed.hostname)) {
    throw new IdeogramApiError(0, "SSRF_BLOCKED", `Download host not allowed: ${parsed.hostname}`);
  }
}

export async function ideogramRequest(
  path: string,
  body: FormData,
): Promise<unknown> {
  const config = getConfig();
  const url = `${BASE_URL}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Api-Key": config.apiKey },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (isRetryableNetworkError(error) && attempt < MAX_RETRIES) {
        const retryMs = getRetryDelay(attempt);
        console.error(
          `Ideogram network error on ${path}, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(retryMs)}ms: ${error instanceof Error ? error.message : error}`,
        );
        await delay(retryMs);
        continue;
      }
      throw new IdeogramApiError(
        0,
        "NETWORK_ERROR",
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.ok) {
      return response.json();
    }

    if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
      const retryMs = getRetryDelay(attempt, response);
      console.error(
        `Ideogram API ${response.status} on ${path}, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(retryMs)}ms`,
      );
      await drainBody(response);
      await delay(retryMs);
      continue;
    }

    throw await parseErrorResponse(response);
  }

  throw new IdeogramApiError(503, "RETRY_EXHAUSTED", "Max retries exceeded");
}

function detectExtensionFromResponse(response: Response, url: string): string {
  const contentType = response.headers.get("Content-Type")?.toLowerCase();
  if (contentType?.includes("image/jpeg") || contentType?.includes("image/jpg")) return "jpg";
  if (contentType?.includes("image/webp")) return "webp";
  if (contentType?.includes("image/png")) return "png";

  // Fallback: check URL path
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "jpg";
    if (path.endsWith(".webp")) return "webp";
  } catch { /* ignore */ }

  return "png"; // safe default
}

export async function downloadImage(url: string): Promise<{ buffer: Buffer; extension: string }> {
  validateDownloadUrl(url);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "manual",
      });
    } catch (error) {
      if (isRetryableNetworkError(error) && attempt < MAX_RETRIES) {
        const retryMs = getRetryDelay(attempt);
        console.error(
          `Image download network error, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(retryMs)}ms`,
        );
        await delay(retryMs);
        continue;
      }
      throw new IdeogramApiError(
        0,
        "DOWNLOAD_NETWORK_ERROR",
        `Download network error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Block redirects to prevent SSRF via open redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location") ?? "unknown";
      await drainBody(response);
      throw new IdeogramApiError(
        response.status,
        "REDIRECT_BLOCKED",
        `Download redirect blocked (${response.status} → ${location}). Ideogram CDN should not redirect.`,
      );
    }

    if (response.ok) {
      // Reject non-image content types
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        await drainBody(response);
        throw new IdeogramApiError(0, "DOWNLOAD_INVALID_TYPE", `Expected image content, got: ${contentType}`);
      }

      // Pre-check Content-Length when available
      const contentLength = response.headers.get("Content-Length");
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > MAX_DOWNLOAD_SIZE) {
          await drainBody(response);
          throw new IdeogramApiError(0, "DOWNLOAD_TOO_LARGE", `Image ${(size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB limit`);
        }
      }

      const extension = detectExtensionFromResponse(response, url);
      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.byteLength > MAX_DOWNLOAD_SIZE) {
        throw new IdeogramApiError(0, "DOWNLOAD_TOO_LARGE", `Downloaded image ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB limit`);
      }

      return { buffer, extension };
    }

    if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
      const retryMs = getRetryDelay(attempt, response);
      console.error(
        `Image download ${response.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(retryMs)}ms`,
      );
      await drainBody(response);
      await delay(retryMs);
      continue;
    }

    throw new IdeogramApiError(
      response.status,
      "DOWNLOAD_FAILED",
      `Failed to download image: ${response.statusText}`,
    );
  }

  throw new IdeogramApiError(503, "DOWNLOAD_RETRY_EXHAUSTED", "Max download retries exceeded");
}
