import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest, downloadImage } from "../client.js";
import { saveImage } from "../storage.js";
import { AspectRatio, RenderingSpeed, MagicPrompt, StyleType, IdeogramResponseSchema, GenerateModel } from "../types.js";
import { assertRequestFits } from "../storage.js";
import { styleControlsSchema, styleControlFiles, assertStyleControlsConsistent, appendStyleControlFields, appendStyleControlFiles } from "../style-controls.js";

export const generateInputSchema = z.object({
  prompt: z.string().min(1).max(10000).describe("Image description (1-10,000 characters)"),
  num_images: z.number().int().min(1).max(8).optional().describe("Number of images to generate (1-8, default: 1)"),
  aspect_ratio: AspectRatio.optional().describe("Output aspect ratio (default: 1x1)"),
  rendering_speed: RenderingSpeed.optional().describe("Speed/quality tradeoff. FLASH=fastest, QUALITY=best (default: DEFAULT)"),
  magic_prompt: MagicPrompt.optional().describe("Auto-enhance prompts (default: AUTO)"),
  style_type: StyleType.optional().describe("Visual style (the API default is GENERAL when omitted)"),
  negative_prompt: z.string().optional().describe("What to exclude from the generated image"),
  seed: z.number().int().min(0).max(2147483647).optional().describe("Reproducibility seed (0-2,147,483,647)"),
  model: GenerateModel.optional().describe(
    "Ideogram model: 3.0 (default; every parameter below) or 4.0 (text prompt, resolution, rendering_speed except FLASH, enable_copyright_detection — the other parameters are refused)",
  ),
  ...styleControlsSchema.shape,
});

type GenerateArgs = z.infer<typeof generateInputSchema>;

/** What Ideogram 4.0 generate accepts besides the prompt; anything else given is refused, never dropped. */
const V4_FIELDS = new Set<keyof GenerateArgs>(["prompt", "model", "resolution", "rendering_speed", "enable_copyright_detection"]);

function buildV4Form(args: GenerateArgs): FormData {
  const given = (Object.keys(args) as (keyof GenerateArgs)[]).filter((k) => args[k] !== undefined && !V4_FIELDS.has(k));
  if (given.length > 0) {
    throw new Error(`Ideogram 4.0 generate does not take: ${given.join(", ")} (use model 3.0, or drop them)`);
  }
  if (args.rendering_speed === "FLASH") throw new Error("Ideogram 4.0 has no FLASH rendering speed yet");
  const form = new FormData();
  form.append("text_prompt", args.prompt);
  if (args.resolution) form.append("resolution", args.resolution);
  if (args.rendering_speed) form.append("rendering_speed", args.rendering_speed);
  if (args.enable_copyright_detection !== undefined) {
    form.append("enable_copyright_detection", String(args.enable_copyright_detection));
  }
  return form;
}

async function buildV3Form(args: GenerateArgs): Promise<FormData> {
  assertStyleControlsConsistent(args);
  await assertRequestFits(styleControlFiles(args));
  const form = new FormData();
  form.append("prompt", args.prompt);
  if (args.num_images !== undefined) form.append("num_images", String(args.num_images));
  if (args.aspect_ratio) form.append("aspect_ratio", args.aspect_ratio);
  if (args.rendering_speed) form.append("rendering_speed", args.rendering_speed);
  if (args.magic_prompt) form.append("magic_prompt", args.magic_prompt);
  if (args.style_type) form.append("style_type", args.style_type);
  if (args.negative_prompt) form.append("negative_prompt", args.negative_prompt);
  if (args.seed !== undefined) form.append("seed", String(args.seed));
  appendStyleControlFields(form, args);
  await appendStyleControlFiles(form, args);
  return form;
}

function formatImageResult(filePath: string, image: { seed: number; is_image_safe: boolean; resolution?: string; prompt?: string }): string {
  return (
    `Saved: ${filePath}\n` +
    `  Seed: ${image.seed}\n` +
    `  Resolution: ${image.resolution ?? "unknown"}\n` +
    `  Safe: ${image.is_image_safe}` +
    (image.prompt ? `\n  Enhanced prompt: ${image.prompt}` : "")
  );
}

export async function handleGenerate(args: GenerateArgs): Promise<CallToolResult> {
  const v4 = args.model === "4.0";
  const form = v4 ? buildV4Form(args) : await buildV3Form(args);
  const raw = await ideogramRequest(v4 ? "/v1/ideogram-v4/generate" : "/v1/ideogram-v3/generate", form);
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
