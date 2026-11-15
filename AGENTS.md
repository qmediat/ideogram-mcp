# AGENTS.md

## Work on the code

| | |
|---|---|
| Install | `npm install` |
| Build | `npm run build` |
| Check before a commit | `npm run typecheck && npm run lint && npm test && npm run check:supports && npm run check:addresses` |
| README "Supports", `server.json` and `package-lock.json` against the package version | `npm run check:supports` |
| Every email address in a tracked file in `qmediat.io` | `npm run check:addresses` |
| Format | `npm run format` (Prettier; `npm run lint` checks it) |
| Tests | `test/`, against a fake API (`test/support/fake-api.mjs`): no key, no network — run them with `IDEOGRAM_API_KEY` unset, or the live dry-run suite runs too |
| Run the local build | `IDEOGRAM_API_KEY=your-key node dist/index.js` |
| Node.js | 22.18 or newer (`engines`; the scripts and `npm run lint` need it) |

## The API specification drives the code

| | |
|---|---|
| Install the generator | `npm ci --prefix scripts/spec-gen` |
| Regenerate `src/generated/` | `npm run spec:generate` |
| Check it is current | `npm run spec:check` |
| Compare with the live API | `npm run spec:pull` |
| Rebuild the API reference | `npm run build && npm run docs:api` |
| A snapshot update | The steps in [CONTRIBUTING.md](./CONTRIBUTING.md#adding-a-new-tool) |

## Where things are

| | |
|---|---|
| `src/server.ts` | `toolDefinitions()`: every tool this release registers |
| `src/tools/` | The tools; a model family is a `FamilyToolSpec` in `src/tools/curated.ts` |
| `src/spec/` | Each operation's class (`classify.ts`), what this release serves (`support.ts`), the rules the specification states only in prose (`overlay.ts`) |
| `spec/openapi.json` | The specification snapshot |
| `src/generated/` | Generated from the specification: never edited by hand |
| `docs/API-REFERENCE.md` | Every operation the API serves (generated: `npm run docs:api`) |
| `docs/TOOLS.md` | Every tool, its models and its behaviour |
| `docs/adr/` | Design decisions |
| `docs/SYSTEMIC.md` | Conventions every change keeps: the structure preset, the baselines, the exemplars |
| `CONTRIBUTING.md` | Code style, adding a tool, pull requests |

## Rules

| | |
|---|---|
| A request that creates work | Resent only when it never left the machine or got a 429 |
| `private` | Sent as `true` by a curated tool whose model takes it, unless the caller sets it |
| Runtime dependencies | Two (`@modelcontextprotocol/sdk`, `zod`); a new one is discussed first |
| A user-visible change | One CHANGELOG.md entry under `[Unreleased]` |
| Addresses | The addresses this repository publishes for the project are in `qmediat.io` (`contact@`, `security@`, `dev@`); the qmediat team's commits are authored as `dev@qmediat.io`, a contributor's with their own address; no personal or account address in any file (`npm run check:addresses` enforces it) |
| A live dry run | The new `docs/PRICES-<date>.md` linked from `docs/PRICES.md` |
| A release | README "Supports", `server.json` and `package-lock.json` name the new version; the release check fails when one differs |
