/**
 * ideogram_operations: what the platform offers and what this release serves — by family, or one operation's
 * fields, file limits, constraints and quote support. The facts come from Operation[]; nothing is fetched.
 */
import { z } from "zod/v4";
import { countersLine } from "../counters.js";
import { CONSTRAINTS, fileLimitsOf, MIB, quoteAllowed } from "../spec/overlay.js";
import { DOCS_INDEX_URL, isExposable, operationById, OPERATIONS } from "../spec/operations.js";
import type { Family, Operation } from "../spec/operations.js";
import { supportOf } from "../spec/support.js";
import type { ToolDefinition } from "./context.js";
import { textResult } from "./results.js";

const FAMILIES = [...new Set(OPERATIONS.filter(isExposable).map((op) => op.family as Family))] as [Family, ...Family[]];

function opLine(op: Operation): string {
  const model = op.model === null ? "" : ` · model ${op.model}`;
  return `${op.id} — ${op.method} ${op.path}${model} · ${op.class} · ${supportOf(op)}${quoteAllowed(op) ? " · quotable" : ""}`;
}

interface JsonProperty {
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly $ref?: string;
  readonly items?: JsonProperty;
}

function fieldLines(op: Operation): string[] {
  if (op.schemas.body === null) return ["  (no body)"];
  const json = z.toJSONSchema(op.schemas.body, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, JsonProperty>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  const files = new Set(op.facts.fileFields.map((f) => f.name));
  return Object.entries(json.properties ?? {}).map(([name, p]) => {
    const kind = files.has(name) ? "local file path" : p.enum ? `one of ${p.enum.slice(0, 12).join(", ")}${p.enum.length > 12 ? ", …" : ""}` : (p.type ?? "object");
    return `  ${name}${required.has(name) ? " (required)" : ""}: ${kind}`;
  });
}

function detail(op: Operation): string {
  const limits = fileLimitsOf(op).map((l) => `  ${l.field}: ${(l.maxBytes / MIB).toFixed(0)} MB${l.stated ? "" : " (not stated by Ideogram; this server's cap)"}${l.maxItems === null ? "" : `, at most ${l.maxItems} files`}`);
  const rules = CONSTRAINTS.filter((c) => c.operations.has(op.id)).map((c) => `  ${c.text}`);
  return [
    opLine(op),
    op.summary,
    `Body: ${op.body}; async: ${op.async}; call it with ideogram_api {"operation": "${op.id}", …}`,
    "Fields:",
    ...fieldLines(op),
    ...(limits.length > 0 ? ["File limits:", ...limits] : []),
    ...(rules.length > 0 ? ["Rules:", ...rules] : []),
    `Documentation index: ${DOCS_INDEX_URL}`,
  ].join("\n");
}

function overview(): string {
  const lines = FAMILIES.map((family) => {
    const ops = OPERATIONS.filter((op) => op.family === family);
    const served = ops.filter((op) => ["curated", "raw"].includes(supportOf(op))).length;
    return `${family}: ${ops.length} operation(s), ${served} served in this release`;
  });
  return [...lines, countersLine(), `Documentation index: ${DOCS_INDEX_URL}`].join("\n");
}

export const OPERATIONS_TOOL: ToolDefinition = {
  name: "ideogram_operations",
  title: "List Ideogram operations",
  description:
    "Discover what Ideogram's API offers and what this server serves: no input = every family; family = its operations (model, class, support, quotable); operation = its fields, file limits and rules, ready for ideogram_api.",
  inputSchema: z.object({
    family: z.enum(FAMILIES).optional().describe("List one family's operations"),
    operation: z.string().optional().describe("Show one operation by id"),
  }),
  handler: async (_ctx, args) => {
    if (typeof args.operation === "string") {
      const op = operationById(args.operation);
      return op === null ? textResult(`No operation ${args.operation}; list a family to see the ids`, true) : textResult(detail(op));
    }
    if (typeof args.family === "string") {
      return textResult(OPERATIONS.filter((op) => op.family === args.family).map(opLine).join("\n"));
    }
    return textResult(overview());
  },
};
