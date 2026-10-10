/**
 * Our reviewed sentences for the request fields the curated tools advertise (each field described once, at the top
 * of a tool's schema; the per-model variants carry the types). The provider's `x-tool-description` texts were read as
 * source material only. A field without an entry here is advertised with its type alone.
 */

/** The fields a curated tool sets itself or leaves to `ideogram_api`: never part of a curated tool's input. */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set(["async", "internal", "webhook_url", "target_collection_id"]);

/** Sent as true by every curated tool unless the caller sets it: on some operations (remove background, replace
 * background, the auto models) an omitted `private` follows the plan's setting, public when the plan has none; a
 * server on an API key never publishes to Ideogram's public feed unless asked. */
export const PRIVATE_FIELD = "private";

/** Inputs of every curated tool that are not request fields. */
export const CONTROL_FIELDS: ReadonlySet<string> = new Set(["model", "wait_s", "inline_images"]);

/** The largest image returned inline, in raw bytes: the model APIs behind the clients take at most 5 MiB of base64
 * per image (5 242 880 B, i.e. 3 932 160 raw bytes); 3.75 MB (decimal, as every size here) stays under it. */
export const INLINE_MAX_BYTES = 3_750_000;
/** The most image bytes one result carries inline; the rest stay by path (a result of eight images is not 30 MB of base64). */
export const INLINE_MAX_TOTAL_BYTES = 10_000_000;

export const INLINE_TEXT = "true: each saved image is also returned as image content (base64; one over 3.75 MB, or past 10 MB in total, by path only), for a client without file access";

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
  style_reference_images: "Local image files (or public https URLs) whose style the result follows",
  style_reference_asset_identifiers: "Ideogram assets (uploads or earlier results) to use as style references",
  style_reference_collection_id: "A saved style collection to apply",
  style_reference_collection_version_id: "A version of the saved style collection",
  character_reference_images: "Local image files (or public https URLs) of the character to keep consistent",
  character_reference_mask: "Local grayscale mask (or a public https URL) of where the character is in its reference image",
  character_reference_asset_identifiers: "Ideogram assets to use as the character reference",
  image: "Local image file to work on, or a public https URL of one",
  reference_images: "Local image files (or public https URLs) that guide the edit (never edited themselves); at most 4, at most 3 with a mask",
  reference_image_asset_identifiers: "Ideogram assets that guide the edit; needs the edited image by reference too, not with a mask",
  context_window: 'Where to edit: "none" (whole image, default), "auto" (around the mask) or "y_min,x_min,y_max,x_max"',
  store_assets: "Keep the result on Ideogram as an asset (accepted by the API, not yet enforced by it)",
  private: "Keep the result out of Ideogram's public feed; true unless you set false (enterprise accounts are always private)",
  font_candidate_files: "Local font files or public https URLs (.ttf, .otf, .woff, .woff2, at most 5) to match the detected text against",
  images: "Local source image files or public https URLs (the first is the one edited)",
  mask: "Local mask image file or a public https URL, the same size as the source",
  image_asset_identifier: "An Ideogram asset (an upload or an earlier result) instead of a local image",
  image_asset_identifiers: "Ideogram assets instead of local source images",
  mask_asset_identifier: "An Ideogram asset to use as the mask",
  image_weight: "How closely the result follows the source image, 1-100",
  custom_model_uri: "A custom model you trained or were given access to",
  enable_copyright_detection: "Run Ideogram's copyright detection on the result (adds latency)",
  upscale_factor: "x2, x4 or x8",
  resolution_tier: "The output resolution tier",
};
