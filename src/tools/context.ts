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
import { fetchRemoteInput } from "../remote-input.js";
import type { RemoteFetcher } from "../remote-input.js";
import type { ToolArguments } from "./family.js";

/** What the server holds for every call. */
export interface ServerContext {
  readonly client: IdeogramClient;
  readonly outputDir: string;
  readonly clock: Clock;
}

/** The server context plus the budget of ONE call and the remote-input fetcher bound to it. */
export interface ToolContext extends ServerContext {
  readonly budget: CallBudget;
  readonly remote: RemoteFetcher;
}

/** The fetcher of one call: public HTTPS hosts only, unless the client was built for a loopback test server. */
export function remoteFetcherFor(server: ServerContext, budget: CallBudget): RemoteFetcher {
  const loopback = server.client.options.allowHttpDownloads;
  return (url, maxBytes, accepted) => fetchRemoteInput(url, { maxBytes, accepted, budget, loopback });
}

export function contextFromConfig(config: Config): ServerContext {
  return { client: new IdeogramClient(defaultClientOptions(config.apiKey)), outputDir: config.outputDir, clock: SYSTEM_CLOCK };
}

/** The context of one call: the caller's cancellation signal (when the transport gives one) joins the server's limit. */
export function callContext(server: ServerContext, cancel?: AbortSignal): ToolContext {
  const budget = toolCallBudget(server.clock, cancel);
  return { ...server, budget, remote: remoteFetcherFor(server, budget) };
}

/** One registered tool: its name, our reviewed description, the schema tools/list advertises, its handler. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly handler: (ctx: ToolContext, args: ToolArguments) => Promise<CallToolResult>;
}
