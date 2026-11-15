// The README's "## Supports · version X.Y.Z" heading must name package.json's version (scripts/check-supports.mjs):
// CI and the release workflow run the check, so a version bump that leaves the heading behind fails before publishing
// (the heading's version is what is compared; reviewing the list under it is the release step CONTRIBUTING.md names).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkSupports } from "../scripts/check-supports.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-supports.mjs", import.meta.url));

/** Runs the check on a directory holding the given README and a package.json of the given version. */
function runCheck(readme, version) {
  const dir = mkdtempSync(join(tmpdir(), "supports-"));
  try {
    writeFileSync(join(dir, "README.md"), readme);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version }));
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

test("the script runs when node starts it through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "supports-link-"));
  try {
    const link = join(dir, "check.mjs");
    symlinkSync(SCRIPT, link);
    const run = spawnSync(process.execPath, [link], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Supports names version/);
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
