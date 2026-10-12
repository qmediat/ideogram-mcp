# SYSTEMIC conventions — `qmediat/ideogram-mcp`

> The catalogue of this repository's cross-cutting rules: one §N per convention, the one definition each surface
> reads, and what enforces it. Present tense, current rules only; history lives in `CHANGELOG.md` and the PR bodies.

## §1 — Code structure: the preset, the baselines, the exemplars (2026-10-11)

**Rule 1 — the one definition.** `lint/structure.mjs` and `lint/baseline-ratchet.mjs` are copies of shared presets,
byte for byte (they are edited where the presets are kept, never here). `npm run lint` runs ESLint with
`...structure()` — complexity ≤ 10, nesting ≤ 3, ≤ 40 lines per function outside tests, a reason on every disable
directive, no `assert.throws(fn)` / `assert.rejects(p)` without the expected error — over the TypeScript (parsed by
Babel: TypeScript 7 ships no JavaScript API for typescript-eslint) and the test and script modules; jscpd counts
repeats of ≥ 10 lines over `src`, `test` and `scripts`; the ratchet holds the lines each file has in a repeat to `jscpd-baseline.json` (more is
a new repeat, fewer asks for `node lint/baseline-ratchet.mjs --write-duplicates .jscpd-report/jscpd-report.json`) and
refuses any baseline that grew against the base branch (CI checks out with `fetch-depth: 0`). `npm run lint` runs
ESLint before jscpd on purpose: jscpd reads a file it cannot parse as one with no repeat (no warning, exit 0), so the
parse errors ESLint reports first are what keeps a broken file from passing the duplicate gate. Named exclusions:
`src/generated/**` is held by its generator's check (`npm run spec:check`); `scripts/spec-gen/**` is the generator's
own package (its own `package.json`, run from `npm run spec:generate`), outside ESLint and jscpd; Babel parses with
its TypeScript plugin alone, so a decorator or an `accessor` field is a parse error (loud — the code uses neither).

**Formatting.** Prettier (pinned in `package.json`; `.prettierrc.json`: printWidth 120, its defaults otherwise —
double quotes, semicolons, trailing commas: the style the code had) formats every `*.ts` / `*.mjs` / `*.js` / `*.cjs`
file; `npm run format` rewrites, `npm run format:check` is a CI step. Excluded (`.prettierignore`): the vendored
presets of Rule 1, `src/generated/` (CI regenerates it and compares) and, until the pull request that reformats each,
`src/` and `test/` — a whole-tree reformat does not fit one review. Prose, JSON and YAML are not formatted by it.

**The exemplars** — read before writing, not the nearest file:

| layer | file |
|---|---|
| module | `src/wire.ts` |
| test | `test/wire.test.mjs` |
| test helper | `test/support/fake-api.mjs` |

**Rule 2 — the baselines at adoption.** `eslint-suppressions.json`: 27 functions over the complexity of 10 in 14
files; duplicates: 23 lines in 2 files (one repeat, both sides counted). A baseline only shrinks: a function a PR changes leaves it in that PR, the
rest of a touched file in the next PR; after a rebase a conflicting `eslint-suppressions.json` is regenerated (the
base's file, then `npx eslint --prune-suppressions`) and a conflicting `jscpd-baseline.json` re-recorded (the base's file, then `--write-duplicates`), never merged by hand; the ratchet refuses whatever grew. A jscpd version bump can move the measured lines: that PR re-records the baseline with `--write-duplicates`, reviewed like a baseline cleanup.

`npm run lint` takes no arguments: ESLint's own flags (`--fix`, a file list) go to `npx eslint`. A suppression is a count per file and rule: a new violation of a rule in a file that already has suppressed ones
passes while another is fixed in the same PR — the count is the only guard there, so the self-review reads the
touched functions. `eslint-suppressions.json` is marked `linguist-generated` (a review packet carries it as data,
last): the ratchet holds it after adoption, and the adoption PR names its counts.

**Enforcement.** The CI job runs `npm run lint` on Node 22 and 24.
