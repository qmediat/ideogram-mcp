/**
 * The single-operation tools of 2.5.0 (docs/DESIGN-ideogram-v2.md section 8, step 5): the documented commercial
 * tools of /v2/tool (ad localizer, resizer and variations, colorways, ghost mannequin, material swap, model pose
 * variants, sketch to render) and the v1 utilities (magic prompt, layerize logos, provenance verify, snap mask). Each
 * is a FamilyToolSpec with one operation: no `model` input, the operation's own fields, the family mechanism's checks,
 * request and result shaping (an image result saved, a JSON prompt printed, a provenance record printed, a mask
 * saved). The customer-specific and spec-only operations of the tool and workflow families stay behind `ideogram_api`.
 */
import { operationById } from "../spec/operations.js";
import type { FamilyToolSpec } from "./family.js";

const SAVED = "Results are saved to the output directory; long jobs come back as a generation_id for ideogram_generation";

/** The spec of one operation; its description ends with what the operation offers: a price quote, or none. */
function single(name: string, operation: string, title: string, description: string, fieldTexts?: Readonly<Record<string, string>>): FamilyToolSpec {
  const op = operationById(operation);
  if (op === null) throw new Error(`${name}: no operation ${operation}`);
  const text = description.includes("${SAVED}") ? description.replace("${SAVED}", `${SAVED}; ${op.facts.dryRun ? "ideogram_quote prices a call first" : "no price quote (the operation offers no dry run)"}.`) : description;
  return { name, family: "tool", defaultModel: name, operation, title, description: text, ...(fieldTexts === undefined ? {} : { fieldTexts }) };
}

export const COMMERCIAL_TOOLS: readonly FamilyToolSpec[] = [
  single("ideogram_ad_localizer", "post_ad_localizer", "Ad localizer", "Translate an ad's copy into one target language (one request per language; Arabic right-to-left), keeping its layout, logos, brand type and product; exact_copy pins pre-approved wordings line by line. Takes the ad as a local file, a public https URL or an Ideogram asset. ${SAVED}"),
  single("ideogram_ad_resizer", "post_ad_resizer", "Ad resizer", "Reframe an ad to a platform's exact ad size (resolution WIDTHxHEIGHT from the list; platform picks the published safe zone), optionally editing while reframing. Takes the creative as a local file, a public https URL or an Ideogram asset. ${SAVED}"),
  single("ideogram_ad_variations", "post_ad_variations", "Ad variations", "Vary an ad along one axis — people, setting, group_size or scene — keeping its aspect ratio and product. Takes the creative as a local file, a public https URL or an Ideogram asset. ${SAVED}"),
  single("ideogram_colorways", "post_colorways", "Colorways", "Recolor a product photo: up to 4 masks, each paired by position with a six-digit hex colour; everything outside the masks is preserved. Takes the photo and the masks as local files, public https URLs or Ideogram assets. ${SAVED}"),
  single("ideogram_ghost_mannequin", "post_ghost_mannequin", "Ghost mannequin", "A garment on an invisible mannequin from its photos (front, back, left, right, top, bottom and more angles, as files, URLs or assets), in the view asked (front, three_quarter, back), on a clean white studio background; instruction and metadata add factual product context. ${SAVED}"),
  single("ideogram_material_swap", "post_material_swap", "Material swap", "Apply the material of reference images — colour, texture, pattern scale, orientation — to the masked regions of a product photo (up to 4 masks and materials, paired by position). Files, public https URLs or Ideogram assets. ${SAVED}"),
  single("ideogram_model_pose_variants", "post_model_pose_variants", "Model pose variants", "Re-pose the model of a fashion image by a plain-language pose or camera instruction (an optional pose reference asset). The source as a local file, a public https URL or an Ideogram asset. ${SAVED}"),
  single("ideogram_sketch_to_render", "post_sketch_to_render", "Sketch to render", "Render a fashion sketch as a product photo, with material and rendering direction and the construction details the sketch does not show. The sketch as a local file, a public https URL or an Ideogram asset. ${SAVED}"),
  single("ideogram_magic_prompt", "post_magic_prompt_v4", "Magic prompt (Ideogram 4.0)", "Rewrite a natural-language prompt into an Ideogram 4.0 structured JSON prompt (and the aspect ratio the model picks for it, or the one you pin). Nothing is generated; no price quote (the v1 operation offers no dry run).", {
    aspect_ratio: "AUTO (default: the model picks the ratio and says it) or a ratio with an x as the generate tools take it — 1x1, 16x9, 9x16, 3x4, 4x3 … (the values listed in the variant)",
  }),
  single("ideogram_layerize_logos", "post_layerize_logos", "Layerize logos", "Detect reference logos and image elements in a flat design and remove them: the text-free base image is saved, the detected layers come back with the reference each matched (REF_0, REF_1, … in the order given). The design and the references as local files or public https URLs. No price quote (the v1 operation offers no dry run)."),
  single("ideogram_provenance", "post_provenance_verify", "Verify provenance", "Check whether an image was created by Ideogram: the provenance record (provider, system version, generation id, creation time, validation state) as Ideogram answers it. The image as a local file or a public https URL. Free of charge; no price quote."),
  single("ideogram_snap_mask", "post_snap_mask", "Snap a mask", "Snap a hand-drawn binary mask to the object it marks: the snapped mask comes back as a PNG (white = the object), saved to the output directory. Use it as is for ideogram_remove_object (white = the region to remove) and for the colorways and material swap masks (white = the region to change); invert it for ideogram_inpaint, whose mask takes black as the region to repaint. The image and the mask as local files or public https URLs. No price quote (the v1 operation offers no dry run).", {
    image: "The image containing the object, a local file or a public https URL",
    mask: "The hand-drawn mask, a local file or a public https URL, the image's size: white (≥ 128) marks the object to snap to",
  }),
];
