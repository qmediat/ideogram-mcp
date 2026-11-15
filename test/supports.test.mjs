// The README's "## Supports · version X.Y.Z" heading must name package.json's version (scripts/check-supports.mjs):
// CI and the release workflow run the check, so a version bump without a reviewed Supports list fails before publishing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

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
  assert.match(run.stderr, /has no "## Supports · version 2\.5\.1" heading/);
});

test("the committed README names the committed package version", () => {
  const root = new URL("../", import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stderr} (package.json ${version})`);
});
