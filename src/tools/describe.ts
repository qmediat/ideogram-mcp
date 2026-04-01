import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ideogramRequest } from "../client.js";
import { DescribeModelVersion, IdeogramDescribeResponseSchema } from "../types.js";
import { loadImageBlob } from "../image-input.js";

export const describeInputSchema = z.object({
  image: z.string().min(1).describe("Local file path of the image to describe"),
  describe_model_version: DescribeModelVersion.optional().describe("Model version to use (default: V_3)"),
});

export async function handleDescribe(
  args: z.infer<typeof describeInputSchema>,
): Promise<CallToolResult> {
  const imageInput = await loadImageBlob(args.image);

  const form = new FormData();
  form.append("image_file", imageInput.blob, imageInput.filename);
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
