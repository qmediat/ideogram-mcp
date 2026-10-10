/**
 * ideogram_generation: collect a generation by id — one a tool returned as still running, or one from an earlier
 * session. It only reads; it never sends the generation again.
 */
import { z } from "zod/v4";
import { resume, WAIT_DEFAULT_S, WAIT_MAX_S } from "../lifecycle.js";
import type { ToolDefinition } from "./context.js";
import { INLINE_TEXT } from "./fields.js";
import { outcomeResult } from "./results.js";

export const GENERATION_TOOL: ToolDefinition = {
  name: "ideogram_generation",
  title: "Collect a generation",
  description:
    "Collect the result of a generation by its generation_id (from a tool that answered 'still running', or from an earlier session): waits up to wait_s for it, then saves its images. Reading a generation is free and never runs it again.",
  inputSchema: z.object({
    generation_id: z.string().min(1).describe("The id a tool returned"),
    wait_s: z.number().int().min(0).max(WAIT_MAX_S).optional().describe("Seconds to wait if it is still running (0-50, default 45)"),
    video: z.boolean().optional().describe("true when the id is a video generation: the polls slow to the video cap (60 s apart), as the generating tool's own wait did"),
    inline_images: z.boolean().optional().describe(INLINE_TEXT),
  }),
  handler: async (ctx, args) => {
    const id = String(args.generation_id);
    const waitS = typeof args.wait_s === "number" ? args.wait_s : WAIT_DEFAULT_S;
    const outcome = await resume(ctx.client, id, { waitS, clock: ctx.clock, budget: ctx.budget, video: args.video === true });
    return outcomeResult(ctx, outcome, [], { inlineImages: args.inline_images === true });
  },
};
