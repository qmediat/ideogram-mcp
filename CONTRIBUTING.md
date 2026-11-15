# Contributing to ideogram-mcp

Thank you for your interest in contributing! This is an open-source project by [Quantum Media Technologies](https://www.qmediat.io)

## Architecture Principles

- **Zero axios** — use Node.js native `fetch`
- **Zod v4** — input schemas and response validation use `zod/v4`; request and response schemas are generated from the specification (`src/generated/`, never edited by hand)
- **MCP SDK** — `@modelcontextprotocol/sdk` with `registerTool()` API
- **Security first** — see [SECURITY.md](./SECURITY.md) for the full model
- **Minimal dependencies** — 2 runtime deps only, no exceptions without discussion

## Development Setup

```bash
git clone https://github.com/qmediat/ideogram-mcp.git
cd ideogram-mcp
npm install
npm run build
npm run typecheck
npm run lint        # structure rules, repeated blocks, the baseline ratchet (docs/SYSTEMIC.md §1)
npm run format      # Prettier (npm run lint checks it)
npm test            # builds, then every test against a fake API (no key, no network); with IDEOGRAM_API_KEY set, the live dry-run suite runs too (below)
npm run check:supports  # README "Supports", server.json and package-lock.json name the package version
npm run check:addresses # every email address in a tracked file is in qmediat.io
```

The specification snapshot drives the code: `npm ci --prefix scripts/spec-gen && npm run spec:generate` regenerates
`src/generated/` (CI checks it with `npm run spec:check`), `npm run docs:api` the API reference, `npm run spec:pull`
compares the live specification with the snapshot. These scripts need Node.js 22.18 or newer (type stripping), and so
does `npm run lint` (its Babel 8 parser: 22.18+ or 24.11+).
With `IDEOGRAM_API_KEY` set, `test/live-dry-run.test.mjs` quotes every curated model at no cost and writes the prices
to `docs/PRICES-<date>.md` (link the new file from `docs/PRICES.md`).

Run locally:

```bash
IDEOGRAM_API_KEY=your-key node dist/index.js
```

The project compiles with TypeScript 7 (the native compiler). Its npm package ships only `tsc` — no `tsserver` —
so an editor set to use the workspace TypeScript version cannot load it from `node_modules`; keep the editor's
bundled TypeScript.

## Code Style

- TypeScript strict mode
- ES Modules (`"type": "module"`)
- `as const` for literal types in MCP responses
- Explicit error handling — no untyped `catch` blocks
- `npm run lint` before a pull request: the structure rules (function length, complexity, nesting, a reason on every
  disable directive, no bare `assert.throws(fn)`), repeated blocks and the baseline ratchet — `docs/SYSTEMIC.md` §1,
  with the files new code follows
- `npm run format` before a commit (Prettier; `npm run lint` checks it)

## Adding a New Tool

The specification decides the fields; the code decides the behaviour (`docs/adr/0001-openapi-snapshot-as-the-source-of-truth.md`).

1. A model family: add a `FamilyToolSpec` to `src/tools/curated.ts` (name, family, default model, our own description);
   its models and their fields come from the registry and the generated schemas, its checks from `src/tools/family.ts`.
2. Mark the family's operations `curated` in `src/spec/support.ts`; a rule the specification states only in prose goes
   to `src/spec/overlay.ts` with the phrase that states it.
3. Anything else: a `ToolDefinition` in `src/tools/`, registered in `toolDefinitions()` in `src/server.ts`.
4. Tests in `test/` against the fake API (`test/support/fake-api.mjs`): the wire body, the refusals, the outcome. Keep
   `test/budget.test.mjs` green — tools/list stays within 64 KB.
5. `npm run docs:api` regenerates `docs/API-REFERENCE.md`.

A snapshot update: `node scripts/spec-pull.mjs --write`, `npm ci --prefix scripts/spec-gen && npm run spec:generate`,
read the diff of `src/generated/`, then `npm test` (the class counts, the registry and the anchored rules say what
needs a decision).

## Pull Requests

- One feature/fix per PR
- Include a clear description of what changed and why
- All PRs go through code review before merge
- Ensure `npm run build` passes with zero errors

## Releases

- A release updates the README's `## Supports · version X.Y.Z` heading (and the list under it), `server.json`
  (`version` and every `packages[].version`) and the root of `package-lock.json` to the new version;
  `npm run check:supports` fails in CI and in the release workflow while one of them differs or is missing; the
  release workflow also runs `npm run check:addresses`.

## Security

If you find a security vulnerability, please report it privately — see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
