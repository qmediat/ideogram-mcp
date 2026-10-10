/**
 * One request of an operation outside the generation lifecycle (the account and training listings): the query and
 * path checked by the operation's generated schemas, the answer by its response schema — a mismatch is reported as
 * one, never passed off —, the raw body kept beside the parsed one (printed as received, nothing stripped).
 */
import type { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiRequest } from "../client.js";
import type { BodyInput, QueryValue, Scalar } from "../wire.js";
import { contractMismatch } from "../lifecycle.js";
import { IdeogramApiError } from "../errors.js";
import type { Operation } from "../spec/operations.js";
import type { ToolContext } from "./context.js";
import { outcomeResult, textResult } from "./results.js";

export interface ReadRequest {
  readonly op: Operation;
  readonly path?: Readonly<Record<string, Scalar>>;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: BodyInput | null;
}

export type Read<T> = { readonly ok: true; readonly data: T; readonly raw: unknown } | { readonly ok: false; readonly result: CallToolResult };

export async function readOperation<T extends z.ZodType>(ctx: ToolContext, request: ReadRequest, schema: T): Promise<Read<z.infer<T>>> {
  const req: ApiRequest = { op: request.op, path: request.path ?? {}, query: request.query ?? {}, headers: {}, body: request.body ?? null, dryRun: false };
  const answer = await ctx.client.call(req, ctx.budget);
  const parsed = schema.safeParse(answer.body);
  if (parsed.success) return { ok: true, data: parsed.data as z.infer<T>, raw: answer.body };
  return { ok: false, result: await outcomeResult(ctx, contractMismatch(answer.status, answer.body, parsed.error), []) };
}

/** An API error as the text a tool returns; a 404 of an owner-scoped resource is said with the API's words. */
export function apiErrorResult(error: unknown, what: string, notFoundMeans: string): CallToolResult {
  if (error instanceof IdeogramApiError && error.status === 404) return textResult(`${what}: ${notFoundMeans} (Ideogram's answer: ${error.message}).`, true);
  throw error;
}
