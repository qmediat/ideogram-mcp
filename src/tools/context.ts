/**
 * What every tool handler needs, passed in rather than reached for: the client, the output directory, the clock and
 * this call's budget (a test gives a fake API's client, a clock that does not wait and a budget on that clock).
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod/v4";
import { SYSTEM_CLOCK, toolCallBudget } from "../budget.js";
import type { CallBudget, Clock } from "../budget.js";
import { defaultClientOptions, IdeogramClient } from "../client.js";
import type { Config } from "../config.js";
import type { ToolArguments } from "./family.js";

/** What the server holds for every call. */
export interface ServerContext {
  readonly client: IdeogramClient;
  readonly outputDir: string;
  readonly clock: Clock;
}

/** The server context plus the budget of ONE call. */
export interface ToolContext extends ServerContext {
  readonly budget: CallBudget;
}

export function contextFromConfig(config: Config): ServerContext {
  return { client: new IdeogramClient(defaultClientOptions(config.apiKey)), outputDir: config.outputDir, clock: SYSTEM_CLOCK };
}

/** The context of one call: the caller's cancellation signal (when the transport gives one) joins the server's limit. */
export function callContext(server: ServerContext, cancel?: AbortSignal): ToolContext {
  return { ...server, budget: toolCallBudget(server.clock, cancel) };
}

/** One registered tool: its name, our reviewed description, the schema tools/list advertises, its handler. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly handler: (ctx: ToolContext, args: ToolArguments) => Promise<CallToolResult>;
}
