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
```

The project compiles with TypeScript 7 (the native compiler). Its npm package ships only `tsc` — no `tsserver` —
so an editor set to use the workspace TypeScript version cannot load it from `node_modules`; keep the editor's
bundled TypeScript.

## Code Style

- TypeScript strict mode
- ES Modules (`"type": "module"`)
- `as const` for literal types in MCP responses
- Explicit error handling — no untyped `catch` blocks

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

## Security

If you find a security vulnerability, please report it privately — see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
