import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest, downloadImage } from "../client.js";
import { saveImage } from "../storage.js";
import { AspectRatio, RenderingSpeed, MagicPrompt, StyleType, IdeogramResponseSchema } from "../types.js";
import { loadImageBlob } from "../image-input.js";

export const remixInputSchema = z.object({
  image: z.string().min(1).describe("Local file path of the source image to remix"),
  prompt: z.string().min(1).max(10000).describe("New creative direction"),
  image_weight: z.number().int().min(0).max(100).optional().describe("Original image influence (0-100, default: 50)"),
  num_images: z.number().int().min(1).max(8).optional().describe("Number of variations (1-8, default: 1)"),
  aspect_ratio: AspectRatio.optional().describe("Output aspect ratio"),
  rendering_speed: RenderingSpeed.optional().describe("Speed/quality tradeoff (default: DEFAULT)"),
  magic_prompt: MagicPrompt.optional().describe("Auto-enhance prompts (default: AUTO)"),
  style_type: StyleType.optional().describe("Visual style (default: AUTO)"),
  negative_prompt: z.string().optional().describe("What to exclude"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Reproducibility seed"),
});

export async function handleRemix(
  args: z.infer<typeof remixInputSchema>,
): Promise<CallToolResult> {
  const imageInput = await loadImageBlob(args.image);

  const form = new FormData();
  form.append("image", imageInput.blob, imageInput.filename);
  form.append("prompt", args.prompt);
  if (args.image_weight !== undefined) form.append("image_weight", String(args.image_weight));
  if (args.num_images !== undefined) form.append("num_images", String(args.num_images));
  if (args.aspect_ratio) form.append("aspect_ratio", args.aspect_ratio);
  if (args.rendering_speed) form.append("rendering_speed", args.rendering_speed);
  if (args.magic_prompt) form.append("magic_prompt", args.magic_prompt);
  if (args.style_type) form.append("style_type", args.style_type);
  if (args.negative_prompt) form.append("negative_prompt", args.negative_prompt);
  if (args.seed !== undefined) form.append("seed", String(args.seed));

  const raw = await ideogramRequest("/v1/ideogram-v3/remix", form);
  const response = IdeogramResponseSchema.parse(raw);

  const safeImages = response.data.filter((img) => img.url !== null);
  const unsafeImages = response.data.filter((img) => img.url === null);

  const results = await Promise.allSettled(
    safeImages.map(async (image) => {
      const { buffer, extension } = await downloadImage(image.url!);
      const filePath = await saveImage(buffer, extension);
      return (
        `Saved: ${filePath}\n  Seed: ${image.seed}\n  Resolution: ${image.resolution ?? "unknown"}\n  Safe: ${image.is_image_safe}` +
        (image.prompt ? `\n  Enhanced prompt: ${image.prompt}` : "")
      );
    }),
  );

  const succeeded = results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

  const lines: string[] = [];
  if (succeeded.length > 0) lines.push(`${succeeded.length} remixed image(s) saved:\n`, ...succeeded.map((r) => r.value));
  if (unsafeImages.length > 0) lines.push(`${unsafeImages.length} image(s) flagged as unsafe`);
  if (failed.length > 0) lines.push(`${failed.length} failed:\n`, ...failed.map((r) => `  Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`));

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(failed.length > 0 && succeeded.length === 0 ? { isError: true } : {}),
  };
}
