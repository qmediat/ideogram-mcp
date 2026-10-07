#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZodError } from "zod/v4";
import { createServer } from "./server.js";
import { getConfig } from "./config.js";
import type { Config } from "./config.js";
import { contextFromConfig } from "./tools/context.js";

async function main(): Promise<void> {
  let config: Config;
  try {
    config = getConfig();
  } catch (error) {
    const reason =
      error instanceof ZodError
        ? error.issues.map((issue) => issue.message).join("; ")
        : error instanceof Error
          ? error.message
          : String(error);
    console.error("Configuration error:", reason);
    process.exit(1);
  }

  const server = createServer(contextFromConfig(config));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
