import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { generateInputSchema, handleGenerate } from "./tools/generate.js";
import { describeInputSchema, handleDescribe } from "./tools/describe.js";
import { IdeogramApiError } from "./errors.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ideogram",
    version: "1.0.0",
  });

  server.registerTool(
    "ideogram_generate",
    {
      description:
        "Generate images from text prompts using Ideogram V3. Returns saved file paths. " +
        "Supports multiple aspect ratios, style types, and quality levels.",
      inputSchema: generateInputSchema,
    },
    async (args) => {
      try {
        return await handleGenerate(args);
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  server.registerTool(
    "ideogram_describe",
    {
      description:
        "Generate a text description of an image using Ideogram V3. " +
        "Accepts a local file path to an image.",
      inputSchema: describeInputSchema,
    },
    async (args) => {
      try {
        return await handleDescribe(args);
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

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
