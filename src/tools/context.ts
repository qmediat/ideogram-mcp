/**
 * What every tool handler needs, passed in rather than reached for: the client, the output directory and the clock
 * (a test gives a fake API's client and a clock that does not wait).
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod/v4";
import { defaultClientOptions, IdeogramClient } from "../client.js";
import type { Config } from "../config.js";
import { SYSTEM_CLOCK } from "../lifecycle.js";
import type { Clock } from "../lifecycle.js";
import type { ToolArguments } from "./family.js";

export interface ToolContext {
  readonly client: IdeogramClient;
  readonly outputDir: string;
  readonly clock: Clock;
}

export function contextFromConfig(config: Config): ToolContext {
  return { client: new IdeogramClient(defaultClientOptions(config.apiKey)), outputDir: config.outputDir, clock: SYSTEM_CLOCK };
}

/** One registered tool: its name, our reviewed description, the schema tools/list advertises, its handler. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly handler: (ctx: ToolContext, args: ToolArguments) => Promise<CallToolResult>;
}
