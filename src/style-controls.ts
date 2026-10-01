/** The style and character controls every Ideogram 3.0 generation endpoint accepts (generate, remix, inpaint):
 * reference images, style codes, a style preset, a colour palette, an exact resolution, a custom model and the
 * copyright check. One schema, one encoder, one list of the files they add to the request. */
import { z } from "zod/v4";
import { loadImageBlob } from "./image-input.js";

/** Ideogram's named palettes (the `name` form of `color_palette`). */
export const ColorPalettePreset = z.enum(["EMBER", "FRESH", "JUNGLE", "MAGIC", "MELON", "MOSAIC", "PASTEL", "ULTRAMARINE"]);

const ColorHex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "a colour as #RRGGBB");

export const ColorPaletteMember = z.object({
  color_hex: ColorHex.describe("The colour, #RRGGBB"),
  color_weight: z.number().min(0.05).max(1).optional().describe("Its share of the palette (0.05-1)"),
});

/** Either a preset by name or up to ten explicit members. */
export const ColorPalette = z.union([
  z.object({ name: ColorPalettePreset.describe("A preset palette") }),
  z.object({ members: z.array(ColorPaletteMember).min(1).max(10).describe("Explicit colours, most dominant first") }),
]);

export const StyleCode = z.string().regex(/^[0-9A-Fa-f]{8}$/, "an 8-character hexadecimal style code");

/** A resolution as Ideogram lists them, e.g. 1024x1024 or 1536x640; the API refuses one it does not offer. */
export const Resolution = z.string().regex(/^\d{3,4}x\d{3,4}$/, "WIDTHxHEIGHT");

export const CustomModelUri = z.string().regex(/^model\/[^/\s]+\/version\/[^/\s]+$/, "model/<name>/version/<version>");

export const styleControlsSchema = z.object({
  style_reference_images: z
    .array(z.string().min(1))
    .min(1)
    .max(3)
    .optional()
    .describe("Local image files whose style the result follows (up to 3, 25 MB each)"),
  character_reference_image: z
    .string()
    .min(1)
    .optional()
    .describe("Local image file of a character to keep consistent (one image)"),
  character_reference_mask: z
    .string()
    .min(1)
    .optional()
    .describe("Grayscale mask of the character reference (same dimensions); needs character_reference_image"),
  style_codes: z.array(StyleCode).min(1).max(8).optional().describe("8-character hexadecimal style codes from Ideogram"),
  style_preset: z.string().min(1).max(100).optional().describe("A named style preset as Ideogram lists them"),
  color_palette: ColorPalette.optional().describe("A preset palette by name, or explicit colours with weights"),
  resolution: Resolution.optional().describe("Exact output resolution (e.g. 1024x1024); replaces aspect_ratio"),
  custom_model_uri: CustomModelUri.optional().describe("A custom (trained) model: model/<name>/version/<version>"),
  enable_copyright_detection: z.boolean().optional().describe("Run Ideogram's copyright detection on the result"),
});

export type StyleControls = z.infer<typeof styleControlsSchema>;

/** The names of every style-control field: a caller can tell whether any was given. */
export const STYLE_CONTROL_KEYS = Object.keys(styleControlsSchema.shape) as (keyof StyleControls)[];

/** The local files the controls add to the request, in the order they are sent. */
export function styleControlFiles(args: StyleControls): string[] {
  const files = [...(args.style_reference_images ?? [])];
  if (args.character_reference_image) files.push(args.character_reference_image);
  if (args.character_reference_mask) files.push(args.character_reference_mask);
  return files;
}

/** A mask without its character image is an error before anything is read. */
export function assertStyleControlsConsistent(args: StyleControls): void {
  if (args.character_reference_mask && !args.character_reference_image) {
    throw new Error("character_reference_mask needs character_reference_image");
  }
}

/** Appends the scalar controls to the multipart form: lists as repeated fields, the palette as JSON. */
export function appendStyleControlFields(form: FormData, args: StyleControls): void {
  for (const code of args.style_codes ?? []) form.append("style_codes", code);
  if (args.style_preset) form.append("style_preset", args.style_preset);
  if (args.color_palette) form.append("color_palette", JSON.stringify(args.color_palette));
  if (args.resolution) form.append("resolution", args.resolution);
  if (args.custom_model_uri) form.append("custom_model_uri", args.custom_model_uri);
  if (args.enable_copyright_detection !== undefined) {
    form.append("enable_copyright_detection", String(args.enable_copyright_detection));
  }
}

/** Reads and appends the reference images under the field names the API expects. */
export async function appendStyleControlFiles(form: FormData, args: StyleControls): Promise<void> {
  for (const path of args.style_reference_images ?? []) {
    const { blob, filename } = await loadImageBlob(path);
    form.append("style_reference_images", blob, filename);
  }
  if (args.character_reference_image) {
    const { blob, filename } = await loadImageBlob(args.character_reference_image);
    form.append("character_reference_images", blob, filename);
  }
  if (args.character_reference_mask) {
    const { blob, filename } = await loadImageBlob(args.character_reference_mask);
    form.append("character_reference_images_mask", blob, filename);
  }
}
