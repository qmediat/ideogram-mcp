/**
 * The HTTP client of the v2 API: one call per operation with the four request locations (src/wire.ts), the `Api-Key`
 * header only, `dry_run` as a query parameter, typed 402/429 errors from `GenerationErrorResponse`, and streamed
 * downloads to disk.
 *
 * Retries never create a second job: a POST is sent again only when it certainly never reached the server (DNS, a
 * refused connect) or the API explicitly rejected it before acceptance (429). A POST that failed after it may have
 * been sent (a timeout, a reset, a 5xx) is reported, not repeated. A GET (a poll, a download) is idempotent and is
 * retried on network failures, 429 and 5xx.
 *
 * Nothing of a call outlives the tool call it belongs to: every request and download takes the call's CallBudget
 * (src/budget.ts) — one deadline for the whole tool call and the caller's own cancellation signal — and every attempt's
 * timeout and every retry sleep (Retry-After included) is judged against what remains of it. A non-idempotent request
 * is resent only when the time left also covers the duration of the attempt that was just rejected.
 */
import { randomBytes } from "node:crypto";
import { remainingMs, sleepWithin } from "./budget.js";
import type { CallBudget } from "./budget.js";
import { mkdir, open, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { COUNTERS } from "./counters.js";
import { zGenerationErrorResponse } from "./generated/zod.gen.js";
import { failedBeforeSending, IdeogramApiError, isNetworkFailure, networkErrorText } from "./errors.js";
import type { ApiErrorDetails } from "./errors.js";
import type { Operation } from "./spec/operations.js";
import { requestBytesRefusal } from "./spec/overlay.js";
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
  /** The longest ONE attempt may take (an upload of tens of MB needs minutes); the call's deadline is its CallBudget. */
  readonly requestTimeoutMs: number;
  readonly maxDownloadBytes: number;
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

/** The least an attempt is given: a retry does not start when less than this remains of the budget. */
const MIN_ATTEMPT_MS = 1_000;

/** The Retry-After header as whole seconds, whatever its size; undefined when absent or not a positive number. */
function retryAfterSeconds(response: Response): number | undefined {
  const seconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
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

  /** One HTTP attempt within the budget: its timeout is the client's or what remains of the call, whichever is less; the
   * caller's cancellation aborts it too. */
  private async attempt(method: string, url: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer> | null, budget: CallBudget): Promise<Attempt> {
    const left = remainingMs(budget);
    if (left <= 0) return { kind: "network", error: new BudgetEnded("timeout", false) };
    if (budget.signal.aborted) return { kind: "network", error: budgetEnded(budget.signal, false) };
    try {
      // redirect manual: a 3xx is returned as a response, never followed — the download host allow-list is checked on
      // the URL this server asked for, and a hop to another host would skip it.
      const timeout = Math.max(1, Math.ceil(Math.min(this.options.requestTimeoutMs, left))); // AbortSignal.timeout takes an integer
      const init: RequestInit = { method, headers, redirect: "manual", signal: AbortSignal.any([budget.signal, AbortSignal.timeout(timeout)]) };
      if (body !== null) init.body = body;
      return { kind: "response", response: await fetch(url, init) };
    } catch (error) {
      return { kind: "network", error: this.budgetCut(budget, error) ?? error };
    }
  }

  /** The budget's end behind a failed attempt or body read, or null when the failure is the attempt's own. The budget's
   * signal ends an attempt with whatever reason it was aborted with (the SDK passes a string on a client's cancel, the
   * server's limit a TimeoutError), so the signal's state is read, never the error's shape; and the attempt's own timer is
   * the budget's remainder whenever that is the shorter, so a timeout past the deadline is the budget's too (the two
   * timers fire at the same instant: which one wins must not decide the type). */
  private budgetCut(budget: CallBudget, error: unknown): BudgetEnded | null {
    if (budget.signal.aborted) return budgetEnded(budget.signal, true);
    // an abort of any name (undici reports a TimeoutError; a body read may report an AbortError) past the deadline
    if (isAbort(error) && remainingMs(budget) <= 0) return new BudgetEnded("timeout", true);
    return null;
  }

  /** Whether a retry — its sleep, then an attempt at least as long as `attemptMs` (the one just made) plus a margin —
   * ends inside the budget. A rejected POST resent with too little time left would be aborted mid-upload: a certain
   * rejection turned into a job that may be running and billed. */
  private fits(budget: CallBudget, wait: number, attemptMs: number): boolean {
    return wait + attemptMs + MIN_ATTEMPT_MS <= remainingMs(budget);
  }

  /** Whether a failed attempt may be sent again without risking a second accepted job. */
  private retryable(idempotent: boolean, result: Attempt): boolean {
    if (result.kind === "network") {
      if (result.error instanceof BudgetEnded) return false; // the call is over: nothing is resent
      return idempotent ? isNetworkFailure(result.error) : failedBeforeSending(result.error);
    }
    const status = result.response.status;
    return status === 429 || (idempotent && status >= 500);
  }

  private networkError(idempotent: boolean, error: unknown): IdeogramApiError {
    if (error instanceof BudgetEnded) return error.toApiError(idempotent);
    const sent = !idempotent && !failedBeforeSending(error);
    const note = sent ? "; the request may have reached Ideogram, so it was not sent again (it could be billed twice)" : "";
    return new IdeogramApiError(0, "NETWORK_ERROR", `Network error: ${networkErrorText(error)}${note}`);
  }

  /** Sends one request inside the call's budget; resolves with the parsed 2xx body, rejects with a typed IdeogramApiError. */
  async call(req: ApiRequest, budget: CallBudget): Promise<ApiResult> {
    const { url, body } = this.encode(req);
    if (body !== null && req.body?.files.length) {
      const refusal = requestBytesRefusal(req.op, body.bytes.byteLength);
      if (refusal !== null) throw new Error(refusal);
    }
    const headers: Record<string, string> = { ...req.headers, "Api-Key": this.options.apiKey, Accept: "application/json" };
    if (body !== null) headers["Content-Type"] = body.contentType;
    const idempotent = req.op.method === "GET";
    for (let attempt = 0; ; attempt++) {
      const begun = budget.clock.now();
      const result = await this.attempt(req.op.method, url, headers, body?.bytes ?? null, budget);
      if (result.kind === "response" && result.response.ok) return { status: result.response.status, body: await parseJson(result.response, req) };
      const wait = backoffMs(attempt, result.kind === "response" ? result.response : undefined);
      const reserve = idempotent ? 0 : budget.clock.now() - begun; // a POST is resent only with time for an attempt as long as this one
      if (attempt < this.options.maxRetries && this.fits(budget, wait, reserve) && this.retryable(idempotent, result)) {
        COUNTERS.retries += 1;
        if (result.kind === "response") await discard(result.response);
        await sleepWithin(budget, wait);
        continue;
      }
      throw result.kind === "network" ? this.networkError(idempotent, result.error) : await errorFromResponse(result.response);
    }
  }

  /** Downloads one generated file into `outputDir`, streamed with a byte counter; nothing is left behind on failure. */
  async download(url: string, outputDir: string, budget: CallBudget): Promise<SavedFile> {
    this.checkDownloadUrl(url);
    const response = await this.fetchDownload(url, budget);
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
    try {
      return await streamToFile(response, outputDir, extension, this.options.maxDownloadBytes, contentType);
    } catch (error) {
      if (error instanceof IdeogramApiError) throw error;
      // the body is read under the same signal as the request: a cut mid-body is the budget's, or the attempt's own timeout
      const cut = this.budgetCut(budget, error);
      if (cut !== null) throw cut.toApiError(true);
      throw new IdeogramApiError(0, "NETWORK_ERROR", `Download network error: ${networkErrorText(error)}`);
    }
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

  private async fetchDownload(url: string, budget: CallBudget): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.attempt("GET", url, {}, null, budget);
      if (result.kind === "response" && result.response.status >= 300 && result.response.status < 400) {
        await result.response.body?.cancel();
        const location = result.response.headers.get("Location") ?? "unknown";
        throw new IdeogramApiError(result.response.status, "REDIRECT_BLOCKED", `Download redirect blocked (${result.response.status} → ${location})`);
      }
      if (result.kind === "response" && result.response.ok) return result.response;
      const wait = backoffMs(attempt, result.kind === "response" ? result.response : undefined); // Retry-After honoured here too
      if (attempt < this.options.maxRetries && this.fits(budget, wait, 0) && this.retryable(true, result)) {
        COUNTERS.retries += 1;
        if (result.kind === "response") await discard(result.response);
        await sleepWithin(budget, wait);
        continue;
      }
      if (result.kind === "network") {
        if (result.error instanceof BudgetEnded) throw this.networkError(true, result.error);
        throw new IdeogramApiError(0, "NETWORK_ERROR", `Download network error: ${networkErrorText(result.error)}`);
      }
      await result.response.body?.cancel();
      const after = retryAfterSeconds(result.response); // a 429 the budget cannot wait out keeps its Retry-After for the caller
      const retry = after === undefined ? "" : ` (retry after ${after} s)`;
      throw new IdeogramApiError(result.response.status, "DOWNLOAD_FAILED", `Failed to download: ${result.response.status} ${result.response.statusText}${retry}`, { retryAfterS: after });
    }
  }
}

/** The call's budget ended — its own limit ran out, or the caller cancelled — before an attempt or during one. */
class BudgetEnded extends Error {
  constructor(
    readonly why: "timeout" | "cancel",
    readonly inFlight: boolean,
  ) {
    super(why === "timeout" ? "the call's time ran out" : "the call was cancelled by the caller");
    this.name = "BudgetEnded";
  }

  /** Typed for the caller: a non-idempotent request that was in flight may have reached Ideogram, and says so. */
  toApiError(idempotent: boolean): IdeogramApiError {
    const when = !this.inFlight
      ? " before this request could be made"
      : idempotent
        ? " while the request was in flight"
        : "; the request was in flight and may have reached Ideogram, so it was not sent again (it could be billed twice)";
    return new IdeogramApiError(0, this.why === "timeout" ? "CALL_TIMEOUT" : "CANCELLED", `${this.message}${when}`);
  }
}

/** Which end the budget's signal reports: the server's own limit aborts with a TimeoutError, anything else is the caller. */
function budgetEnded(signal: AbortSignal, inFlight: boolean): BudgetEnded {
  return new BudgetEnded(isTimeout(signal.reason) ? "timeout" : "cancel", inFlight);
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
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
    const note = req.op.method === "GET" ? "" : "; Ideogram answered 2xx, so the job may be running and billed — its id is not in this answer";
    throw new IdeogramApiError(response.status, "INVALID_JSON", `${req.op.id} answered ${response.status} with a non-JSON body: ${excerpt(text)}${note}`);
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

/** Writes the whole chunk: a write may take fewer bytes than offered (FileHandle.write returns bytesWritten). */
async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten === 0) throw new Error("the file system accepted no bytes");
    offset += bytesWritten;
  }
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
      await writeAll(handle, chunk.value);
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
