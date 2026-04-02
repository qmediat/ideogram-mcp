import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { generateInputSchema, handleGenerate } from "./tools/generate.js";
import { describeInputSchema, handleDescribe } from "./tools/describe.js";
import { editInputSchema, handleEdit } from "./tools/edit.js";
import { remixInputSchema, handleRemix } from "./tools/remix.js";
import { reframeInputSchema, handleReframe } from "./tools/reframe.js";
import { replaceBgInputSchema, handleReplaceBg } from "./tools/replace-bg.js";
import { upscaleInputSchema, handleUpscale } from "./tools/upscale.js";
import { IdeogramApiError } from "./errors.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ideogram",
    version: "1.0.0",
  });

  server.registerTool("ideogram_generate", {
    description: "Generate images from text prompts using Ideogram V3. Supports multiple aspect ratios, style types, and quality levels.",
    inputSchema: generateInputSchema,
  }, async (args) => {
    try { return await handleGenerate(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("ideogram_describe", {
    description: "Generate a text description of an image using Ideogram V3. Accepts a local file path.",
    inputSchema: describeInputSchema,
  }, async (args) => {
    try { return await handleDescribe(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("ideogram_edit", {
    description: "Edit specific areas of an image using mask-based inpainting. Requires source image, mask (black=edit, white=keep), and prompt.",
    inputSchema: editInputSchema,
  }, async (args) => {
    try { return await handleEdit(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("ideogram_remix", {
    description: "Transform an image with a new prompt while preserving characteristics. Control influence with image_weight (0-100).",
    inputSchema: remixInputSchema,
  }, async (args) => {
    try { return await handleRemix(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("ideogram_reframe", {
    description: "Extend an image to a new resolution via outpainting. Specify target resolution (e.g. 1024x1024, 1536x640).",
    inputSchema: reframeInputSchema,
  }, async (args) => {
    try { return await handleReframe(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("ideogram_replace_background", {
    description: "Replace the background of an image while preserving the foreground subject. Describe the new background in the prompt.",
    inputSchema: replaceBgInputSchema,
  }, async (args) => {
    try { return await handleReplaceBg(args); } catch (error) { return errorResponse(error); }
  });

  server.registerTool("ideogram_upscale", {
    description: "Upscale an image to higher resolution with guided enhancement. Control resemblance (0-100) and detail (0-100).",
    inputSchema: upscaleInputSchema,
  }, async (args) => {
    try { return await handleUpscale(args); } catch (error) { return errorResponse(error); }
  });

  return server;
}

function errorResponse(error: unknown): CallToolResult {
  const message =
    error instanceof IdeogramApiError
      ? error.toMcpError()
      : error instanceof Error
        ? error.message
        : String(error);

  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
