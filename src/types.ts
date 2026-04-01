import { z } from "zod/v4";

export const AspectRatio = z.enum([
  "1x1", "16x9", "9x16", "4x3", "3x4", "3x2", "2x3",
  "4x5", "5x4", "1x2", "2x1", "1x3", "3x1", "10x16", "16x10",
]);

export const RenderingSpeed = z.enum(["FLASH", "TURBO", "DEFAULT", "QUALITY"]);

export const StyleType = z.enum(["AUTO", "GENERAL", "REALISTIC", "DESIGN", "FICTION"]);

export const MagicPrompt = z.enum(["AUTO", "ON", "OFF"]);

export const DescribeModelVersion = z.enum(["V_2", "V_3"]);

// Response validation schemas
export const IdeogramImageDataSchema = z.object({
  url: z.string().url(),
  seed: z.number(),
  is_image_safe: z.boolean(),
  prompt: z.string().optional(),
  resolution: z.string().optional(),
}).passthrough();

export const IdeogramResponseSchema = z.object({
  created: z.string(),
  data: z.array(IdeogramImageDataSchema).min(1),
}).passthrough();

export const IdeogramDescribeResponseSchema = z.object({
  descriptions: z.array(z.object({ text: z.string() }).passthrough()).min(1),
}).passthrough();

export type IdeogramImageData = z.infer<typeof IdeogramImageDataSchema>;
export type IdeogramResponse = z.infer<typeof IdeogramResponseSchema>;
export type IdeogramDescribeResponse = z.infer<typeof IdeogramDescribeResponseSchema>;
