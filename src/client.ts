/**
 * The HTTP client of the v2 API: one call per operation with the four request locations (src/wire.ts), the `Api-Key`
 * header only, `dry_run` as a query parameter, typed 402/429 errors from `GenerationErrorResponse`, and streamed
 * downloads to disk.
 *
 * Retries never create a second job: a POST is sent again only when it certainly never reached the server (DNS, a
 * refused connect) or the API explicitly rejected it before acceptance (429). A POST that failed after it may have
 * been sent (a timeout, a reset, a 5xx) is reported, not repeated. A GET (a poll, a download) is idempotent and is
 * retried on network failures, 429 and 5xx.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { COUNTERS } from "./counters.js";
import { zGenerationErrorResponse } from "./generated/zod.gen.js";
import { failedBeforeSending, IdeogramApiError, isNetworkFailure, networkErrorText } from "./errors.js";
import type { ApiErrorDetails } from "./errors.js";
import type { Operation } from "./spec/operations.js";
import { buildUrl, encodeBody } from "./wire.js";
import type { BodyInput, EncodedBody, QueryValue, Scalar } from "./wire.js";

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Hosts images and videos may be downloaded from (a host or any subdomain of it). */
  readonly downloadHosts: readonly string[];
  /** Plain-http downloads, for a loopback test server only. */
  readonly allowHttpDownloads: boolean;
  readonly maxRetries: number;
  readonly requestTimeoutMs: number;
  readonly maxDownloadBytes: number;
  readonly sleep: (ms: number) => Promise<void>;
  /** The multipart boundary; random unless a test fixes it. */
  readonly boundary?: () => string;
}

export const DEFAULT_BASE_URL = "https://api.ideogram.ai";
export const DEFAULT_DOWNLOAD_HOSTS: readonly string[] = ["ideogram.ai", "d2gu96o5zk2m7w.cloudfront.net"];
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export function defaultClientOptions(apiKey: string): ClientOptions {
  return {
    apiKey,
    baseUrl: DEFAULT_BASE_URL,
    downloadHosts: DEFAULT_DOWNLOAD_HOSTS,
    allowHttpDownloads: false,
    maxRetries: 3,
    requestTimeoutMs: 120_000,
    maxDownloadBytes: MAX_DOWNLOAD_BYTES,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  };
}

/** One call of one operation, its parameters kept in their four locations. */
export interface ApiRequest {
  readonly op: Operation;
  readonly path: Readonly<Record<string, Scalar>>;
  readonly query: Readonly<Record<string, QueryValue>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: BodyInput | null;
  readonly dryRun: boolean;
}

export interface ApiResult {
  readonly status: number;
  readonly body: unknown;
}

export interface SavedFile {
  readonly path: string;
  readonly bytes: number;
  readonly contentType: string;
}

type Attempt = { readonly kind: "response"; readonly response: Response } | { readonly kind: "network"; readonly error: unknown };

/** The longest a retry sleeps: inside one tool call (≤ 50 s wait, 60 s client timeout), so a POST is never resent after the
 * caller has given up (the job would run and bill with its id reaching nobody). A 429 asking for more is reported with its
 * Retry-After instead of retried. */
const RETRY_AFTER_MAX_S = 30;

/** The Retry-After header as whole seconds, whatever its size; undefined when absent or not a positive number. */
function retryAfterSeconds(response: Response): number | undefined {
  const seconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function retryAfterTooLong(response: Response): boolean {
  const after = retryAfterSeconds(response);
  return after !== undefined && after > RETRY_AFTER_MAX_S;
}

function backoffMs(attempt: number, response?: Response): number {
  const after = response === undefined ? undefined : retryAfterSeconds(response);
  return after !== undefined ? after * 1000 : 2 ** attempt * 1000 + Math.random() * 500;
}

function excerpt(text: string): string {
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function messageOf(body: unknown, fallback: string): string {
  if (body === null || typeof body !== "object") return fallback;
  const record = body as { message?: unknown; error?: unknown; detail?: unknown };
  const candidate = record.message ?? record.error ?? record.detail;
  return typeof candidate === "string" ? candidate : excerpt(JSON.stringify(body));
}

/** The typed error of a non-2xx response: GenerationErrorResponse details on 402/429, the API's message otherwise. */
export async function errorFromResponse(response: Response): Promise<IdeogramApiError> {
  // An unreadable error body still leaves the status: the message falls back to the status text.
  const text = await response.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const typed = zGenerationErrorResponse.safeParse(body);
  const details: ApiErrorDetails = typed.success
    ? { rejectReason: typed.data.reject_reason, maxInflight: typed.data.max_inflight_requests, taskCompletionSpeed: typed.data.task_completion_speed }
    : {};
  const message = typed.success ? typed.data.error : messageOf(body, excerpt(text) || response.statusText);
  const code = typed.success ? typed.data.reject_reason.toUpperCase() : `HTTP_${response.status}`;
  return new IdeogramApiError(response.status, code, message, { ...details, retryAfterS: retryAfterSeconds(response) });
}

export class IdeogramClient {
  constructor(readonly options: ClientOptions) {}

  private encode(req: ApiRequest): { url: string; body: EncodedBody | null } {
    const query = req.dryRun ? { ...req.query, dry_run: true } : req.query;
    const url = buildUrl(this.options.baseUrl, req.op.path, req.path, query);
    return { url, body: req.body === null ? null : encodeBody(req.body, this.options.boundary?.()) };
  }

  private async attempt(method: string, url: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer> | null): Promise<Attempt> {
    try {
      // redirect manual: a 3xx is returned as a response, never followed — the download host allow-list is checked on
      // the URL this server asked for, and a hop to another host would skip it.
      const init: RequestInit = { method, headers, redirect: "manual", signal: AbortSignal.timeout(this.options.requestTimeoutMs) };
      if (body !== null) init.body = body;
      return { kind: "response", response: await fetch(url, init) };
    } catch (error) {
      return { kind: "network", error };
    }
  }

  /** Whether a failed attempt may be sent again without risking a second accepted job. */
  private retryable(idempotent: boolean, result: Attempt): boolean {
    if (result.kind === "network") return idempotent ? isNetworkFailure(result.error) : failedBeforeSending(result.error);
    const status = result.response.status;
    if (retryAfterTooLong(result.response)) return false;
    return status === 429 || (idempotent && status >= 500);
  }

  private networkError(idempotent: boolean, error: unknown): IdeogramApiError {
    const sent = !idempotent && !failedBeforeSending(error);
    const note = sent ? "; the request may have reached Ideogram, so it was not sent again (it could be billed twice)" : "";
    return new IdeogramApiError(0, "NETWORK_ERROR", `Network error: ${networkErrorText(error)}${note}`);
  }

  /** Sends one request; resolves with the parsed 2xx body, rejects with a typed IdeogramApiError. */
  async call(req: ApiRequest): Promise<ApiResult> {
    const { url, body } = this.encode(req);
    const headers: Record<string, string> = { ...req.headers, "Api-Key": this.options.apiKey, Accept: "application/json" };
    if (body !== null) headers["Content-Type"] = body.contentType;
    const idempotent = req.op.method === "GET";
    for (let attempt = 0; ; attempt++) {
      const result = await this.attempt(req.op.method, url, headers, body?.bytes ?? null);
      if (result.kind === "response" && result.response.ok) return { status: result.response.status, body: await parseJson(result.response, req) };
      if (attempt < this.options.maxRetries && this.retryable(idempotent, result)) {
        COUNTERS.retries += 1;
        if (result.kind === "response") await discard(result.response);
        await this.options.sleep(backoffMs(attempt, result.kind === "response" ? result.response : undefined));
        continue;
      }
      throw result.kind === "network" ? this.networkError(idempotent, result.error) : await errorFromResponse(result.response);
    }
  }

  /** Downloads one generated file into `outputDir`, streamed with a byte counter; nothing is left behind on failure. */
  async download(url: string, outputDir: string): Promise<SavedFile> {
    this.checkDownloadUrl(url);
    const response = await this.fetchDownload(url);
    const contentType = (response.headers.get("Content-Type") ?? "").toLowerCase();
    const extension = MEDIA_EXTENSIONS.find(([prefix]) => contentType.startsWith(prefix))?.[1];
    if (extension === undefined) {
      await response.body?.cancel();
      throw new IdeogramApiError(response.status, "DOWNLOAD_INVALID_TYPE", `Expected an image or a video, got: ${contentType || "(missing)"}`);
    }
    const declared = Number.parseInt(response.headers.get("Content-Length") ?? "", 10);
    if (Number.isFinite(declared) && declared > this.options.maxDownloadBytes) {
      await response.body?.cancel();
      throw tooLarge(declared, this.options.maxDownloadBytes);
    }
    return streamToFile(response, outputDir, extension, this.options.maxDownloadBytes, contentType);
  }

  private checkDownloadUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new IdeogramApiError(0, "INVALID_URL", `Invalid download URL: ${url}`);
    }
    const httpAllowed = this.options.allowHttpDownloads && parsed.protocol === "http:";
    if (parsed.protocol !== "https:" && !httpAllowed) {
      throw new IdeogramApiError(0, "SSRF_BLOCKED", `Only HTTPS downloads allowed, got: ${parsed.protocol}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (!this.options.downloadHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      throw new IdeogramApiError(0, "SSRF_BLOCKED", `Download host not allowed: ${parsed.hostname}`);
    }
  }

  private async fetchDownload(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.attempt("GET", url, {}, null);
      if (result.kind === "response" && result.response.status >= 300 && result.response.status < 400) {
        await result.response.body?.cancel();
        const location = result.response.headers.get("Location") ?? "unknown";
        throw new IdeogramApiError(result.response.status, "REDIRECT_BLOCKED", `Download redirect blocked (${result.response.status} → ${location})`);
      }
      if (result.kind === "response" && result.response.ok) return result.response;
      if (attempt < this.options.maxRetries && this.retryable(true, result)) {
        COUNTERS.retries += 1;
        if (result.kind === "response") await discard(result.response);
        await this.options.sleep(backoffMs(attempt));
        continue;
      }
      if (result.kind === "network") throw new IdeogramApiError(0, "NETWORK_ERROR", `Download network error: ${networkErrorText(result.error)}`);
      await result.response.body?.cancel();
      throw new IdeogramApiError(result.response.status, "DOWNLOAD_FAILED", `Failed to download: ${result.response.statusText}`);
    }
  }
}

/** Releases a response body this client will not read. Its failure cannot change the outcome (the response is already
 * judged), so it is not reported. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function parseJson(response: Response, req: ApiRequest): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    // The 2xx status arrived, so a POST was accepted; its body (the generation id) is lost with the connection.
    const note = req.op.method === "GET" ? "" : "; Ideogram answered 2xx, so the job may be running and billed — its id did not arrive";
    throw new IdeogramApiError(response.status, "RESPONSE_READ_FAILED", `${req.op.id}: the response body could not be read: ${networkErrorText(error)}${note}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new IdeogramApiError(response.status, "INVALID_JSON", `${req.op.id} answered ${response.status} with a non-JSON body: ${excerpt(text)}`);
  }
}

const MEDIA_EXTENSIONS: readonly (readonly [string, string])[] = [
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
  ["image/gif", "gif"],
  ["video/mp4", "mp4"],
];

function tooLarge(bytes: number, cap: number): IdeogramApiError {
  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
  return new IdeogramApiError(200, "DOWNLOAD_TOO_LARGE", `The file is over ${mb(cap)} MB (${mb(bytes)} MB read); not saved`);
}

/** A new file name in the output directory: ideogram-<ms>-<random>.<ext>. */
export function outputFileName(extension: string): string {
  return `ideogram-${Date.now()}-${randomBytes(4).toString("hex")}.${extension}`;
}

async function streamToFile(response: Response, outputDir: string, extension: string, cap: number, contentType: string): Promise<SavedFile> {
  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true });
  const partial = join(dir, `.${outputFileName(extension)}.part`);
  const handle = await open(partial, "wx");
  let bytes = 0;
  try {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes += chunk.value.byteLength;
      if (bytes > cap) {
        await reader.cancel();
        throw tooLarge(bytes, cap);
      }
      await handle.write(chunk.value);
    }
    await handle.close();
    const path = join(dir, outputFileName(extension));
    await rename(partial, path);
    return { path, bytes, contentType };
  } catch (error) {
    // The download already failed with `error`; closing and removing the partial file must not replace it.
    await handle.close().catch(() => undefined);
    await rm(partial, { force: true });
    throw error;
  }
}
