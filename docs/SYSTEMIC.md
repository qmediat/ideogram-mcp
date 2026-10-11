# SYSTEMIC conventions — `qmediat/ideogram-mcp`

> The catalogue of this repository's cross-cutting rules: one §N per convention, the one definition each surface
> reads, and what enforces it. Present tense, current rules only; history lives in `CHANGELOG.md` and the PR bodies.

## §1 — Code structure: the preset, the baselines, the exemplars (2026-10-11)

**Rule 1 — the one definition.** `lint/structure.mjs` and `lint/baseline-ratchet.mjs` are copies of shared presets,
byte for byte (they are edited where the presets are kept, never here). `npm run lint` runs ESLint with
`...structure()` — complexity ≤ 10, nesting ≤ 3, ≤ 40 lines per function outside tests, a reason on every disable
directive, no `assert.throws(fn)` / `assert.rejects(p)` without the expected error — over the TypeScript (parsed by
Babel: TypeScript 7 ships no JavaScript API for typescript-eslint) and the test and script modules; jscpd counts
repeats of ≥ 10 lines over `src`, `test` and `scripts`; the ratchet holds the count to `jscpd-baseline.json` (more is
a new repeat, fewer asks for `node lint/baseline-ratchet.mjs --write-duplicates .jscpd-report/jscpd-report.json`) and
refuses any baseline that grew against the base branch (CI checks out with `fetch-depth: 0`). `src/generated/**` is
held by its generator's check (`npm run spec:check`), not linted here.

**The exemplars** — read before writing, not the nearest file:

| layer | file |
|---|---|
| module | `src/wire.ts` |
| test | `test/wire.test.mjs` |
| test helper | `test/support/fake-api.mjs` |

**Rule 2 — the baselines at adoption.** `eslint-suppressions.json`: 27 functions over the complexity of 10 in 14
files; duplicates: 11 lines (one repeat). A baseline only shrinks: a function a PR changes leaves it in that PR, the
rest of a touched file in the next PR; after a rebase a conflicting `eslint-suppressions.json` is regenerated (the
base's file, then `npx eslint --prune-suppressions`), never merged by hand.

**Enforcement.** The CI job runs `npm run lint` on Node 22 and 24.
