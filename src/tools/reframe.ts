import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest, downloadImage } from "../client.js";
import { saveImage } from "../storage.js";
import { RenderingSpeed, ReframeResolution, IdeogramResponseSchema } from "../types.js";
import { loadImageBlob } from "../image-input.js";

export const reframeInputSchema = z.object({
  image: z.string().min(1).describe("Local file path of the source image to reframe"),
  resolution: ReframeResolution.describe("Target resolution (e.g. 1024x1024, 1536x640). See Ideogram docs for all 69 valid resolutions."),
  num_images: z.number().int().min(1).max(8).optional().describe("Number of variations (1-8, default: 1)"),
  rendering_speed: RenderingSpeed.optional().describe("Speed/quality tradeoff (default: DEFAULT)"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Reproducibility seed"),
});

export async function handleReframe(
  args: z.infer<typeof reframeInputSchema>,
): Promise<CallToolResult> {
  const imageInput = await loadImageBlob(args.image);

  const form = new FormData();
  form.append("image", imageInput.blob, imageInput.filename);
  form.append("resolution", args.resolution);
  if (args.num_images !== undefined) form.append("num_images", String(args.num_images));
  if (args.rendering_speed) form.append("rendering_speed", args.rendering_speed);
  if (args.seed !== undefined) form.append("seed", String(args.seed));

  const raw = await ideogramRequest("/v1/ideogram-v3/reframe", form);
  const response = IdeogramResponseSchema.parse(raw);

  const safeImages = response.data.filter((img) => img.url !== null);
  const unsafeImages = response.data.filter((img) => img.url === null);

  const results = await Promise.allSettled(
    safeImages.map(async (image) => {
      const { buffer, extension } = await downloadImage(image.url!);
      const filePath = await saveImage(buffer, extension);
      return `Saved: ${filePath}\n  Seed: ${image.seed}\n  Resolution: ${image.resolution ?? "unknown"}\n  Safe: ${image.is_image_safe}`;
    }),
  );

  const succeeded = results.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

  const lines: string[] = [];
  if (succeeded.length > 0) lines.push(`${succeeded.length} reframed image(s) saved:\n`, ...succeeded.map((r) => r.value));
  if (unsafeImages.length > 0) lines.push(`${unsafeImages.length} image(s) flagged as unsafe`);
  if (failed.length > 0) lines.push(`${failed.length} failed:\n`, ...failed.map((r) => `  Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`));

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(succeeded.length === 0 ? { isError: true } : {}),
  };
}
