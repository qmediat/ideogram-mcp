#!/usr/bin/env node
// @ts-check
// Every file that carries the package version names package.json's: the README's "## Supports · version X.Y.Z" heading
// (the version the Supports list was checked for), server.json's `version` and every `packages[].version`,
// package-lock.json's `version` and `packages[""].version` (a version file that does not exist carries none). Exit 0
// when every version equals package.json's, 1 (one line per mismatch, naming the file, the value found and
// package.json's version) when one differs, the heading is missing or it is written another way, 2 when a file cannot
// be read. `--root <dir>` reads the files from another directory.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isProgram } from "./is-program.mjs";

const HEADING = /^## Supports · version (\S+)[ \t]*$/m;
const ANY_SUPPORTS_HEADING = /^#+[ \t]*Supports\b.*$/m;

/**
 * @typedef {{ ok: true, version: string } | { ok: false, message: string }} SupportsCheck
 * @typedef {{ file: string, field: string, value: unknown }} VersionField
 */

/**
 * The version the README's Supports heading names, or null when the heading is missing.
 * @param {string} readme
 * @returns {string | null}
 */
export function supportsVersion(readme) {
  const match = HEADING.exec(readme);
  return match ? match[1] : null;
}

/**
 * @param {string} readme the README text
 * @param {string} packageVersion package.json's version
 * @returns {SupportsCheck}
 */
export function checkSupports(readme, packageVersion) {
  const readmeVersion = supportsVersion(readme);
  if (readmeVersion === null) {
    const written = ANY_SUPPORTS_HEADING.exec(readme)?.[0];
    const found = written === undefined ? "has no" : `has "${written}", not a`;
    return { ok: false, message: `README.md ${found} "## Supports · version ${packageVersion}" heading` };
  }
  if (readmeVersion !== packageVersion) {
    return {
      ok: false,
      message: `README.md Supports names version ${readmeVersion}, package.json is ${packageVersion}: update the Supports list`,
    };
  }
  return { ok: true, version: packageVersion };
}

/**
 * The fields that carry the package version in server.json and package-lock.json.
 * @param {any} server the parsed server.json, or undefined when the file does not exist
 * @param {any} lock the parsed package-lock.json, or undefined when the file does not exist
 * @returns {VersionField[]}
 */
export function versionFields(server, lock) {
  /** @type {VersionField[]} */
  const fields = [];
  if (server !== undefined) {
    fields.push({ file: "server.json", field: "version", value: server.version });
    const packages = Array.isArray(server.packages) ? server.packages : [];
    packages.forEach((entry, index) => {
      fields.push({ file: "server.json", field: `packages[${index}].version`, value: entry?.version });
    });
  }
  if (lock !== undefined) {
    fields.push({ file: "package-lock.json", field: "version", value: lock.version });
    fields.push({ file: "package-lock.json", field: 'packages[""].version', value: lock.packages?.[""]?.version });
  }
  return fields;
}

/**
 * @param {VersionField[]} fields
 * @param {string} packageVersion the version in package.json
 * @returns {string[]} one line per field that names another version
 */
export function versionMismatches(fields, packageVersion) {
  return fields
    .filter((field) => field.value !== packageVersion)
    .map((field) => `${field.file} ${field.field} is ${shown(field.value)}; package.json is ${packageVersion}`);
}

/**
 * @param {unknown} value a version field's value
 * @returns {string} the value as a line shows it
 */
function shown(value) {
  if (value === undefined) return "missing";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * @param {string} path
 * @returns {any} the parsed JSON file, or undefined when it does not exist
 */
function readJsonIfPresent(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @param {string} dir the directory holding server.json and package-lock.json
 * @param {string} packageVersion the version in package.json
 * @returns {string[]} one line per version field of those files that names another version
 */
export function versionFileMismatches(dir, packageVersion) {
  const server = readJsonIfPresent(join(dir, "server.json"));
  const lock = readJsonIfPresent(join(dir, "package-lock.json"));
  return versionMismatches(versionFields(server, lock), packageVersion);
}

/**
 * @param {SupportsCheck} readme the README's verdict
 * @param {string[]} mismatches the version files'
 * @returns {SupportsCheck} the README's verdict when no version file differs; otherwise a failure, one line per mismatch
 */
function withMismatches(readme, mismatches) {
  const lines = readme.ok ? mismatches : [readme.message, ...mismatches];
  return lines.length === 0 ? readme : { ok: false, message: lines.join("\n") };
}

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {string} the directory holding README.md, package.json and the version files, with a trailing slash
 */
function rootOf(argv) {
  const at = argv.indexOf("--root");
  if (at === -1) return fileURLToPath(new URL("..", import.meta.url));
  const dir = argv[at + 1];
  if (!dir) throw new Error("--root needs a directory");
  return dir.endsWith("/") ? dir : `${dir}/`;
}

/**
 * @param {string[]} argv
 * @returns {number} the exit code
 */
export function main(argv) {
  const root = rootOf(argv);
  const readme = readFileSync(`${root}README.md`, "utf8");
  const version = String(JSON.parse(readFileSync(`${root}package.json`, "utf8")).version);
  const result = withMismatches(checkSupports(readme, version), versionFileMismatches(root, version));
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  console.log(`README.md Supports and the version files name version ${result.version}, as package.json does`);
  return 0;
}

if (isProgram(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-supports: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
  }
}
