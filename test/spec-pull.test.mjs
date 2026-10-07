// The drift check (scripts/spec-pull.mjs) on modified copies of the committed snapshot, offline: no drift exits 0;
// an exposed operation added, removed, or changed through a schema it references exits 1 with the list; a change to
// an operation this server never exposes is not drift; an unreadable specification exits 2.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/spec-pull.mjs", import.meta.url));
const SNAPSHOT = fileURLToPath(new URL("../spec/openapi.json", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "ideogram-drift-"));
after(() => rm(dir, { recursive: true, force: true }));

async function pull(mutate) {
  const spec = JSON.parse(await readFile(SNAPSHOT, "utf8"));
  mutate?.(spec);
  const file = join(dir, `spec-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(file, JSON.stringify(spec));
  return spawnSync(process.execPath, [SCRIPT, "--from", file], { encoding: "utf8" });
}

test("the snapshot against itself (reformatted) is no drift", async () => {
  const run = await pull();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /No drift/);
});

test("an exposed operation removed, one added, one changed through a referenced schema: exit 1 with the list", async () => {
  const run = await pull((spec) => {
    delete spec.paths["/v2/image/upscale/auto"];
    spec.paths["/v2/image/generate/new-model"] = spec.paths["/v2/image/generate/z-image"];
    spec.components.schemas.ResolutionV3.enum.push("4096x4096");
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /### Added \(1\)\n\n- `POST \/v2\/image\/generate\/new-model`/);
  assert.match(run.stdout, /### Removed \(1\)\n\n- `POST \/v2\/image\/upscale\/auto`/);
  assert.match(run.stdout, /- `POST \/v2\/image\/generate\/ideogram-3`/, "ResolutionV3 is referenced by the ideogram-3 request");
  assert.doesNotMatch(run.stdout, /`POST \/v2\/image\/generate\/ideogram-4-5`/, "4.5 does not reference ResolutionV3");
});

test("a change to an operation the server never exposes (Bearer-only, internal) is not drift", async () => {
  const run = await pull((spec) => {
    spec.paths["/manage/api/usage"].get.summary = "changed";
    delete spec.paths["/internal/batch"];
  });
  assert.equal(run.status, 0, run.stdout);
});

test("an unreadable specification exits 2 and says why", async () => {
  const file = join(dir, "broken.json");
  await writeFile(file, "not json");
  const run = spawnSync(process.execPath, [SCRIPT, "--from", file], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /spec-pull: /);
});
