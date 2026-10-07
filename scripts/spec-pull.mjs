#!/usr/bin/env node
// Compares the live specification with the committed snapshot, on the operations this server may expose (classes
// documented, spec_only, v1_only — src/spec/classify.ts): an operation added, removed, or changed in itself or in any
// schema it references. Prints the list as Markdown.
//   node scripts/spec-pull.mjs                 fetch https://api.ideogram.ai/openapi.json
//   node scripts/spec-pull.mjs --from <file>   read a downloaded copy instead
//   ... --write                                when it differs, also replace spec/openapi.json and spec/SNAPSHOT
// Exit 0: no drift. Exit 1: drift (the list is on stdout). Exit 2: the specification could not be read.
// The build never depends on this: the weekly workflow opens or updates one issue with the list.
import { readFileSync, writeFileSync } from "node:fs";
import {
  formatSnapshot,
  normalizeSpec,
  operationMap,
  readSnapshot,
  sha256,
  SNAPSHOT_PATH,
  SPEC_PATH,
  SPEC_SOURCE_URL,
} from "./spec-lib.mjs";
import { exposedOperationKeys, SCHEMAS_KEPT } from "../openapi-ts.config.ts";

const FETCH_TIMEOUT_MS = 60_000;

async function readLive(from) {
  if (from) return readFileSync(from, "utf8");
  const response = await fetch(SPEC_SOURCE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${SPEC_SOURCE_URL} answered ${response.status}`);
  return response.text();
}

/** Every component `value` references, transitively, as "kind/name" (schemas, parameters, responses, …). */
function referencedComponents(spec, value, seen = new Set()) {
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== "object") return;
    const m = typeof node.$ref === "string" ? /^#\/components\/([^/]+)\/(.+)$/.exec(node.$ref) : null;
    if (m !== null && !seen.has(`${m[1]}/${m[2]}`)) {
      seen.add(`${m[1]}/${m[2]}`);
      visit(spec.components?.[m[1]]?.[m[2]]);
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return seen;
}

const componentOf = (spec, key) => spec.components?.[key.split("/")[0]]?.[key.slice(key.indexOf("/") + 1)];

/** One fingerprint per exposed operation (the operation and every component it references, in normal form), plus one per
 * schema kept without a referrer (PriceQuote: every dry run answers with it, no operation names it). */
function fingerprints(spec) {
  const ops = operationMap(spec);
  const prints = new Map();
  for (const key of exposedOperationKeys(spec)) {
    const op = ops.get(key);
    const components = [...referencedComponents(spec, op)].sort().map((name) => [name, componentOf(spec, name)]);
    prints.set(key, sha256(normalizeSpec(JSON.stringify({ op, components }))));
  }
  for (const name of SCHEMAS_KEPT) {
    const schema = spec.components?.schemas?.[name];
    const components = [...referencedComponents(spec, schema)].sort().map((n) => [n, componentOf(spec, n)]);
    prints.set(`schema ${name}`, sha256(normalizeSpec(JSON.stringify({ schema: schema ?? null, components }))));
  }
  return prints;
}

function drift(snapshot, live) {
  const before = fingerprints(snapshot);
  const after = fingerprints(live);
  const added = [...after.keys()].filter((key) => !before.has(key)).sort();
  const removed = [...before.keys()].filter((key) => !after.has(key)).sort();
  const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)).sort();
  return { added, removed, changed };
}

function report({ added, removed, changed }, snapshotDate) {
  const section = (title, keys) => (keys.length === 0 ? [] : [`### ${title} (${keys.length})`, "", ...keys.map((k) => `- \`${k}\``), ""]);
  return [
    `The live specification (${SPEC_SOURCE_URL}) differs from the snapshot of ${snapshotDate} on the operations this server may expose.`,
    "",
    ...section("Added", added),
    ...section("Removed", removed),
    ...section("Changed (the operation or a schema it references)", changed),
    "Next: `node scripts/spec-pull.mjs --write`, `npm ci --prefix scripts/spec-gen && npm run spec:generate`, review the diff of `src/generated/`, the classification lists and the overlay, then `npm test`.",
  ].join("\n");
}

function writeSnapshot(raw) {
  const normalized = normalizeSpec(raw);
  writeFileSync(SPEC_PATH, normalized);
  const date = new Date().toISOString().slice(0, 10);
  const record = { date, source: SPEC_SOURCE_URL, rawSha256: sha256(raw), rawBytes: Buffer.byteLength(raw), normalizedSha256: sha256(normalized) };
  writeFileSync(SNAPSHOT_PATH, formatSnapshot(record));
}

async function main() {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf("--from");
  const raw = await readLive(fromAt >= 0 ? args[fromAt + 1] : undefined);
  const live = JSON.parse(normalizeSpec(raw));
  const snapshot = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  const found = drift(snapshot, live);
  if (found.added.length + found.removed.length + found.changed.length === 0) {
    console.log("No drift: the exposed operations match the snapshot.");
    return 0;
  }
  console.log(report(found, readSnapshot().date ?? "unknown date"));
  if (args.includes("--write")) writeSnapshot(raw);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`spec-pull: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  },
);
