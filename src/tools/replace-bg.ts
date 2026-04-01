import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest, downloadImage } from "../client.js";
import { saveImage } from "../storage.js";
import { RenderingSpeed, MagicPrompt, IdeogramResponseSchema } from "../types.js";
import { loadImageBlob } from "../image-input.js";

export const replaceBgInputSchema = z.object({
  image: z.string().min(1).describe("Local file path of the source image"),
  prompt: z.string().min(1).max(10000).describe("Description of the new background"),
  num_images: z.number().int().min(1).max(8).optional().describe("Number of variations (1-8, default: 1)"),
  rendering_speed: RenderingSpeed.optional().describe("Speed/quality tradeoff (default: DEFAULT)"),
  magic_prompt: MagicPrompt.optional().describe("Auto-enhance prompts (default: AUTO)"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Reproducibility seed"),
});

export async function handleReplaceBg(
  args: z.infer<typeof replaceBgInputSchema>,
): Promise<CallToolResult> {
  const imageInput = await loadImageBlob(args.image);

  const form = new FormData();
  form.append("image", imageInput.blob, imageInput.filename);
  form.append("prompt", args.prompt);
  if (args.num_images !== undefined) form.append("num_images", String(args.num_images));
  if (args.rendering_speed) form.append("rendering_speed", args.rendering_speed);
  if (args.magic_prompt) form.append("magic_prompt", args.magic_prompt);
  if (args.seed !== undefined) form.append("seed", String(args.seed));

  const raw = await ideogramRequest("/v1/ideogram-v3/replace-background", form);
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
  if (succeeded.length > 0) lines.push(`${succeeded.length} image(s) with new background saved:\n`, ...succeeded.map((r) => r.value));
  if (failed.length > 0) lines.push(`${failed.length} failed:\n`, ...failed.map((r) => `  Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`));

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(failed.length > 0 && succeeded.length === 0 ? { isError: true } : {}),
  };
}
