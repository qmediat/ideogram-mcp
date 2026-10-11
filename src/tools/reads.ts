/**
 * One request of an operation outside the generation lifecycle (the account and training listings): the query and
 * path checked by the operation's generated schemas (a throw: the caller's own input validation should have caught
 * it), the answer by its response schema — a mismatch is reported as one, never passed off —, the raw body kept
 * beside the parsed one (printed as received, nothing stripped).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiRequest } from "../client.js";
import type { BodyInput, QueryValue, Scalar } from "../wire.js";
import { COUNTERS } from "../counters.js";
import { mbText } from "../spec/overlay.js";
import { contractMismatch, execute } from "../lifecycle.js";
import type { Outcome } from "../lifecycle.js";
import { IdeogramApiError } from "../errors.js";
import { operationById } from "../spec/operations.js";
import type { Operation } from "../spec/operations.js";
import type { ToolContext } from "./context.js";
import { outcomeResult, textResult } from "./results.js";

/** An answer's JSON is printed inline up to this size; above it the file in the output directory is the answer. */
export const INLINE_JSON_BYTES = 64 * 1024;

/** An operation the snapshot must have (a tool is built on it). */
export function operation(id: string): Operation {
  const op = operationById(id);
  if (op === null) throw new Error(`the snapshot lacks ${id}`);
  return op;
}

/** A file-name component from caller-controlled text: letters, digits and a few marks only, bounded — never a separator. */
export function fileNameComponent(text: string): string {
  return text.replace(/[^0-9A-Za-z,_.-]/g, "_").replace(/\.{2,}/g, "_").slice(0, 120) || "_";
}

/** An error as the text a tool answers with (the API's typed message, or the error's own). */
export function errorText(error: unknown): string {
  if (error instanceof IdeogramApiError) return error.toMcpError();
  return error instanceof Error ? error.message : String(error);
}

/** An answer exactly as received: written to a file in the output directory (named by what was asked, so two
 * reports never overwrite each other; readable by the owner only — an account's answers carry emails and key
 * prefixes), inline too when small. The one mechanism of every listing, the mismatch path included. Best-effort:
 * the answer has already happened on the server (a dataset made, a training started), so a directory that cannot be
 * written never turns it into an error — the answer is shown inline instead and the failure is counted. */
export async function rawLines(ctx: ToolContext, what: string, name: string, value: unknown): Promise<RawAnswer> {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const bytes = Buffer.byteLength(text, "utf8");
  const path = join(ctx.outputDir, `ideogram-${fileNameComponent(name)}.json`);
  const shown = bytes <= INLINE_JSON_BYTES ? [text] : [];
  try {
    await mkdir(ctx.outputDir, { recursive: true });
    await writeFile(path, text, { mode: 0o600 });
  } catch (error) {
    COUNTERS.rawWriteFailures += 1;
    const size = shown.length === 0 ? `; too large to print here (${bytes} bytes)` : "";
    return { lines: [`${what}: not written to ${path} (${errorText(error)})${size}`, ...shown], kept: shown.length > 0 };
  }
  const head = `${what}: ${path} (${bytes} bytes, owner-readable)`;
  return { lines: shown.length > 0 ? [head, ...shown] : [`${head}; not printed here, over ${INLINE_JSON_BYTES} bytes`], kept: true };
}

/** The raw answer's lines and whether the caller's client can reach the data: written to disk, or printed whole. */
export interface RawAnswer {
  readonly lines: string[];
  /** False only when the write failed AND the answer was too large to print: the data is nowhere the client can read. */
  readonly kept: boolean;
}

/** A listing's result: its summary lines, then the answer as received; the data IS the listing, so an answer that is
 * neither on disk nor printed makes it an error (a call with a side effect never uses this: its id comes first). */
export function listingResult(head: readonly string[], raw: RawAnswer): CallToolResult {
  return textResult([...head, ...raw.lines].join("\n"), !raw.kept);
}

/** `execute()` for a tool: a failed non-idempotent request that may have reached Ideogram (a 5xx, a cut connection
 * after the request left) is answered with the typed note instead of the bare error — the one sentence every surface
 * that sends such a request shows (the family tools, `ideogram_api`; the training tools say it in their own words). */
export async function executeTold(ctx: ToolContext, req: ApiRequest, waitS: number): Promise<{ kind: "outcome"; outcome: Outcome } | { kind: "result"; result: CallToolResult }> {
  try {
    return { kind: "outcome", outcome: await execute(ctx.client, req, { waitS, clock: ctx.clock, budget: ctx.budget }) };
  } catch (error) {
    if (req.op.method === "GET" || sideEffectOf(error) !== "unknown") throw error;
    return { kind: "result", result: textResult(`${errorText(error)}\nThe request had left this machine: ${req.op.id} MAY have run and be billed — check before sending it again (ideogram_generation for a generation, ideogram_models for a training, ideogram_datasets for a dataset).`, true) };
  }
}

/** What a failed call with a side effect (a dataset made, assets added, a training started) did on the server:
 * `refused` (a 4xx: nothing happened), `not-sent` (the request never left this machine — the client's typed
 * `details.sent: false`, or a refusal raised here before any request), `unknown` (it may have reached Ideogram). */
export type SideEffect = "refused" | "not-sent" | "unknown";

export function sideEffectOf(error: unknown): SideEffect {
  if (!(error instanceof IdeogramApiError)) return "not-sent"; // the client types every failure after a request left; a plain Error is raised before one (the body's size, a location check)
  if (error.status >= 400 && error.status < 500) return "refused";
  if (error.status === 0 && error.details.sent === false) return "not-sent";
  return "unknown";
}

export type Sent<T> = { readonly kind: "answer"; readonly read: Read<T> } | { readonly kind: SideEffect; readonly error: unknown };

/** One non-idempotent call, never thrown: the answer (checked against its schema, the mismatch kept) or the failure
 * typed by what it did on the server — the one decision every tool with a side effect makes. */
export async function sendOperation<T extends z.ZodType>(ctx: ToolContext, request: ReadRequest, schema: T): Promise<Sent<z.infer<T>>> {
  try {
    return { kind: "answer", read: await readOperation(ctx, request, schema) };
  } catch (error) {
    return { kind: sideEffectOf(error), error };
  }
}

/** An operation whose 200 is a file (snap mask's image/png): the body saved as the result — the one path of the curated
 * tool and `ideogram_api` alike; a failure that may have run says so (the request is never resent). */
export async function fileAnswer(what: string, ctx: ToolContext, req: ApiRequest): Promise<CallToolResult> {
  try {
    const saved = await ctx.client.callToFile(req, ctx.outputDir, ctx.budget, "image");
    return textResult(`Saved: ${saved.path} (${mbText(saved.bytes, 2)}, ${saved.contentType.split(";")[0]})`);
  } catch (error) {
    const note = req.op.method !== "GET" && sideEffectOf(error) === "unknown" ? `\nThe request had left this machine: ${req.op.id} MAY have run — send it again only if the answer is not in the output directory.` : "";
    return textResult(`${what}: ${errorText(error)}${note}`, true);
  }
}

/** The text of a result (its text blocks joined), for a tool that prefixes its own lines to another's answer. */
export function resultText(result: CallToolResult): string {
  return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

export interface ReadRequest {
  readonly op: Operation;
  readonly path?: Readonly<Record<string, Scalar>>;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: BodyInput | null;
}

export type Read<T> = { readonly ok: true; readonly data: T; readonly raw: unknown } | { readonly ok: false; readonly result: CallToolResult };

function checkLocation(op: Operation, label: "query" | "path", value: Readonly<Record<string, unknown>>): void {
  const schema = op.schemas[label];
  if (schema === null) {
    if (Object.keys(value).length > 0) throw new Error(`${op.id} takes no ${label} parameters; given ${Object.keys(value).join(", ")}`);
    return;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${op.id} ${label}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ")}`);
}

export async function readOperation<T extends z.ZodType>(ctx: ToolContext, request: ReadRequest, schema: T): Promise<Read<z.infer<T>>> {
  checkLocation(request.op, "path", request.path ?? {});
  checkLocation(request.op, "query", request.query ?? {});
  const req: ApiRequest = { op: request.op, path: request.path ?? {}, query: request.query ?? {}, headers: {}, body: request.body ?? null, dryRun: false };
  const answer = await ctx.client.call(req, ctx.budget);
  const parsed = schema.safeParse(answer.body);
  if (parsed.success) return { ok: true, data: parsed.data as z.infer<T>, raw: answer.body };
  // a listing off its schema is reported as such (never a success) AND kept as received: the data is the point of a listing
  const mismatch = await outcomeResult(ctx, contractMismatch(answer.status, answer.body, parsed.error), []);
  const said = mismatch.content[0]?.type === "text" ? mismatch.content[0].text : "";
  const kept = await rawLines(ctx, "As Ideogram sent it (off the specification)", `${request.op.id}-mismatch-${ctx.clock.now()}`, answer.body);
  return { ok: false, result: textResult([said, ...kept.lines].join("\n"), true) };
}

/** An API error as the text a tool returns; a 404 of an owner-scoped resource is said with the API's words. */
export function apiErrorResult(error: unknown, what: string, notFoundMeans: string): CallToolResult {
  if (error instanceof IdeogramApiError && error.status === 404) return textResult(`${what}: ${notFoundMeans} (Ideogram's answer: ${error.message}).`, true);
  throw error;
}
