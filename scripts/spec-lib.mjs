// The snapshot's one normal form and its fingerprint, shared by the import and the drift check: keys sorted at every
// depth (arrays keep their order — it carries meaning in OpenAPI), two-space indentation, a final newline.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SPEC_PATH = `${ROOT}spec/openapi.json`;
export const SNAPSHOT_PATH = `${ROOT}spec/SNAPSHOT`;
export const SPEC_SOURCE_URL = "https://api.ideogram.ai/openapi.json";

/** Returns `value` with every object's keys in code-point order; arrays and scalars as they are. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
  return sorted;
}

/** The normal form of a raw specification text. Throws on anything that is not a JSON object. */
export function normalizeSpec(rawText) {
  const parsed = JSON.parse(rawText);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the specification is not a JSON object");
  }
  return `${JSON.stringify(sortKeys(parsed), null, 2)}\n`;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** The SNAPSHOT record: `key: value` lines. */
export function formatSnapshot({ date, source, rawSha256, normalizedSha256, rawBytes }) {
  return [
    `date: ${date}`,
    `source: ${source}`,
    `raw_sha256: ${rawSha256}`,
    `raw_bytes: ${rawBytes}`,
    `normalized_sha256: ${normalizedSha256}`,
    "",
  ].join("\n");
}

export function readSnapshot() {
  const record = {};
  for (const line of readFileSync(SNAPSHOT_PATH, "utf8").split("\n")) {
    const at = line.indexOf(": ");
    if (at > 0) record[line.slice(0, at)] = line.slice(at + 2);
  }
  return record;
}

/** Every operation of a specification as `METHOD /path` → its operation object. */
export function operationMap(spec) {
  const map = new Map();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (op && typeof op === "object" && typeof op.operationId === "string") map.set(`${method.toUpperCase()} ${path}`, op);
    }
  }
  return map;
}
