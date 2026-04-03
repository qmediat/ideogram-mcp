# Contributing to ideogram-mcp

Thank you for your interest in contributing! This is a flagship open-source project by [Quantum Media Technologies sp. z o.o.](https://www.qmediat.io)

## Architecture Principles

- **Zero axios** — use Node.js native `fetch`, `FormData`, `Blob`
- **Zod v4** — all input schemas and response validation use `zod/v4`
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

## Code Style

- TypeScript strict mode
- ES Modules (`"type": "module"`)
- `as const` for literal types in MCP responses
- Explicit error handling — no untyped `catch` blocks

## Adding a New Tool

1. Create `src/tools/your-tool.ts` following the pattern of existing tools
2. Define a Zod input schema with `.describe()` on every field
3. Use `loadImageBlob()` from `image-input.ts` for image inputs
4. Use `IdeogramResponseSchema.parse()` for response validation
5. Handle `url: null` (safety-filtered images)
6. Use `Promise.allSettled` for multi-image downloads
7. Register in `src/server.ts` via `server.registerTool()`

## Pull Requests

- One feature/fix per PR
- Include a clear description of what changed and why
- All PRs go through code review before merge
- Ensure `npm run build` passes with zero errors

## Security

If you find a security vulnerability, please report it privately — see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
