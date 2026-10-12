/**
 * Our reviewed sentences for the request fields the curated tools advertise (each field described once, at the top
 * of a tool's schema; the per-model variants carry the types). The provider's `x-tool-description` texts were read as
 * source material only. A field without an entry here is advertised with its type alone.
 */

import { isVideoFamily } from "../lifecycle.js";
import { INLINE_MAX_BYTES, INLINE_MAX_TOTAL_BYTES, mbText } from "../spec/overlay.js";

/** The fields a curated tool sets itself or leaves to `ideogram_api`: never part of a curated tool's input. */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set([
  "async",
  "internal",
  "webhook_url",
  "target_collection_id",
]);

/** Sent as true by every curated tool unless the caller sets it: on some operations (remove background, replace
 * background, the auto models) an omitted `private` follows the plan's setting, public when the plan has none; a
 * server on an API key never publishes to Ideogram's public feed unless asked. */
export const PRIVATE_FIELD = "private";

/** Inputs of every curated tool that are not request fields. */
export const CONTROL_FIELDS: ReadonlySet<string> = new Set(["model", "wait_s", "inline_images"]);

export const INLINE_TEXT = `true: each saved image is also returned as image content (base64; one over ${mbText(INLINE_MAX_BYTES, 2)}, or past ${mbText(INLINE_MAX_TOTAL_BYTES, 0)} in total, by path only), for a client without file access`;

export const WAIT_TEXT =
  "Seconds to wait for the result (0-50, default 45). The job is accepted first; if it is still running when the wait ends, the result is its generation_id for ideogram_generation (never resubmitted, never billed twice).";

const FIELD_TEXT_PRIVATE =
  "Keep the result out of Ideogram's public feed; true unless you set false (enterprise accounts are always private)";

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
  character_reference_mask:
    "Local grayscale mask (or a public https URL) of where the character is in its reference image",
  character_reference_asset_identifiers: "Ideogram assets to use as the character reference",
  image: "Local image file to work on, or a public https URL of one",
  reference_images:
    "Local image files (or public https URLs) that guide the edit (never edited themselves); at most 4, at most 3 with a mask",
  reference_image_asset_identifiers:
    "Ideogram assets that guide the edit; needs the edited image by reference too, not with a mask",
  context_window: 'Where to edit: "none" (whole image, default), "auto" (around the mask) or "y_min,x_min,y_max,x_max"',
  store_assets: "Keep the result on Ideogram as an asset (accepted by the API, not yet enforced by it)",
  private: FIELD_TEXT_PRIVATE,
  font_candidate_files:
    "Local font files or public https URLs (.ttf, .otf, .woff, .woff2, at most 5) to match the detected text against",
  images: "Local source image files or public https URLs (the first is the one edited)",
  mask: "Local mask image file or a public https URL, the same size as the source",
  image_asset_identifier: "An Ideogram asset (an upload or an earlier result) instead of a local image",
  image_asset_identifiers: "Ideogram assets instead of local source images",
  mask_asset_identifier: "An Ideogram asset to use as the mask",
  image_weight: "How closely the result follows the source image, 1-100",
  custom_model_uri: "A custom model you trained or were given access to",
  enable_copyright_detection: "Run Ideogram's copyright detection on the result (adds latency)",
  upscale_factor: "x2, x4 or x8",
  duration:
    "Length of the video in seconds (Seedance 2.5: 4-30, Seedance 2: 4-15, Kling: 3-15, MiniMax: 5-15). Omitted: Kling and MiniMax make 5 s; Seedance picks the length for the prompt and is QUOTED at its maximum length (30 s on 2.5, 15 s on 2) — give it, and ideogram_quote tells the price",
  generate_audio:
    "Also generate an audio track (about double the price per Ideogram — the dry-run quote does not include it; stricter moderation)",
  shot_type:
    "How the prompt is staged: customize follows it as written, intelligent lets the model split it into its own shots",
  cfg_scale: "How closely the video follows the prompt, 0-1 (default 0.5); lower leaves the model more freedom",
  end_image: "Local image file (or public https URL) the video ends on; not with end_image_asset_identifier",
  end_image_asset_identifier: "An Ideogram asset the video ends on; not with end_image",
  reference_audios:
    "Local MP3 or WAV files (or public https URLs), in prompt order; Seedance 2.5: 2-30 s each and 30 s together (at most 10), Seedance 2 and MiniMax: 2-15 s each and 15 s together (at most 3) — the length is checked by Ideogram, not here; needs a reference image or video beside it",
  reference_video_asset_identifiers:
    "Videos stored with Ideogram (generated there, or uploaded in its app — the API has no video upload, and a result lists no video asset id), by asset, in prompt order; Seedance 2.5: 2-30 s each and 30 s together, Seedance 2 and MiniMax: 2-15 s and 15 s",
  prompt_expansion_mode: "How much the model may rewrite the prompt: disabled, fast, balanced (default) or quality",
  video_asset_identifier: "The video to edit, as an Ideogram asset",
  resolution_tier: "The output resolution tier",
  // the single-operation tools' own fields
  language: "The target language of the copy (one request per language; Arabic is rendered right-to-left)",
  exact_copy:
    "Pre-approved wordings, one `original => replacement` per line; each names the text element showing original and sets it to replacement",
  platform:
    "The ad platform whose published safe zone the ad stays inside (google, meta, meta_reels, meta_stories, snapchat, tiktok)",
  variation_type: "The axis to vary: people, setting, group_size or scene",
  colors: "One target colour per mask as a six-digit hex code (#B3202C), paired by position with masks (at most 4)",
  masks:
    "Local mask files (or public https URLs) marking the regions to change, paired by position (at most 4, the product photo's pixel size)",
  mask_asset_identifiers: "Ideogram assets as the masks, paired by position (at most 4)",
  materials:
    "Local material reference images (or public https URLs) whose colour, texture, pattern scale and orientation are applied, paired by position with masks (at most 4)",
  material_asset_identifiers: "Ideogram assets as the material references, paired by position (at most 4)",
  instruction:
    "Plain-language direction: the pose or camera for a pose variant, the materials and construction for a render, the reconstruction guidance for a ghost mannequin",
  metadata:
    "A JSON object serialized as a string with factual product context (title, brand, category, colour, material, item code)",
  view: "The camera view of the output garment: front, three_quarter or back",
  garment_images:
    "More photos of the same garment, local files or public https URLs (at most 15; several angles let obscured construction be reconstructed)",
  garment_asset_identifiers: "Ideogram assets as more photos of the same garment, in order (at most 15)",
  front_image:
    "The front-view garment photo (local file or public https URL); front_asset_identifier for an Ideogram asset",
  back_image:
    "The back-view garment photo (local file or public https URL); back_asset_identifier for an Ideogram asset",
  left_image:
    "The left-view garment photo (local file or public https URL); left_asset_identifier for an Ideogram asset",
  right_image:
    "The right-view garment photo (local file or public https URL); right_asset_identifier for an Ideogram asset",
  top_image: "The top-view garment photo (local file or public https URL); top_asset_identifier for an Ideogram asset",
  bottom_image:
    "The bottom-view garment photo (local file or public https URL); bottom_asset_identifier for an Ideogram asset",
  source_image:
    "The fashion image to edit, a local file or a public https URL; source_asset_identifier for an Ideogram asset",
  pose_reference_asset_identifier: "An Ideogram asset whose pose the model takes",
  sketch_image:
    "The fashion sketch to render, a local file or a public https URL; sketch_asset_identifier for an Ideogram asset",
  text_prompt: "The natural-language prompt to rewrite into an Ideogram 4.0 JSON prompt",
  design_image: "The flat design to analyze for logos, a local file or a public https URL",
  content: "The image whose provenance is checked, a local file or a public https URL",
};

/** The sentences the video families show in place of the image families' for the fields they share: a video's
 * resolution is a tier and goes with its aspect ratio, its references are not an edit's. One lookup for every family
 * (`fieldTextsFor`), never a per-tool copy. */
export const VIDEO_FIELD_TEXT: Readonly<Record<string, string>> = {
  prompt: "What the video shows, in natural language",
  negative_prompt: "What to keep out of the video",
  aspect_ratio:
    "The video's aspect ratio such as 16x9 (auto on Seedance lets the model choose from the prompt); with resolution where the model takes both",
  resolution:
    "The resolution tier: 480p, 720p (default) or 1080p on Seedance 2.5 (480p/720p on Seedance 2), 480P, 768P, 2K (default) or 4K on MiniMax (2K and 4K are upscaled from 768P); higher costs more",
  image: "Local image file (or public https URL) the video starts from; not with image_asset_identifier",
  image_asset_identifier: "An Ideogram asset the video starts from; not with image",
  reference_images:
    "Local image files (or public https URLs) the video takes as references, in prompt order (at most 9); not with reference_image_asset_identifiers",
  reference_image_asset_identifiers:
    "Ideogram assets as reference images, in prompt order (at most 9); not with reference_images",
  seed: "Random seed for a reproducible video",
  private: FIELD_TEXT_PRIVATE,
};

/** The sentences the single-operation tools (the tool family) show in place of the image families' for the fields they
 * share: their aspect ratios take a colon, their quality has three tiers, their reference images are logos to match. */
export const TOOL_FIELD_TEXT: Readonly<Record<string, string>> = {
  aspect_ratio:
    "Output aspect ratio with a colon — 1:1, 3:4, 4:3, 16:9 or 9:16 where the operation lists them (colorways and material swap default to the photo's ratio, ghost mannequin and sketch to render to 1:1, pose variants to the nearest supported); magic prompt: the ratio to pin, or omitted for the model's pick",
  quality: "low, medium or high: higher may improve detail and takes longer",
  reference_images:
    "Local image files (or public https URLs) of the logos to match in the design, REF_0, REF_1, … in the order given (at most 10)",
  image:
    "The source photo or ad to work on: a local image file or a public https URL (image_asset_identifier for an Ideogram asset)",
  num_images: "How many outputs to make (each is billed)",
  seed: "Random seed for a repeatable result",
};

/** The field sentences a family's tool advertises: the video and tool families read their own sentences over the shared ones. */
export function fieldTextsFor(family: string | null): Readonly<Record<string, string>> {
  if (isVideoFamily(family)) return { ...FIELD_TEXT, ...VIDEO_FIELD_TEXT };
  return family === "tool" ? { ...FIELD_TEXT, ...TOOL_FIELD_TEXT } : FIELD_TEXT;
}

export const VIDEO_INLINE_NOTE = "A video is saved, never returned inline: inline_images has no effect here.";
