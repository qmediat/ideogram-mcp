// The README's "## Supports · version X.Y.Z" heading, server.json and package-lock.json must name package.json's version
// (scripts/check-supports.mjs): CI and the release workflow run the check, so a version bump that leaves one behind
// fails before publishing (the heading's version is what is compared; reviewing the list under it is the release step
// CONTRIBUTING.md names).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkSupports } from "../scripts/check-supports.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-supports.mjs", import.meta.url));

/**
 * server.json and package-lock.json naming the given versions.
 * @param {{ server: string, serverPackage: string, lock: string, lockRoot: string }} versions
 */
const versionFiles = ({ server, serverPackage, lock, lockRoot }) => ({
  "server.json": {
    name: "io.github.example/x",
    version: server,
    packages: [{ identifier: "x", version: serverPackage }],
  },
  "package-lock.json": { name: "x", version: lock, packages: { "": { name: "x", version: lockRoot } } },
});
/** @param {string} version @returns {{ server: string, serverPackage: string, lock: string, lockRoot: string }} */
const currentAt = (version) => ({ server: version, serverPackage: version, lock: version, lockRoot: version });
const ALL_CURRENT = currentAt("2.5.1");

/**
 * Runs the check on a directory holding the given README, a package.json of the given version and the other files.
 * @param {string} readme
 * @param {string} version
 * @param {Record<string, unknown>} [files] file name → its JSON value; by default the version files at `version`
 */
function runCheck(readme, version, files = versionFiles(currentAt(version))) {
  const dir = mkdtempSync(join(tmpdir(), "supports-"));
  try {
    writeFileSync(join(dir, "README.md"), readme);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version }));
    for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
    return spawnSync(process.execPath, [SCRIPT, "--root", dir], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const readmeOf = (version) =>
  `# x\n\n## Supports · version ${version}\n\n| | |\n|---|---|\n| Works in | Claude Code |\n`;

test("a README whose Supports heading names the package version passes", () => {
  const run = runCheck(readmeOf("2.5.1"), "2.5.1");
  assert.equal(run.status, 0, run.stderr);
});

test("a README whose Supports heading names another version fails, naming both versions", () => {
  const run = runCheck(readmeOf("2.5.1"), "2.6.0");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Supports names version 2\.5\.1, package\.json is 2\.6\.0/);
});

test("a README without the Supports heading fails", () => {
  const run = runCheck("# x\n\n## Supports\n\nversion 2.5.1\n", "2.5.1");
  assert.equal(run.status, 1);
  assert.equal(run.stderr, 'README.md has "## Supports", not a "## Supports · version 2.5.1" heading\n');
});

test("the verdict tells an absent heading from one written another way", () => {
  assert.deepEqual(checkSupports("# x\n", "2.5.1"), {
    ok: false,
    message: 'README.md has no "## Supports · version 2.5.1" heading',
  });
  assert.deepEqual(checkSupports("# x\n\n### Supports · version 2.5.1 (beta)\n", "2.5.1"), {
    ok: false,
    message: 'README.md has "### Supports · version 2.5.1 (beta)", not a "## Supports · version 2.5.1" heading',
  });
  assert.deepEqual(checkSupports(readmeOf("2.5.1"), "2.5.1"), { ok: true, version: "2.5.1" });
});

test("server.json and package-lock.json naming the package version pass, and the output says so", () => {
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", versionFiles(ALL_CURRENT));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /README\.md Supports and the version files name version 2\.5\.1/);
});

test("a stale top-level server.json version fails, naming the file, the value and the package version", () => {
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", versionFiles({ ...ALL_CURRENT, server: "2.5.0" }));
  assert.equal(run.status, 1);
  assert.equal(run.stderr, "server.json version is 2.5.0; package.json is 2.5.1\n");
});

test("a stale server.json packages[0].version fails, naming the field", () => {
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", versionFiles({ ...ALL_CURRENT, serverPackage: "2.5.0" }));
  assert.equal(run.status, 1);
  assert.equal(run.stderr, "server.json packages[0].version is 2.5.0; package.json is 2.5.1\n");
});

test("a stale package-lock.json root version fails, naming the field", () => {
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", versionFiles({ ...ALL_CURRENT, lockRoot: "2.5.0" }));
  assert.equal(run.status, 1);
  assert.equal(run.stderr, 'package-lock.json packages[""].version is 2.5.0; package.json is 2.5.1\n');
});

test("two stale version fields fail with one line each", () => {
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", versionFiles({ ...ALL_CURRENT, server: "2.5.0", lock: "2.5.0" }));
  assert.equal(run.status, 1);
  assert.equal(
    run.stderr,
    "server.json version is 2.5.0; package.json is 2.5.1\npackage-lock.json version is 2.5.0; package.json is 2.5.1\n",
  );
});

test("the script runs when node starts it through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "supports-link-"));
  try {
    const link = join(dir, "check.mjs");
    symlinkSync(SCRIPT, link);
    const run = spawnSync(process.execPath, [link], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Supports and the version files name version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs/PRICES.md links every dated price file", () => {
  const docs = new URL("../docs/", import.meta.url);
  const index = readFileSync(new URL("PRICES.md", docs), "utf8");
  const dated = readdirSync(docs).filter((name) => /^PRICES-\d{4}-\d{2}-\d{2}\.md$/.test(name));
  assert.ok(dated.length > 0);
  for (const name of dated) assert.ok(index.includes(`(./${name})`), `${name} is not linked from docs/PRICES.md`);
});

test("the committed README names the committed package version", () => {
  const root = new URL("../", import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stderr} (package.json ${version})`);
});

test("a directory without server.json fails: the registry manifest is required", () => {
  const { "package-lock.json": lock } = versionFiles(ALL_CURRENT);
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", { "package-lock.json": lock });
  assert.equal(run.status, 1);
  assert.equal(run.stderr, "server.json is missing\n");
});

test("a server.json whose packages is not an array fails, naming it", () => {
  const files = versionFiles(ALL_CURRENT);
  const server = { name: "io.github.example/x", version: "2.5.1", packages: { identifier: "x", version: "2.5.1" } };
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", { ...files, "server.json": server });
  assert.equal(run.status, 1);
  assert.equal(run.stderr, "server.json packages is not an array\n");
});

test("a directory without package-lock.json fails: the lockfile is required", () => {
  const { "server.json": server } = versionFiles(ALL_CURRENT);
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", { "server.json": server });
  assert.equal(run.status, 1);
  assert.equal(run.stderr, "package-lock.json is missing\n");
});

test("a lockfile without a packages map (lockfileVersion 1) is checked on its root version only", () => {
  const files = versionFiles(ALL_CURRENT);
  const lock = { name: "x", version: "2.5.1", lockfileVersion: 1, dependencies: {} };
  const run = runCheck(readmeOf("2.5.1"), "2.5.1", { ...files, "package-lock.json": lock });
  assert.equal(run.status, 0, run.stderr);
});
