/**
 * ideogram_api: any operation this release serves, by id, with its parameters in their four locations. The advertised
 * schema is small (a union of 200 request schemas would not fit a client's context); the parameters are checked at
 * call time against the operation's generated schemas and the overlay's constraints. Refused: an operation of class
 * legacy / internal / bearer_only, one the support table plans for a later release, and a spec_only one unless the
 * caller sets allow_undocumented.
 */
import { z } from "zod/v4";
import type { ZodType } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiRequest } from "../client.js";
import { quote } from "../cost.js";
import { quoteText } from "./quote.js";
import { execute, WAIT_DEFAULT_S, WAIT_MAX_S } from "../lifecycle.js";
import type { OperationClass } from "../spec/classify.js";
import { constraintViolations, sourceRefusal } from "../spec/overlay.js";
import { bodySchemaFor, operationById } from "../spec/operations.js";
import type { Operation } from "../spec/operations.js";
import { servedByRawCall, supportOf } from "../spec/support.js";
import { loadUploads } from "../uploads.js";
import type { QueryValue, Scalar } from "../wire.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import type { ToolArguments } from "./family.js";
import { outcomeResult, textResult } from "./results.js";

const CLASS_REFUSAL: Readonly<Partial<Record<OperationClass, string>>> = {
  legacy: "is a legacy path whose capability v2 covers; use the v2 operation (ideogram_operations lists them)",
  internal: "is the provider's own (web app, mini-apps, internal), not part of the public API",
  bearer_only: "needs a web-app session (Bearer), not an API key",
};

const RawInput = z.object({
  operation: z.string().min(1),
  params: z
    .strictObject({
      path: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      query: z.record(z.string(), z.unknown()).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  files: z.array(z.object({ field: z.string().min(1), path: z.string().min(1) })).optional(),
  dry_run: z.boolean().optional(),
  wait_s: z.number().int().min(0).max(WAIT_MAX_S).optional(),
  allow_undocumented: z.boolean().optional(),
});
type RawArgs = z.infer<typeof RawInput>;

/** Why this release does not run the operation through ideogram_api, or null. */
export function rawRefusal(op: Operation, allowUndocumented: boolean): string | null {
  const byClass = CLASS_REFUSAL[op.class];
  if (byClass !== undefined) return `${op.id} ${byClass}`;
  if (!servedByRawCall(op)) return `${op.id} is ${supportOf(op)} for a later release of this server, not served by this release`;
  if (op.class === "spec_only" && !allowUndocumented) {
    return `${op.id} is in Ideogram's specification but not in its documentation; set allow_undocumented: true to call it anyway`;
  }
  return null;
}

/** Header parameters are checked by name against the operation's declared ones (the generator emits no header schema). */
function checkHeaders(op: Operation, headers: Readonly<Record<string, string>>): void {
  const declared = op.facts.parameters.filter((p) => p.location === "header").map((p) => p.name.toLowerCase());
  const unknown = Object.keys(headers).filter((name) => !declared.includes(name.toLowerCase()));
  if (unknown.length > 0) {
    throw new Error(`headers: ${op.id} takes ${declared.length === 0 ? "no header parameters" : `only ${declared.join(", ")}`}; not ${unknown.join(", ")}`);
  }
}

function check(label: string, schema: ZodType | null, value: Readonly<Record<string, unknown>>): void {
  if (schema === null) {
    if (Object.keys(value).length > 0) throw new Error(`${label}: this operation takes no ${label} parameters`);
    return;
  }
  if (schema instanceof z.ZodObject) {
    const known = Object.keys(schema.shape);
    const unknown = Object.keys(value).filter((key) => !known.includes(key));
    if (unknown.length > 0) throw new Error(`${label}: unknown field(s) ${unknown.join(", ")}; the fields: ${known.join(", ")}`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
}

/** Checks the four locations against the operation's generated schemas, then builds the request with its uploads. */
async function buildRawRequest(op: Operation, args: RawArgs): Promise<ApiRequest> {
  const params = args.params ?? {};
  const files = args.files ?? [];
  const body = params.body ?? {};
  const arrayFields = new Set(op.facts.fileFields.filter((f) => f.array).map((f) => f.name));
  const grouped: Record<string, unknown> = {};
  for (const f of files) {
    if (arrayFields.has(f.field)) grouped[f.field] = [...((grouped[f.field] as string[] | undefined) ?? []), f.path];
    else grouped[f.field] = f.path;
  }
  const withFiles = { ...body, ...grouped };
  const media = files.length === 0 && op.facts.bodies.includes("json") ? "json" : "multipart";
  if ("dry_run" in (params.query ?? {})) throw new Error("query.dry_run: use the dry_run argument of ideogram_api (the quote path checks the answer as a PriceQuote)");
  check("path", op.schemas.path, params.path ?? {});
  check("query", op.schemas.query, params.query ?? {});
  checkHeaders(op, params.headers ?? {});
  if (op.body === "none") {
    if (Object.keys(withFiles).length > 0) throw new Error(`body: ${op.id} takes no body; given ${Object.keys(withFiles).join(", ")}`);
  } else check("body", bodySchemaFor(op, media), withFiles);
  const noSource = sourceRefusal(op, withFiles);
  const violations = [...constraintViolations(op, withFiles), ...(noSource === null ? [] : [noSource])];
  if (violations.length > 0) throw new Error(violations.join("\n"));
  if (body.async === false && args.dry_run !== true) {
    // a quote prices the request as given; a run with async: false would carry its result only in the POST answer
    throw new Error("async: false is not served: a synchronous generation returns its result only in the POST answer, which this server cannot wait for inside one call; omit async (the job is accepted, then polled) or set wait_s");
  }
  const uploads = await loadUploads(op, files);
  return {
    op,
    path: (params.path ?? {}) as Record<string, Scalar>,
    query: (params.query ?? {}) as Record<string, QueryValue>,
    headers: params.headers ?? {},
    body: op.body === "none" ? null : { media, fields: body, files: uploads, jsonParts: op.facts.jsonParts },
    dryRun: false,
  };
}

async function runRaw(ctx: ToolContext, input: ToolArguments): Promise<CallToolResult> {
  const parsed = RawInput.safeParse(input);
  if (!parsed.success) return textResult(`ideogram_api: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ")}`, true);
  const args = parsed.data;
  const op = operationById(args.operation);
  if (op === null) return textResult(`No operation ${args.operation}; ideogram_operations lists them`, true);
  const refusal = rawRefusal(op, args.allow_undocumented === true);
  if (refusal !== null) return textResult(refusal, true);
  const req = await buildRawRequest(op, args);
  const notes = op.class === "spec_only" ? [`${op.id} is undocumented (spec_only): its behaviour may change without notice`] : [];
  if (args.dry_run === true) {
    const priced = await quote(ctx.client, req, ctx.budget);
    if (priced.kind !== "quote") return outcomeResult(ctx, priced, notes);
    return textResult([quoteText(priced.quote), ...notes].join("\n"));
  }
  const outcome = await execute(ctx.client, req, { waitS: args.wait_s ?? WAIT_DEFAULT_S, clock: ctx.clock, budget: ctx.budget });
  return outcomeResult(ctx, outcome, notes);
}

export const RAW_TOOL: ToolDefinition = {
  name: "ideogram_api",
  title: "Call any served Ideogram operation",
  description:
    "Advanced: call an Ideogram operation by id (from ideogram_operations) when no curated tool covers it — a model the documentation index does not list (allow_undocumented), or a call with webhook_url / target_collection_id. params holds path, query, headers and body apart; files maps local files to file fields. Checked against the operation's own schema before anything is sent; dry_run prices it instead.",
  inputSchema: z.object({
    operation: z.string().min(1).describe("The operation id, e.g. post_precise_edit_image_v2_ideogram45"),
    params: z.record(z.string(), z.unknown()).optional().describe("{path?, query?, headers?, body?}: each an object of that location's parameters"),
    files: z.array(z.object({ field: z.string(), path: z.string() })).optional().describe("Local files, each for one file field"),
    dry_run: z.boolean().optional().describe("Price the call instead of running it (only operations that offer it)"),
    wait_s: z.number().int().min(0).max(WAIT_MAX_S).optional().describe("Seconds to wait for the result (0-50, default 45)"),
    allow_undocumented: z.boolean().optional().describe("Allow an operation Ideogram's documentation does not list"),
  }),
  handler: runRaw,
};
