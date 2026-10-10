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
import { contractMismatch } from "../lifecycle.js";
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

/** An answer exactly as received: written to a file in the output directory (named by what was asked, so two
 * reports never overwrite each other; readable by the owner only — an account's answers carry emails and key
 * prefixes), inline too when small. The one mechanism of every listing, the mismatch path included. */
export async function rawLines(ctx: ToolContext, what: string, name: string, value: unknown): Promise<string[]> {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const bytes = Buffer.byteLength(text, "utf8");
  await mkdir(ctx.outputDir, { recursive: true });
  const path = join(ctx.outputDir, `ideogram-${name}.json`);
  await writeFile(path, text, { mode: 0o600 });
  const head = `${what}: ${path} (${bytes} bytes, owner-readable)`;
  return bytes <= INLINE_JSON_BYTES ? [head, text] : [`${head}; not printed here, over ${INLINE_JSON_BYTES} bytes`];
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
  return { ok: false, result: textResult([said, ...kept].join("\n"), true) };
}

/** An API error as the text a tool returns; a 404 of an owner-scoped resource is said with the API's words. */
export function apiErrorResult(error: unknown, what: string, notFoundMeans: string): CallToolResult {
  if (error instanceof IdeogramApiError && error.status === 404) return textResult(`${what}: ${notFoundMeans} (Ideogram's answer: ${error.message}).`, true);
  throw error;
}
