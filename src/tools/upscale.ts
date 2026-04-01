import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest, downloadImage } from "../client.js";
import { saveImage } from "../storage.js";
import { MagicPrompt, IdeogramResponseSchema } from "../types.js";
import { loadImageBlob } from "../image-input.js";

export const upscaleInputSchema = z.object({
  image: z.string().min(1).describe("Local file path of the image to upscale"),
  prompt: z.string().optional().describe("Guide the upscaling enhancement"),
  resemblance: z.number().int().min(0).max(100).optional().describe("Similarity to original (0-100, default: 50)"),
  detail: z.number().int().min(0).max(100).optional().describe("Detail to add (0-100, default: 50)"),
  magic_prompt: MagicPrompt.optional().describe("Auto-enhance prompts (AUTO/ON/OFF)"),
  num_images: z.number().int().min(1).max(8).optional().describe("Number of variations (1-8, default: 1)"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Reproducibility seed"),
});

export async function handleUpscale(
  args: z.infer<typeof upscaleInputSchema>,
): Promise<CallToolResult> {
  const imageInput = await loadImageBlob(args.image);

  // Upscale uses image_request JSON wrapper for params
  const imageRequest: Record<string, unknown> = {};
  if (args.prompt) imageRequest.prompt = args.prompt;
  if (args.resemblance !== undefined) imageRequest.resemblance = args.resemblance;
  if (args.detail !== undefined) imageRequest.detail = args.detail;
  if (args.magic_prompt) imageRequest.magic_prompt_option = args.magic_prompt;
  if (args.num_images !== undefined) imageRequest.num_images = args.num_images;
  if (args.seed !== undefined) imageRequest.seed = args.seed;

  const form = new FormData();
  form.append("image_file", imageInput.blob, imageInput.filename);
  if (Object.keys(imageRequest).length > 0) {
    form.append("image_request", JSON.stringify(imageRequest));
  }

  const raw = await ideogramRequest("/upscale", form);
  const response = IdeogramResponseSchema.parse(raw);

  const results = await Promise.allSettled(
    response.data.map(async (image) => {
      const { buffer, extension } = await downloadImage(image.url);
      const filePath = await saveImage(buffer, extension);
      return `Saved: ${filePath}\n  Seed: ${image.seed}\n  Resolution: ${image.resolution ?? "unknown"}`;
    }),
  );

  const succeeded = results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

  const lines: string[] = [];
  if (succeeded.length > 0) lines.push(`${succeeded.length} upscaled image(s) saved:\n`, ...succeeded.map((r) => r.value));
  if (failed.length > 0) lines.push(`${failed.length} failed:\n`, ...failed.map((r) => `  Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`));

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(failed.length > 0 && succeeded.length === 0 ? { isError: true } : {}),
  };
}
