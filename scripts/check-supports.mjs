#!/usr/bin/env node
// @ts-check
// The README's "## Supports · version X.Y.Z" heading names the version the Supports list was checked for; it must equal
// package.json's version. Exit 0 when they are equal, 1 (one line naming both) when they differ, the heading is
// missing or it is written another way, 2 when a file cannot be read. `--root <dir>` reads README.md and
// package.json from another directory.
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HEADING = /^## Supports · version (\S+)[ \t]*$/m;
const ANY_SUPPORTS_HEADING = /^#+[ \t]*Supports\b.*$/m;

/**
 * @typedef {{ ok: true, version: string } | { ok: false, message: string }} SupportsCheck
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
 * @param {string[]} argv the arguments after the script name
 * @returns {string} the directory holding README.md and package.json, with a trailing slash
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
  const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
  const result = checkSupports(readme, String(version));
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  console.log(`README.md Supports names version ${result.version}, as package.json does`);
  return 0;
}

/** @returns {boolean} whether this file is the program node runs (not a module another file imports) */
function isProgram() {
  const self = fileURLToPath(import.meta.url);
  const started = process.argv[1] ?? "";
  try {
    return Boolean(started) && realpathSync(started) === realpathSync(self);
  } catch {
    return resolve(started) === self; // a path realpath cannot resolve still names this file when node started it
  }
}

if (isProgram()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-supports: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 2;
  }
}
