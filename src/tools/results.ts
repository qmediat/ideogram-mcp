/**
 * An Outcome as the text a tool returns. Images are downloaded into the output directory (an unsafe image — no URL —
 * is counted, never fetched; a failed download is counted and listed); the generation id is always shown so a client
 * never resubmits paid work; a cost is shown when the API reports one; every 1.x mapping the adapter made is said.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { COUNTERS } from "../counters.js";
import { IdeogramApiError } from "../errors.js";
import { microsToUsd } from "../cost.js";
import type { ImageItem, LayeredItem, Outcome, Payload } from "../lifecycle.js";
import type { ToolContext } from "./context.js";

/** JSON text of a value that may hold bigints (the generated schemas parse int64 as bigint). */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2) ?? "null";
}

function imageLine(path: string, item: ImageItem): string {
  const lines = [`Saved: ${path}`, `  Resolution: ${item.resolution ?? "unknown"}`];
  if (item.seed !== null) lines.push(`  Seed: ${item.seed}`);
  if (item.prompt !== null) lines.push(`  Prompt used: ${item.prompt}`);
  return lines.join("\n");
}

/** Downloads the images Ideogram's safety check passed and that have a URL (the specification says a withheld image
 * has none; one that carries both is still withheld, never fetched). */
async function saveImages(ctx: ToolContext, items: readonly ImageItem[]): Promise<{ lines: string[]; saved: number }> {
  const safe = items.filter((item) => item.url !== null && item.isImageSafe);
  const results = await Promise.allSettled(safe.map((item) => ctx.client.download(item.url as string, ctx.outputDir, ctx.budget)));
  const lines: string[] = [];
  let saved = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      saved += 1;
      lines.push(imageLine(result.value.path, safe[i]));
      return;
    }
    COUNTERS.downloadFailures += 1;
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const later = result.reason instanceof IdeogramApiError && result.reason.code === "CALL_TIMEOUT" ? " (ideogram_generation with the id above saves the generation's images in a new call)" : "";
    lines.push(`Not saved: ${safe[i].url} — ${reason}${later}`);
  });
  const unsafe = items.length - safe.length;
  if (unsafe > 0) lines.push(`${unsafe} image(s) withheld by Ideogram's safety check (nothing downloaded)`);
  return { lines, saved };
}

/** A withheld design is said and nothing of it is shown; a safe one lists what Ideogram gave. */
function designLines(item: LayeredItem, i: number): string[] {
  if (!item.isImageSafe) return [`Design ${i + 1} withheld by Ideogram's safety check (nothing shown, nothing downloaded)`];
  return [
    ...(item.baseImageUrl === null ? [`Design ${i + 1}: no base image listed by Ideogram`] : []),
    ...(item.url === null ? [] : [`Design ${i + 1}: ${item.url} (Ideogram's links expire; download it to keep it)`]),
    ...(item.htmlUrl === null ? [] : [`Editable page of design ${i + 1}: ${item.htmlUrl} (expires as well)`]),
    `Text blocks of design ${i + 1} (${item.textBlocks.length}):\n${jsonText(item.textBlocks)}`,
  ];
}

/** A layerized design: its base image (when listed) is saved as any image is; its link, its editable page and its
 * text blocks follow. A design is usable by its base image, its link, its page or its text blocks; only one Ideogram
 * withheld, or one that lists none of them, is an error. */
async function layeredResult(ctx: ToolContext, items: readonly LayeredItem[]): Promise<{ lines: string[]; isError: boolean }> {
  const withBase = items.filter((item) => item.isImageSafe && item.baseImageUrl !== null);
  const base: ImageItem[] = withBase.map((item) => ({ url: item.baseImageUrl, resolution: item.resolution, seed: item.seed, prompt: null, isImageSafe: true }));
  const images = await saveImages(ctx, base);
  const usable = items.some((item) => item.isImageSafe && (item.url !== null || item.htmlUrl !== null || item.textBlocks.length > 0)) || images.saved > 0;
  const head = `${images.saved} of ${withBase.length} base image(s) saved (${items.length} design(s)).`;
  return { lines: [head, ...images.lines, ...items.flatMap(designLines)], isError: !usable };
}

function descriptionLines(payload: Extract<Payload, { kind: "description" }>): string[] {
  const lines = payload.texts.map((text, i) => `${i + 1}. ${text}`);
  if (payload.jsonPrompt !== null) lines.push(`JSON prompt:\n${jsonText(payload.jsonPrompt)}`);
  return lines;
}

async function completedResult(ctx: ToolContext, outcome: Extract<Outcome, { kind: "completed" }>): Promise<{ lines: string[]; isError: boolean }> {
  const head = outcome.generationId === null ? [] : [`Generation ${outcome.generationId} completed.`];
  if (outcome.usageCostUsdMicros !== null) head.push(`Cost reported by Ideogram: ${microsToUsd(outcome.usageCostUsdMicros)} USD`);
  const payload = outcome.payload;
  if (payload.kind === "description") return { lines: [...head, ...descriptionLines(payload)], isError: false };
  if (payload.kind === "record") return { lines: [...head, jsonText(payload.body)], isError: false };
  if (payload.kind === "layered") {
    const layered = await layeredResult(ctx, payload.items);
    return { lines: [...head, ...layered.lines], isError: layered.isError };
  }
  if (payload.items.length === 0) return { lines: [...head, "Ideogram listed no image for this generation (nothing to save)."], isError: true };
  const images = await saveImages(ctx, payload.items);
  const summary = `${images.saved} of ${payload.items.length} image(s) saved.`;
  return { lines: [...head, summary, ...images.lines], isError: images.saved === 0 };
}

function otherResult(outcome: Exclude<Outcome, { kind: "completed" }>): { lines: string[]; isError: boolean } {
  switch (outcome.kind) {
    case "pending":
      return {
        lines: [
          `Accepted: generation ${outcome.generationId} is still running.`,
          `Collect it with ideogram_generation {"generation_id": "${outcome.generationId}"} — do not send the request again (it would be billed again).`,
          ...(outcome.note === null ? [] : [outcome.note]),
        ],
        isError: false,
      };
    case "failed":
      return { lines: [`Generation ${outcome.generationId} failed: ${outcome.failureReason}`], isError: true };
    case "contract_mismatch":
      return {
        lines: [
          `Ideogram answered ${outcome.status} with a body that does not match its own specification; not treated as a success.`,
          ...(outcome.generationId === null ? [] : [`Generation id: ${outcome.generationId} (ideogram_generation can look it up)`]),
          ...outcome.issues.map((issue) => `  ${issue}`),
          `Body (start): ${outcome.bodyExcerpt}`,
        ],
        isError: true,
      };
  }
}

export async function outcomeResult(ctx: ToolContext, outcome: Outcome, notes: readonly string[]): Promise<CallToolResult> {
  const shaped = outcome.kind === "completed" ? await completedResult(ctx, outcome) : otherResult(outcome);
  const lines = notes.length === 0 ? shaped.lines : [...shaped.lines, `Mapped from the 1.x inputs: ${notes.join("; ")}`];
  return { content: [{ type: "text", text: lines.join("\n") }], ...(shaped.isError ? { isError: true } : {}) };
}

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}
