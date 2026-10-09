/**
 * The curated family tools of 2.0.0 and the 1.x alias `ideogram_edit`. The model lists come from the registry (the
 * snapshot's documented models); the texts are ours.
 */
import { z } from "zod/v4";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute } from "../lifecycle.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import { advertisedSchema, prepare } from "./family.js";
import type { FamilyToolSpec, ToolArguments } from "./family.js";
import { outcomeResult } from "./results.js";

const SAVED = "Results are saved to the output directory; ideogram_quote prices a call first (nothing is generated).";

export const FAMILY_TOOLS: readonly FamilyToolSpec[] = [
  {
    name: "ideogram_generate",
    family: "generate",
    defaultModel: "ideogram-3",
    title: "Generate images",
    description: `Create images from a text prompt with any image model Ideogram's API sells: Ideogram 4.5, 4.0 and 3.0 (with transparent, character and custom-model variants), 2a and 2.0, GPT Image, Nano Banana, P-Image, Z-Image, or auto. Each model takes its own fields (one variant per model in this schema). Default model: ideogram-3. ${SAVED}`,
  },
  {
    name: "ideogram_inpaint",
    family: "inpaint",
    defaultModel: "ideogram-3",
    title: "Inpaint an image",
    description: `Repaint the masked part of an image (black in the mask = repaint) with Ideogram 3.0 or its character / custom-model variants. Needs the source and the mask, each a local file or an Ideogram asset. ${SAVED}`,
  },
  {
    name: "ideogram_remix",
    family: "remix",
    defaultModel: "ideogram-3",
    title: "Remix an image",
    description: `Make new images from a source image and a prompt (Ideogram 3.0 and its variants, Ideogram 4.0, or auto); image_weight sets how closely the result follows the source. ${SAVED}`,
  },
  {
    name: "ideogram_reframe",
    family: "reframe",
    defaultModel: "ideogram-3",
    title: "Reframe an image",
    description: `Extend an image to a new size by outpainting (Ideogram 3.0 or Nano Banana 2). ${SAVED}`,
  },
  {
    name: "ideogram_replace_background",
    family: "replace_background",
    defaultModel: "ideogram-3",
    title: "Replace an image's background",
    description: `Replace the background of an image and keep its subject (Ideogram 3.0 or GPT Image 2); the prompt describes the new background. ${SAVED}`,
  },
  {
    name: "ideogram_upscale",
    family: "upscale",
    defaultModel: "auto",
    title: "Upscale an image",
    description: `Enlarge an image (auto, Topaz Bloom, Redefine, Standard, Text Refine and Wonder, or Nano Banana Pro); each model takes its own controls. ${SAVED}`,
  },
  {
    name: "ideogram_describe",
    family: "describe",
    defaultModel: "ideogram-3",
    title: "Describe an image",
    description:
      "Describe an image in words (Ideogram 3.0) or as a structured JSON prompt (Ideogram 4.0). Takes a local file or an Ideogram asset. Describe has no price quote (the API offers no dry run for it).",
    legacyInputs: {
      describe_model_version: z.enum(["V_2", "V_3"]).optional().describe("1.x name of the model, deprecated: V_3 = model ideogram-3"),
    },
  },
];

async function runFamilyTool(spec: FamilyToolSpec, ctx: ToolContext, args: ToolArguments): Promise<CallToolResult> {
  const call = await prepare(spec, args);
  const outcome = await execute(ctx.client, call.req, { waitS: call.waitS, clock: ctx.clock, budget: ctx.budget });
  return outcomeResult(ctx, outcome, call.notes);
}

export function familyToolDefinition(spec: FamilyToolSpec): ToolDefinition {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: advertisedSchema(spec),
    handler: (ctx, args) => runFamilyTool(spec, ctx, args),
  };
}

const INPAINT = FAMILY_TOOLS.find((spec) => spec.name === "ideogram_inpaint") as FamilyToolSpec;

/** ideogram_edit: the 1.x name of ideogram_inpaint, through 2.x. It advertises a pointer, not a second copy of the
 * schema; its arguments are checked exactly as ideogram_inpaint's. */
export const EDIT_ALIAS: ToolDefinition = {
  name: "ideogram_edit",
  title: "Inpaint an image (1.x name)",
  description: "Deprecated alias of ideogram_inpaint, kept through 2.x for 1.x callers: the same arguments and models (see ideogram_inpaint's schema).",
  inputSchema: z.looseObject({}),
  handler: (ctx, args) => runFamilyTool(INPAINT, ctx, args),
};

export function curatedDefinitions(): ToolDefinition[] {
  return [...FAMILY_TOOLS.map(familyToolDefinition), EDIT_ALIAS];
}
