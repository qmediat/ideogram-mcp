# ADR-0001: The OpenAPI snapshot is the source of truth

Status: accepted · Date: 2026-10-07 · Design note: [`docs/DESIGN-ideogram-v2.md`](../DESIGN-ideogram-v2.md)

## Context

Ideogram's v2 API sells, through one key and one balance, more than forty models and tools across twenty families,
each with its own fields; the provider adds models every few weeks. Version 1.x of this server described seven
endpoints by hand: every field, enum and limit was typed into the code from the documentation pages, and every
provider change was a hand edit that a test could only catch after a user hit it. The provider publishes a complete
OpenAPI 3.0 specification (`https://api.ideogram.ai/openapi.json`: 200 operations, 486 schemas on 2026-10-07).

## Decision

1. A normalized copy of the specification is committed (`spec/openapi.json`, keys sorted; `spec/SNAPSHOT` records
   the date, the source URL and the raw file's sha256). The build reads only the snapshot; it never needs the network.
2. Everything a fact of the specification can tell is generated from it, never written by hand: the TypeScript types
   and zod schemas (`src/generated/`, `@hey-api/openapi-ts` with the typescript and zod plugins, no client plugin), the
   operation facts table, the model registry, the curated tools' per-model fields, `docs/API-REFERENCE.md`. The
   generated code is committed (reviewers read its diff); CI regenerates it and fails when it differs.
3. What the specification states only in prose, or not at all, lives in one reviewed place each: the classification
   lists (`src/spec/classify.ts`), the overlay (`src/spec/overlay.ts`: the quote allow-list, PriceQuote for a dry run,
   the semantic constraints anchored to the phrases that state them), the support table (`src/spec/support.ts`), our
   tool texts. Provider `x-tool-description` texts are source material, never shipped.
4. Drift is reported, not enforced: a weekly job (`scripts/spec-pull.mjs`, `.github/workflows/spec-drift.yml`)
   compares the live specification with the snapshot on the operations this server may expose and opens or updates
   one issue. Updating the snapshot is a reviewed pull request: regenerate, read the diff, adjust the lists.

## Consequences

- A provider change reaches users through one reviewed snapshot update instead of scattered edits; the tests
  (counts of each class, registry against the snapshot, anchored constraints both ways) fail when the update needs a
  decision.
- The generator needs the TypeScript 6 compiler API, which TypeScript 7 (this package's compiler) does not ship: it
  runs from its own pinned toolchain in `scripts/spec-gen/` (`npm ci --prefix scripts/spec-gen`). The generator and
  the drift check load `openapi-ts.config.ts` and `src/spec/classify.ts` with Node's type stripping (Node ≥ 22.18).
- The generated code costs bytes (438 932 bytes committed, budget 600 KiB) and the advertised schemas cost context (62.9 KB
  of tools/list, budget 64 KB), both measured by the build and the tests.
- When the specification is wrong, the overlay or the tests say so; a 2xx body the generated schema rejects is a
  ContractMismatch outcome, never a silent success.

## Alternatives considered

- Hand-written schemas per tool (1.x): rejected — they drift silently and do not scale to forty models.
- Generating at build time from the live URL: rejected — the build would need the network and a provider change would
  reach users unreviewed.
- A generated client (`@hey-api/client-fetch`): rejected — the hardened client (no retry after a possible acceptance,
  typed 402/429, streamed downloads with a cap, allow-listed download hosts) stays ours.
