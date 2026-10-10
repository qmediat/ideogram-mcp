import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { IdeogramApiError } from "./errors.js";
import { callContext } from "./tools/context.js";
import type { ServerContext, ToolDefinition } from "./tools/context.js";
import { ACCOUNT_TOOLS } from "./tools/account.js";
import { curatedDefinitions } from "./tools/curated.js";
import { OPERATIONS_TOOL } from "./tools/discovery.js";
import { GENERATION_TOOL } from "./tools/generation.js";
import { QUOTE_TOOL } from "./tools/quote.js";
import { RAW_TOOL } from "./tools/raw.js";
import { TRAINING_TOOLS } from "./tools/training.js";

// dist/server.js → ../package.json is the package root both in the repository and when installed from npm.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

/** Every tool of this release, in the order tools/list shows them. */
export function toolDefinitions(): ToolDefinition[] {
  return [...curatedDefinitions(), QUOTE_TOOL, GENERATION_TOOL, ...ACCOUNT_TOOLS, ...TRAINING_TOOLS, OPERATIONS_TOOL, RAW_TOOL];
}

/** A tool failure as the text the client sees: the API's typed error, or the refusal's own sentence. */
export function errorResult(error: unknown): CallToolResult {
  const message =
    error instanceof IdeogramApiError ? error.toMcpError() : error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

export function createServer(ctx: ServerContext): McpServer {
  const server = new McpServer({ name: "ideogram", version });
  for (const tool of toolDefinitions()) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>, extra: { signal?: AbortSignal }) => {
        try {
          // one budget per call: the caller's cancellation (the SDK aborts extra.signal on its timeout or a cancel) and this
          // server's own 55 s limit end every request, poll and download of the call together
          return await tool.handler(callContext(ctx, extra.signal), args);
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
  return server;
}
