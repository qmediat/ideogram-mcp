/**
 * Our reviewed sentences for the request fields the curated tools advertise (each field described once, at the top
 * of a tool's schema; the per-model variants carry the types). The provider's `x-tool-description` texts were read as
 * source material only. A field without an entry here is advertised with its type alone.
 */

/** The fields a curated tool sets itself or leaves to `ideogram_api`: never part of a curated tool's input. */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set(["async", "internal", "webhook_url", "private", "target_collection_id"]);

/** Inputs of every curated tool that are not request fields. */
export const CONTROL_FIELDS: ReadonlySet<string> = new Set(["model", "wait_s"]);

export const WAIT_TEXT =
  "Seconds to wait for the result (0-50, default 45). The job is accepted first; if it is still running when the wait ends, the result is its generation_id for ideogram_generation (never resubmitted, never billed twice).";

export const FIELD_TEXT: Readonly<Record<string, string>> = {
  prompt: "What to create or change, in natural language",
  negative_prompt: "What to keep out of the image",
  seed: "Random seed for a reproducible result",
  num_images: "How many images to make (each is billed)",
  aspect_ratio: "Output aspect ratio such as 16x9; not with resolution",
  resolution: "Exact output size WIDTHxHEIGHT from the model's list; not with aspect_ratio",
  size: 'Output size: "auto", "source" (needs source images) or WIDTHxHEIGHT',
  rendering_speed: "turbo, default or quality: faster is cheaper",
  quality: "very_low, low, medium or high: higher costs more",
  magic_prompt: "auto, on or off: let Ideogram rewrite the prompt",
  style_type: "Visual style family",
  style_preset: "A named style preset; not with style codes or style references",
  style_codes: "8-character hexadecimal style codes",
  color_palette: "A preset palette by name, or explicit hex colours with weights",
  style_reference_images: "Local image files whose style the result follows",
  style_reference_asset_identifiers: "Ideogram assets (uploads or earlier results) to use as style references",
  style_reference_collection_id: "A saved style collection to apply",
  style_reference_collection_version_id: "A version of the saved style collection",
  character_reference_images: "Local image files of the character to keep consistent",
  character_reference_mask: "Local grayscale mask of where the character is in its reference image",
  character_reference_asset_identifiers: "Ideogram assets to use as the character reference",
  image: "Local image file to work on",
  images: "Local source image files (the first is the one edited)",
  mask: "Local mask image file, the same size as the source",
  image_asset_identifier: "An Ideogram asset (an upload or an earlier result) instead of a local image",
  image_asset_identifiers: "Ideogram assets instead of local source images",
  mask_asset_identifier: "An Ideogram asset to use as the mask",
  image_weight: "How closely the result follows the source image, 1-100",
  custom_model_uri: "A custom model you trained or were given access to",
  enable_copyright_detection: "Run Ideogram's copyright detection on the result (adds latency)",
  upscale_factor: "x2, x4 or x8",
  resolution_tier: "The output resolution tier",
};
