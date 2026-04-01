import { z } from "zod/v4";

export const AspectRatio = z.enum([
  "1x1", "16x9", "9x16", "4x3", "3x4", "3x2", "2x3",
  "4x5", "5x4", "1x2", "2x1", "1x3", "3x1", "10x16", "16x10",
]);

export const RenderingSpeed = z.enum(["FLASH", "TURBO", "DEFAULT", "QUALITY"]);

export const StyleType = z.enum(["AUTO", "GENERAL", "REALISTIC", "DESIGN", "FICTION"]);

export const MagicPrompt = z.enum(["AUTO", "ON", "OFF"]);

export const DescribeModelVersion = z.enum(["V_2", "V_3"]);

// All 69 valid resolutions for the reframe endpoint (from Ideogram V3 API spec)
export const ReframeResolution = z.enum([
  "512x1536", "576x1408", "576x1472", "576x1536",
  "640x1344", "640x1408", "640x1472", "640x1536",
  "704x1152", "704x1216", "704x1280", "704x1344", "704x1408", "704x1472",
  "736x1312",
  "768x1088", "768x1216", "768x1280", "768x1344",
  "800x1280",
  "832x960", "832x1024", "832x1088", "832x1152", "832x1216", "832x1248",
  "864x1152",
  "896x960", "896x1024", "896x1088", "896x1120", "896x1152",
  "960x832", "960x896", "960x1024", "960x1088",
  "1024x832", "1024x896", "1024x960", "1024x1024",
  "1088x768", "1088x832", "1088x896", "1088x960",
  "1120x896",
  "1152x704", "1152x832", "1152x864", "1152x896",
  "1216x704", "1216x768", "1216x832",
  "1248x832",
  "1280x704", "1280x768", "1280x800",
  "1312x736",
  "1344x640", "1344x704", "1344x768",
  "1408x576", "1408x640", "1408x704",
  "1472x576", "1472x640", "1472x704",
  "1536x512", "1536x576", "1536x640",
]);

// Response validation schemas — url is nullable (null when is_image_safe=false)
export const IdeogramImageDataSchema = z.object({
  url: z.string().url().nullable(),
  seed: z.number(),
  is_image_safe: z.boolean(),
  prompt: z.string().optional(),
  resolution: z.string().optional(),
}).passthrough();

export const IdeogramResponseSchema = z.object({
  created: z.union([z.string(), z.number()]),
  data: z.array(IdeogramImageDataSchema).min(1),
}).passthrough();

export const IdeogramDescribeResponseSchema = z.object({
  descriptions: z.array(z.object({ text: z.string() }).passthrough()).min(1),
}).passthrough();

export type IdeogramImageData = z.infer<typeof IdeogramImageDataSchema>;
export type IdeogramResponse = z.infer<typeof IdeogramResponseSchema>;
export type IdeogramDescribeResponse = z.infer<typeof IdeogramDescribeResponseSchema>;
