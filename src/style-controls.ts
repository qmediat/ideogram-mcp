/** The style and character controls the Ideogram 3.0 generation endpoints accept: reference images, style codes, a
 * style preset and a colour palette on generate, remix and inpaint; an exact resolution on generate and remix; a custom
 * model and the copyright check on generate only (developer.ideogram.ai, read 2026-10-01). One encoder, one list of the
 * files they add to the request, one schema per endpoint built from the shared fields. */
import { z } from "zod/v4";
import { loadImageBlob } from "./image-input.js";
import { ReframeResolution } from "./types.js";

/** Ideogram's named palettes (the `name` form of `color_palette`). */
export const ColorPalettePreset = z.enum(["EMBER", "FRESH", "JUNGLE", "MAGIC", "MELON", "MOSAIC", "PASTEL", "ULTRAMARINE"]);

const ColorHex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "a colour as #RRGGBB");

export const ColorPaletteMember = z.object({
  color_hex: ColorHex.describe("The colour, #RRGGBB"),
  color_weight: z.number().min(0.05).max(1).optional().describe("Its share of the palette (0.05-1)"),
});

/** Either a preset by name or up to ten explicit members — never both (the API refuses the pair; strict objects, so
 * a stray second key is an error, not a silent drop). */
export const ColorPalette = z.union([
  z.strictObject({ name: ColorPalettePreset.describe("A preset palette") }),
  z.strictObject({ members: z.array(ColorPaletteMember).min(1).max(10).describe("Explicit colours, most dominant first") }),
]);

export const StyleCode = z.string().regex(/^[0-9A-Fa-f]{8}$/, "an 8-character hexadecimal style code");

/** The 69 resolutions Ideogram 3.0 offers — the same list reframe uses. */
export const Resolution = ReframeResolution;

export const CustomModelUri = z.string().regex(/^model\/[^/\s]+\/version\/[^/\s]+$/, "model/<name>/version/<version>");

/** The controls every 3.0 generation endpoint takes. */
export const sharedStyleControls = {
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
    .describe("Local image file of a character to keep consistent (one image; Ideogram bills character references at its own rate)"),
  character_reference_mask: z
    .string()
    .min(1)
    .optional()
    .describe("Grayscale mask of the character reference (same dimensions); needs character_reference_image"),
  style_codes: z.array(StyleCode).min(1).max(8).optional().describe("8-character hexadecimal style codes from Ideogram"),
  style_preset: z.string().min(1).max(100).optional().describe("A named style preset as Ideogram lists them"),
  color_palette: ColorPalette.optional().describe("A preset palette by name, or explicit colours with weights (not both)"),
};

/** generate and remix also take an exact resolution instead of an aspect ratio. */
export const resolutionControl = {
  resolution: Resolution.optional().describe("Exact output resolution (one of Ideogram's 69 sizes); not with aspect_ratio"),
};

/** generate alone takes a custom model and the copyright check. */
export const generateOnlyControls = {
  custom_model_uri: CustomModelUri.optional().describe("A custom (trained) model: model/<name>/version/<version>"),
  enable_copyright_detection: z
    .boolean()
    .optional()
    .describe("true runs Ideogram's copyright detection on this request; false leaves the organisation setting in force (it cannot switch an organisation-wide detection off)"),
};

/** Every control any endpoint takes (all optional); an endpoint's own schema spreads only the fields it takes, so
 * a value an endpoint lacks is never present in its args. */
const everyControl = z.object({ ...sharedStyleControls, ...resolutionControl, ...generateOnlyControls });
export type StyleControls = z.infer<typeof everyControl>;

/** resolution and aspect_ratio are alternatives: the API refuses the pair, so the tool refuses it before any upload. */
export function assertOneOfResolutionOrAspect(args: { resolution?: string; aspect_ratio?: string }): void {
  if (args.resolution !== undefined && args.aspect_ratio !== undefined) {
    throw new Error("resolution and aspect_ratio cannot be combined; give one");
  }
}

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
  if (args.color_palette) {
    // The OpenAPI spec declares this part as application/json; a live probe on 2026-10-01 (TURBO, one image)
    // was accepted both as this JSON part and as a plain string field. The tests stub fetch.
    form.append("color_palette", new Blob([JSON.stringify(args.color_palette)], { type: "application/json" }));
  }
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
