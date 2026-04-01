import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest, downloadImage } from "../client.js";
import { saveImage } from "../storage.js";
import { AspectRatio, RenderingSpeed, MagicPrompt, StyleType, IdeogramResponseSchema } from "../types.js";

export const generateInputSchema = z.object({
  prompt: z.string().min(1).max(10000).describe("Image description (1-10,000 characters)"),
  num_images: z.number().int().min(1).max(8).optional().describe("Number of images to generate (1-8, default: 1)"),
  aspect_ratio: AspectRatio.optional().describe("Output aspect ratio (default: 1x1)"),
  rendering_speed: RenderingSpeed.optional().describe("Speed/quality tradeoff. FLASH=fastest, QUALITY=best (default: DEFAULT)"),
  magic_prompt: MagicPrompt.optional().describe("Auto-enhance prompts (default: AUTO)"),
  style_type: StyleType.optional().describe("Visual style (default: AUTO)"),
  negative_prompt: z.string().optional().describe("What to exclude from the generated image"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Reproducibility seed (0-2,147,483,647)"),
});

function formatImageResult(filePath: string, image: { seed: number; is_image_safe: boolean; resolution?: string; prompt?: string }): string {
  return (
    `Saved: ${filePath}\n` +
    `  Seed: ${image.seed}\n` +
    `  Resolution: ${image.resolution ?? "unknown"}\n` +
    `  Safe: ${image.is_image_safe}` +
    (image.prompt ? `\n  Enhanced prompt: ${image.prompt}` : "")
  );
}

export async function handleGenerate(
  args: z.infer<typeof generateInputSchema>,
): Promise<CallToolResult> {
  const form = new FormData();
  form.append("prompt", args.prompt);
  if (args.num_images !== undefined) form.append("num_images", String(args.num_images));
  if (args.aspect_ratio) form.append("aspect_ratio", args.aspect_ratio);
  if (args.rendering_speed) form.append("rendering_speed", args.rendering_speed);
  if (args.magic_prompt) form.append("magic_prompt", args.magic_prompt);
  if (args.style_type) form.append("style_type", args.style_type);
  if (args.negative_prompt) form.append("negative_prompt", args.negative_prompt);
  if (args.seed !== undefined) form.append("seed", String(args.seed));

  const raw = await ideogramRequest("/v1/ideogram-v3/generate", form);
  const response = IdeogramResponseSchema.parse(raw);

  // Separate safe (downloadable) from unsafe (url=null) images
  const safeImages = response.data.filter((img) => img.url !== null);
  const unsafeImages = response.data.filter((img) => img.url === null);

  const results = await Promise.allSettled(
    safeImages.map(async (image) => {
      const { buffer, extension } = await downloadImage(image.url!);
      const filePath = await saveImage(buffer, extension);
      return formatImageResult(filePath, image);
    }),
  );

  const succeeded = results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

  const lines: string[] = [];
  if (succeeded.length > 0) {
    lines.push(`${succeeded.length} image(s) saved:\n`);
    lines.push(...succeeded.map((r) => r.value));
  }
  if (unsafeImages.length > 0) {
    lines.push(`\n${unsafeImages.length} image(s) flagged as unsafe (not downloaded):\n`);
    lines.push(...unsafeImages.map((img) => `  Seed: ${img.seed} — blocked by safety filter`));
  }
  if (failed.length > 0) {
    lines.push(`\n${failed.length} image(s) failed to download:\n`);
    lines.push(...failed.map((r) => `  Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`));
  }

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(succeeded.length === 0 ? { isError: true } : {}),
  };
}
