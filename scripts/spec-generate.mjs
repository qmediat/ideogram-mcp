#!/usr/bin/env node
// Regenerates src/generated/ from spec/openapi.json: types.gen.ts and zod.gen.ts by @hey-api/openapi-ts (its own
// toolchain in scripts/spec-gen/, `npm ci --prefix scripts/spec-gen` first), operations.gen.ts (the facts of every
// operation) by this script. Deterministic: the same snapshot gives the same bytes.
//   node scripts/spec-generate.mjs           write src/generated/
//   node scripts/spec-generate.mjs --check   regenerate into a temporary directory; exit 1 when src/generated/ differs
// Either mode fails when the generated code exceeds its budget (DESIGN-ideogram-v2.md section 5).
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, SPEC_PATH } from "./spec-lib.mjs";
import { generatorConfig } from "../openapi-ts.config.ts";

const GENERATED_DIR = `${ROOT}src/generated`;
const BUDGET_BYTES = 600 * 1024;
const GENERATED_FILES = ["operations.gen.ts", "types.gen.ts", "zod.gen.ts"];
const METHODS = ["get", "post", "put", "patch", "delete"];

const GENERATOR_DIR = `${ROOT}scripts/spec-gen/node_modules/@hey-api/openapi-ts`;

/** Imports the generator from its own toolchain (an ESM-only package: its export map is read, not require-resolved). */
async function loadGenerator() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(`${GENERATOR_DIR}/package.json`, "utf8"));
  } catch {
    throw new Error("the generator is not installed: run `npm ci --prefix scripts/spec-gen`");
  }
  return import(pathToFileURL(join(GENERATOR_DIR, manifest.exports["."].import)).href);
}

function refName(schema) {
  return typeof schema?.$ref === "string" ? schema.$ref.split("/").pop() : null;
}

function resolveSchema(spec, schema) {
  const name = refName(schema);
  return name === null ? (schema ?? null) : (spec.components.schemas[name] ?? null);
}

function bodyFacts(spec, op) {
  const content = op.requestBody?.content ?? {};
  const bodies = [];
  if (content["multipart/form-data"]) bodies.push("multipart");
  if (content["application/json"]) bodies.push("json");
  const first = content["multipart/form-data"] ?? content["application/json"];
  const encoding = content["multipart/form-data"]?.encoding ?? {};
  const jsonParts = Object.keys(encoding)
    .filter((field) => encoding[field].contentType === "application/json")
    .sort();
  return { bodies, requiredBody: op.requestBody?.required === true, schemaRef: first?.schema, jsonParts };
}

function isBinary(property) {
  return property?.type === "string" && property.format === "binary";
}

function fileFields(requestSchema) {
  const fields = [];
  for (const [name, property] of Object.entries(requestSchema?.properties ?? {})) {
    if (isBinary(property)) fields.push({ name, array: false, maxItems: null });
    else if (property.type === "array" && isBinary(property.items)) {
      fields.push({ name, array: true, maxItems: property.maxItems ?? null });
    }
  }
  return fields;
}

function parameterFacts(spec, op) {
  const parameters = [];
  let dryRun = false;
  for (const raw of op.parameters ?? []) {
    const p = raw.$ref ? spec.components.parameters[refName(raw)] : raw;
    if (p.in === "query" && p.name === "dry_run") {
      dryRun = true;
      continue;
    }
    const array = p.schema?.type === "array";
    if (array && p.explode === false) throw new Error(`${op.operationId}: ${p.name} is a non-exploded array`);
    parameters.push({ name: p.name, location: p.in, required: p.required === true, array });
  }
  return { parameters, dryRun };
}

function operationFacts(spec, method, path, op) {
  const body = bodyFacts(spec, op);
  const request = resolveSchema(spec, body.schemaRef);
  const responseRef = op.responses?.["200"]?.content?.["application/json"]?.schema;
  const response = resolveSchema(spec, responseRef);
  const { parameters, dryRun } = parameterFacts(spec, op);
  return {
    id: op.operationId,
    method: method.toUpperCase(),
    path,
    security: op.security === undefined ? null : op.security.map((r) => Object.keys(r)),
    summary: op.summary ?? "",
    deprecated: op.deprecated === true,
    bodies: body.bodies,
    requiredBody: body.requiredBody,
    requestSchema: refName(body.schemaRef),
    responseSchema: refName(responseRef),
    responseProperties: Object.keys(response?.properties ?? {}),
    dryRun,
    asyncField: Boolean(request?.properties?.async),
    parameters,
    fileFields: fileFields(request),
    jsonParts: body.jsonParts,
  };
}

function allOperationFacts(spec) {
  const facts = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (op?.operationId) facts.push(operationFacts(spec, method, path, op));
    }
  }
  return facts;
}

function operationsModule(spec) {
  const rows = allOperationFacts(spec).map((facts) => `  ${JSON.stringify(facts)},`);
  return [
    "// This file is generated by scripts/spec-generate.mjs from spec/openapi.json. Do not edit.",
    'import type { SpecOperationFacts } from "../spec/facts.js";',
    "",
    `export const SPEC_DOCUMENT_SECURITY: readonly (readonly string[])[] = ${JSON.stringify(
      spec.security.map((r) => Object.keys(r)),
    )};`,
    "",
    "export const SPEC_OPERATIONS: readonly SpecOperationFacts[] = [",
    ...rows,
    "];",
    "",
  ].join("\n");
}

async function generateInto(dir) {
  const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
  const { createClient } = await loadGenerator();
  await createClient(generatorConfig(structuredClone(spec), dir));
  writeFileSync(join(dir, "operations.gen.ts"), operationsModule(spec));
  const produced = readdirSync(dir).sort();
  if (produced.join(",") !== GENERATED_FILES.join(",")) {
    throw new Error(`the generator produced ${produced.join(", ")}; expected ${GENERATED_FILES.join(", ")}`);
  }
}

function measure(dir) {
  const sizes = GENERATED_FILES.map((file) => ({ file, bytes: statSync(join(dir, file)).size }));
  const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
  for (const s of sizes) console.log(`${s.file}: ${s.bytes} bytes`);
  console.log(`total: ${total} bytes (budget ${BUDGET_BYTES})`);
  if (total > BUDGET_BYTES) throw new Error(`the generated code is ${total} bytes, over the ${BUDGET_BYTES}-byte budget`);
}

function differingFiles(dir) {
  return GENERATED_FILES.filter((file) => {
    let committed = null;
    try {
      committed = readFileSync(join(GENERATED_DIR, file), "utf8");
    } catch {
      return true;
    }
    return committed !== readFileSync(join(dir, file), "utf8");
  });
}

function install(dir) {
  rmSync(GENERATED_DIR, { recursive: true, force: true });
  mkdirSync(GENERATED_DIR, { recursive: true });
  for (const file of GENERATED_FILES) copyFileSync(join(dir, file), join(GENERATED_DIR, file));
}

async function main() {
  const check = process.argv.includes("--check");
  const dir = mkdtempSync(join(tmpdir(), "ideogram-gen-"));
  try {
    await generateInto(dir);
    measure(dir);
    if (!check) {
      install(dir);
      return 0;
    }
    const differing = differingFiles(dir);
    if (differing.length === 0) return 0;
    console.error(`src/generated/ is not what the snapshot generates: ${differing.join(", ")}`);
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
