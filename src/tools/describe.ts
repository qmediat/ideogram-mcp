import { z } from "zod/v4";
import { readFile } from "node:fs/promises";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest } from "../client.js";
import { DescribeModelVersion, IdeogramDescribeResponseSchema } from "../types.js";
import { validateInputImage } from "../storage.js";

export const describeInputSchema = z.object({
  image: z.string().min(1).describe("Local file path of the image to describe"),
  describe_model_version: DescribeModelVersion.optional().describe("Model version to use (default: V_3)"),
});

export async function handleDescribe(
  args: z.infer<typeof describeInputSchema>,
): Promise<CallToolResult> {
  // Validate: extension must be image, file must exist, size must be <= 10MB
  const { resolvedPath, meta } = await validateInputImage(args.image);

  const imageBuffer = await readFile(resolvedPath);
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: meta.mimeType });

  const form = new FormData();
  form.append("image_file", blob, meta.filename);
  if (args.describe_model_version) {
    form.append("describe_model_version", args.describe_model_version);
  }

  const raw = await ideogramRequest("/describe", form);
  const response = IdeogramDescribeResponseSchema.parse(raw);

  const descriptions = response.descriptions
    .map((d, i) => `${i + 1}. ${d.text}`)
    .join("\n\n");

  return {
    content: [
      {
        type: "text" as const,
        text: `Image description:\n\n${descriptions}`,
      },
    ],
  };
}
