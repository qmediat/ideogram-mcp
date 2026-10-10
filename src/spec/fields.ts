/**
 * An operation's body fields in one line each — name, kind, required — for the discovery tool and the generated API
 * reference. Read from the generated body schema; a file field is said to be a local file path.
 */
import { z } from "zod/v4";
import type { Operation } from "./operations.js";

export interface FieldSummary {
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
}

interface JsonProperty {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly items?: JsonProperty;
  readonly anyOf?: readonly unknown[];
}

const ENUM_SHOWN = 12;

function kindOf(property: JsonProperty, file: boolean): string {
  if (file) return property.type === "array" ? "local file paths or public https URLs" : "local file path or public https URL";
  if (property.enum !== undefined) {
    const more = property.enum.length > ENUM_SHOWN ? `, … (${property.enum.length})` : "";
    return `one of ${property.enum.slice(0, ENUM_SHOWN).join(", ")}${more}`;
  }
  if (property.type === "array") return `array of ${property.items?.enum ? "enum" : (property.items?.type ?? "object")}`;
  if (Array.isArray(property.type)) return property.type.join(" | ");
  return typeof property.type === "string" ? property.type : property.anyOf ? "one of several shapes" : "object";
}

/** An operation's path and query parameters in one line each (headers are checked by name at call time, not listed). */
export function parameterSummaries(op: Operation): string[] {
  return op.facts.parameters.filter((p) => p.location !== "header").map((p) => `${p.name} (${p.location}${p.required ? ", required" : ""}${p.array ? ", repeated" : ""})`);
}

export function fieldSummaries(op: Operation): FieldSummary[] {
  if (op.schemas.body === null) return [];
  const json = z.toJSONSchema(op.schemas.body, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, JsonProperty>;
    required?: string[];
  };
  const required = new Set(json.required ?? []);
  const files = new Set(op.facts.fileFields.map((f) => f.name));
  return Object.entries(json.properties ?? {}).map(([name, p]) => ({ name, kind: kindOf(p, files.has(name)), required: required.has(name) }));
}
