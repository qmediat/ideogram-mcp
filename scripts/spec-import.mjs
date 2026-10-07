#!/usr/bin/env node
// Writes a downloaded specification into spec/openapi.json in its normal form and records it in spec/SNAPSHOT.
// Usage: node scripts/spec-import.mjs <raw-file> <YYYY-MM-DD> [source-url]
import { readFileSync, writeFileSync } from "node:fs";
import { formatSnapshot, normalizeSpec, sha256, SNAPSHOT_PATH, SPEC_PATH, SPEC_SOURCE_URL } from "./spec-lib.mjs";

const [rawFile, date, source = SPEC_SOURCE_URL] = process.argv.slice(2);
if (!rawFile || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: node scripts/spec-import.mjs <raw-file> <YYYY-MM-DD> [source-url]");
  process.exit(2);
}
const raw = readFileSync(rawFile, "utf8");
const normalized = normalizeSpec(raw);
writeFileSync(SPEC_PATH, normalized);
writeFileSync(
  SNAPSHOT_PATH,
  formatSnapshot({ date, source, rawSha256: sha256(raw), rawBytes: Buffer.byteLength(raw), normalizedSha256: sha256(normalized) }),
);
console.log(`spec/openapi.json: ${Buffer.byteLength(normalized)} bytes, raw sha256 ${sha256(raw)}`);
