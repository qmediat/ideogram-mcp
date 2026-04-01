import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getConfig } from "./config.js";

async function main(): Promise<void> {
  try {
    getConfig();
  } catch (error) {
    console.error("Configuration error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
