/**
 * A generation from request to outcome. A call is sent asynchronously when the operation takes `async`, so the API
 * answers with the generation id the moment it accepts the job; the tool then waits a bounded time (default 45 s, at
 * most 50 s: the MCP client times a call out at 60 s), polling GET /v2/generations/{id} at 2 s, ×1.5, capped at 30 s
 * (60 s for video). The outcome is Completed, Failed, Pending (the id, to resume with `ideogram_generation`) or
 * ContractMismatch — a 2xx body the generated schema rejects is never passed off as a success.
 */
import { z } from "zod/v4";
import type { ZodError } from "zod/v4";
import type { IdeogramClient, ApiRequest } from "./client.js";
import { COUNTERS } from "./counters.js";
import { IdeogramApiError } from "./errors.js";
import { zGetGenerationV2Response } from "./generated/zod.gen.js";
import { responseSchemaFor } from "./spec/overlay.js";
import { operationById } from "./spec/operations.js";
import type { Operation } from "./spec/operations.js";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

export const WAIT_DEFAULT_S = 45;
export const WAIT_MAX_S = 50;
export const POLL_FIRST_MS = 2_000;
export const POLL_FACTOR = 1.5;
export const POLL_CAP_MS = 30_000;
export const POLL_CAP_VIDEO_MS = 60_000;

export interface ImageItem {
  readonly url: string | null;
  readonly resolution: string | null;
  readonly seed: number | null;
  readonly prompt: string | null;
  readonly isImageSafe: boolean;
}

export type Payload =
  | { readonly kind: "images"; readonly items: readonly ImageItem[] }
  | { readonly kind: "description"; readonly descriptionId: string; readonly texts: readonly string[]; readonly jsonPrompt: unknown }
  | { readonly kind: "record"; readonly body: unknown };

export interface ContractMismatch {
  readonly kind: "contract_mismatch";
  readonly status: number;
  readonly generationId: string | null;
  /** At most ten issues, each its path and message (never the offending value). */
  readonly issues: readonly string[];
  readonly bodyExcerpt: string;
}

export type Outcome =
  | { readonly kind: "completed"; readonly generationId: string | null; readonly payload: Payload; readonly usageCostUsdMicros: bigint | null }
  | { readonly kind: "pending"; readonly generationId: string; readonly note: string | null }
  | { readonly kind: "failed"; readonly generationId: string; readonly failureReason: string }
  | ContractMismatch;

export interface WaitOptions {
  /** Seconds to wait for the result; 0 returns the generation id at acceptance. Clamped to WAIT_MAX_S. */
  readonly waitS: number;
  readonly clock: Clock;
}

const ImageItemShape = z.looseObject({
  object_type: z.string().optional(),
  url: z.string().nullish(),
  resolution: z.string().optional(),
  seed: z.number().optional(),
  prompt: z.string().optional(),
  is_image_safe: z.boolean().optional(),
});

const BodyShape = z.looseObject({
  generation_id: z.string().optional(),
  data: z.array(z.unknown()).optional(),
  description_id: z.string().optional(),
  descriptions: z.array(z.looseObject({ text: z.string() })).optional(),
  json_prompt: z.unknown().optional(),
});

/** The generation id a body carries, read without trusting the rest of it. */
function generationIdOf(body: unknown): string | null {
  const parsed = BodyShape.safeParse(body);
  return parsed.success ? (parsed.data.generation_id ?? null) : null;
}

export function contractMismatch(status: number, body: unknown, error: ZodError): ContractMismatch {
  COUNTERS.contractMismatches += 1;
  const issues = error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  const text = JSON.stringify(body) ?? String(body);
  return { kind: "contract_mismatch", status, generationId: generationIdOf(body), issues, bodyExcerpt: text.slice(0, 300) };
}

function imageItems(data: readonly unknown[]): ImageItem[] | null {
  const items: ImageItem[] = [];
  for (const raw of data) {
    const item = ImageItemShape.safeParse(raw);
    if (!item.success || (item.data.object_type !== undefined && !item.data.object_type.startsWith("image"))) return null;
    const d = item.data;
    items.push({ url: d.url ?? null, resolution: d.resolution ?? null, seed: d.seed ?? null, prompt: d.prompt ?? null, isImageSafe: d.is_image_safe ?? d.url != null });
  }
  return items;
}

/** The payload of a body that carries one (data, descriptions, a JSON prompt); null for an acknowledgement. */
export function payloadOf(body: unknown): Payload | null {
  const parsed = BodyShape.safeParse(body);
  if (!parsed.success) return { kind: "record", body };
  const b = parsed.data;
  if (b.descriptions !== undefined || b.json_prompt !== undefined) {
    const texts = (b.descriptions ?? []).map((d) => d.text);
    return { kind: "description", descriptionId: b.description_id ?? "", texts, jsonPrompt: b.json_prompt ?? null };
  }
  if (b.data === undefined) return b.generation_id === undefined ? { kind: "record", body } : null;
  const items = imageItems(b.data);
  return items === null ? { kind: "record", body } : { kind: "images", items };
}

/** The request with `async: true` when the operation takes it, so the API answers at acceptance; a caller who set `async`
 * explicitly (ideogram_api) keeps their value. */
export function asAsync(req: ApiRequest): ApiRequest {
  if (req.op.async !== "optional" || req.body === null || req.body.fields.async !== undefined) return req;
  return { ...req, body: { ...req.body, fields: { ...req.body.fields, async: true } } };
}

function clampWait(waitS: number): number {
  return Math.max(0, Math.min(WAIT_MAX_S, waitS));
}

function isVideo(op: Operation): boolean {
  return op.family !== null && op.family.startsWith("video");
}

/** Runs one generation: send (async when possible), then the bounded wait. */
export async function execute(client: IdeogramClient, req: ApiRequest, options: WaitOptions): Promise<Outcome> {
  const started = options.clock.now();
  const result = await client.call(asAsync(req));
  const body = withImageKind(result.body);
  if (req.op.id === GENERATION_OP?.id) {
    // a lookup, not a job: its status is read as one, and a still-pending generation is polled for the rest of the wait
    const id = String(req.path.generation_id ?? "");
    const first = generationOutcome(id, result.status, body);
    if (first.kind !== "pending") return first;
    return poll(client, id, started + clampWait(options.waitS) * 1000, POLL_CAP_MS, options.clock);
  }
  const schema = responseSchemaFor(req.op, false);
  const checked = schema === null ? { success: true as const } : schema.safeParse(body);
  if (!checked.success) return contractMismatch(result.status, body, checked.error);
  const payload = payloadOf(body);
  const generationId = generationIdOf(body);
  if (payload !== null) return { kind: "completed", generationId, payload, usageCostUsdMicros: null };
  if (generationId === null) throw new Error(`${req.op.id} answered without a payload or a generation id`);
  const deadline = started + clampWait(options.waitS) * 1000;
  return poll(client, generationId, deadline, isVideo(req.op) ? POLL_CAP_VIDEO_MS : POLL_CAP_MS, options.clock);
}

/** Resumes a generation by id: the same bounded wait, from now. */
export async function resume(client: IdeogramClient, generationId: string, options: WaitOptions & { readonly video?: boolean }): Promise<Outcome> {
  const deadline = options.clock.now() + clampWait(options.waitS) * 1000;
  const first = await fetchGeneration(client, generationId);
  if (first.kind !== "pending") return first;
  return poll(client, generationId, deadline, options.video ? POLL_CAP_VIDEO_MS : POLL_CAP_MS, options.clock);
}

const GENERATION_OP = operationById("get_generation_v2");

/** A poll failure that says nothing about the generation (the network, a 5xx, a 429): the id stays pending. A 4xx is an
 * answer about the id (404 unknown, 401/403 not this account) and is reported as the error it is. */
function transientPollFailure(error: IdeogramApiError): boolean {
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

/** One poll; a transient failure keeps the id (pending, with the error as its note) and is counted. */
export async function fetchGeneration(client: IdeogramClient, generationId: string, timeoutMs?: number): Promise<Outcome> {
  if (GENERATION_OP === null) throw new Error("the snapshot lacks get_generation_v2");
  let result;
  try {
    result = await client.call({ op: GENERATION_OP, path: { generation_id: generationId }, query: {}, headers: {}, body: null, dryRun: false, timeoutMs });
  } catch (error) {
    if (!(error instanceof IdeogramApiError) || !transientPollFailure(error)) throw error;
    COUNTERS.pollErrors += 1;
    return { kind: "pending", generationId, note: `the last poll failed: ${error.toMcpError()}` };
  }
  return generationOutcome(generationId, result.status, result.body);
}

/** The specification states in prose what its discriminator does not: "entries without an object_type are images". */
export function withImageKind(body: unknown): unknown {
  const parsed = BodyShape.safeParse(body);
  if (!parsed.success || parsed.data.data === undefined) return body;
  const data = parsed.data.data.map((item) =>
    item !== null && typeof item === "object" && !("object_type" in item) ? { ...item, object_type: "image.generation" } : item,
  );
  return { ...(body as Record<string, unknown>), data };
}

function generationOutcome(generationId: string, status: number, body: unknown): Outcome {
  const parsed = zGetGenerationV2Response.safeParse(withImageKind(body));
  if (!parsed.success) return contractMismatch(status, body, parsed.error);
  const g = parsed.data;
  if (g.status === "failed") return { kind: "failed", generationId, failureReason: g.failure_reason ?? "(no reason given)" };
  if (g.status === "pending") return { kind: "pending", generationId, note: null };
  const payload = payloadOf({ data: g.data ?? [] }) ?? { kind: "record", body };
  return { kind: "completed", generationId, payload, usageCostUsdMicros: g.usage_cost_usd_micros ?? null };
}

async function poll(client: IdeogramClient, generationId: string, deadline: number, capMs: number, clock: Clock): Promise<Outcome> {
  let delay = POLL_FIRST_MS;
  for (;;) {
    if (clock.now() + delay > deadline) return { kind: "pending", generationId, note: null };
    await clock.sleep(delay);
    // the poll may not outlive the wait: its timeout is what remains of the deadline (at least one second)
    const outcome = await fetchGeneration(client, generationId, Math.max(1_000, deadline - clock.now()));
    if (outcome.kind !== "pending" || outcome.note !== null) return outcome;
    delay = Math.min(delay * POLL_FACTOR, capMs);
  }
}
