import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest, downloadImage } from "../client.js";
import { saveImage, inputImageSize, MAX_REQUEST_SIZE, MULTIPART_OVERHEAD } from "../storage.js";
import { RenderingSpeed, MagicPrompt, StyleType, IdeogramResponseSchema } from "../types.js";
import { loadImageBlob } from "../image-input.js";

export const editInputSchema = z.object({
  image: z.string().min(1).describe("Local file path of the source image to edit"),
  mask: z.string().min(1).describe("Local file path of the mask image (black = regions to edit, white = keep)"),
  prompt: z.string().min(1).max(10000).describe("Description of desired changes"),
  num_images: z.number().int().min(1).max(8).optional().describe("Number of variations (1-8, default: 1)"),
  rendering_speed: RenderingSpeed.optional().describe("Speed/quality tradeoff (default: DEFAULT)"),
  magic_prompt: MagicPrompt.optional().describe("Auto-enhance prompts (default: AUTO)"),
  style_type: StyleType.optional().describe("Visual style (the API default is GENERAL when omitted)"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Reproducibility seed"),
});

export async function handleEdit(
  args: z.infer<typeof editInputSchema>,
): Promise<CallToolResult> {
  // Both sizes from stat, before either file is read: a pair that cannot fit the request is refused without
  // allocating up to 50 MB. The multipart overhead (boundaries, part headers, the prompt) is reserved from the limit.
  const [imageSize, maskSize] = await Promise.all([inputImageSize(args.image), inputImageSize(args.mask)]);
  const total = imageSize + maskSize;
  if (total > MAX_REQUEST_SIZE - MULTIPART_OVERHEAD) {
    throw new Error(
      `Image and mask together are ${(total / 1024 / 1024).toFixed(1)}MB; Ideogram accepts a request under 50MB including the multipart overhead (each file up to 25MB)`,
    );
  }

  const [imageInput, maskInput] = await Promise.all([
    loadImageBlob(args.image),
    loadImageBlob(args.mask),
  ]);

  const form = new FormData();
  form.append("image", imageInput.blob, imageInput.filename);
  form.append("mask", maskInput.blob, maskInput.filename);
  form.append("prompt", args.prompt);
  if (args.num_images !== undefined) form.append("num_images", String(args.num_images));
  if (args.rendering_speed) form.append("rendering_speed", args.rendering_speed);
  if (args.magic_prompt) form.append("magic_prompt", args.magic_prompt);
  if (args.style_type) form.append("style_type", args.style_type);
  if (args.seed !== undefined) form.append("seed", String(args.seed));

  // Ideogram marks /v1/ideogram-v3/edit "Legacy: use /v1/ideogram-v3/inpaint instead. This endpoint will be removed in
  // a future release" (https://developer.ideogram.ai/api-reference/api-reference/edit-v3, read 2026-10-01); inpaint
  // takes the same image/mask/prompt fields (https://developer.ideogram.ai/api-reference/api-reference/inpaint-v3).
  const raw = await ideogramRequest("/v1/ideogram-v3/inpaint", form);
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
  if (succeeded.length > 0) lines.push(`${succeeded.length} edited image(s) saved:\n`, ...succeeded.map((r) => r.value));
  if (unsafeImages.length > 0) lines.push(`${unsafeImages.length} image(s) flagged as unsafe`);
  if (failed.length > 0) lines.push(`${failed.length} failed:\n`, ...failed.map((r) => `  Error: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`));

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    ...(succeeded.length === 0 ? { isError: true } : {}),
  };
}
