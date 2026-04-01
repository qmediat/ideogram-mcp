# Ideogram MCP Server — Implementation Plan

## Context

Build a clean, secure MCP server for the Ideogram AI image generation API (V3). Built from scratch using official API documentation — no forked code, no security concerns from third-party packages.

## Architecture

- **Runtime:** Node.js 25+ / TypeScript / ES Modules
- **MCP SDK:** `@modelcontextprotocol/sdk` (latest)
- **HTTP:** Native `fetch` (Node built-in) — no axios dependency
- **Validation:** `zod` — consistent with other MCP servers
- **License:** MIT

### Directory Structure

```
ideogram/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── docs/
│   ├── PLAN.md               # This file
│   └── API-REFERENCE.md      # Ideogram API V3 specification
├── src/
│   ├── index.ts              # Entry point (stdio transport)
│   ├── server.ts             # MCP server setup + tool registration
│   ├── client.ts             # Ideogram API client (fetch-based)
│   ├── tools/
│   │   ├── generate.ts       # Text-to-image generation
│   │   ├── edit.ts           # Mask-based inpainting
│   │   ├── remix.ts          # Image transformation
│   │   ├── reframe.ts        # Outpainting to new resolution
│   │   ├── replace-bg.ts     # Background replacement
│   │   ├── upscale.ts        # Image upscaling
│   │   └── describe.ts       # Image description
│   ├── storage.ts            # Safe local image saving
│   └── types.ts              # Shared types + Zod schemas
└── dist/                     # Compiled output
```

## Tools (7)

| Tool | Endpoint | Description |
|------|----------|-------------|
| `ideogram_generate` | POST `/v1/ideogram-v3/generate` | Generate images from text prompts |
| `ideogram_edit` | POST `/v1/ideogram-v3/edit` | Edit images with mask-based inpainting |
| `ideogram_remix` | POST `/v1/ideogram-v3/remix` | Transform images with new prompts |
| `ideogram_reframe` | POST `/v1/ideogram-v3/reframe` | Outpaint to new resolution |
| `ideogram_replace_background` | POST `/v1/ideogram-v3/replace-background` | Replace image backgrounds |
| `ideogram_upscale` | POST `/upscale` | Upscale with guided enhancement |
| `ideogram_describe` | POST `/describe` | Generate text descriptions from images |

## Security Design

| Concern | Solution |
|---------|----------|
| Supply chain (axios) | **Zero axios** — native `fetch` only |
| Path traversal | `path.resolve()` + validation that result stays within output dir |
| Dependency drift | **Pinned exact versions** (no `^` ranges) |
| Data exfiltration | API key sent ONLY to `api.ideogram.ai` (hardcoded) |
| Code injection | No `eval()`, `child_process`, `exec` |
| Telemetry | None — no phoning home |
| Filename injection | Filenames use `ideogram-{timestamp}-{random}.png` (no user input) |

## Dependencies (minimal)

**Runtime (2):**
- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — schema validation

**Dev (2):**
- `typescript`
- `@types/node`

## Implementation Phases

### Phase 1: Scaffold + API client + generate tool
- Project setup (package.json, tsconfig.json)
- Entry point, types, API client, storage service
- MCP server with `ideogram_generate` tool
- Build + smoke test

### Phase 2: Remaining 6 tools
- edit, remix, reframe, replace-bg, upscale, describe
- Build + test each tool

### Phase 3: Integration & documentation
- README.md with setup instructions
- Configuration examples
- Build verification

## Configuration

```json
{
  "command": "node",
  "args": ["path/to/ideogram/dist/index.js"],
  "env": {
    "IDEOGRAM_API_KEY": "your-api-key",
    "IDEOGRAM_OUTPUT_DIR": "path/to/output/images"
  }
}
```

## Verification

1. `npm run build` — compiles without errors
2. `node dist/index.js` — server starts on stdio without crash
3. After configuration — server visible in Claude Code
4. Test: `ideogram_generate` with simple prompt — image saved to output dir
5. Test: `ideogram_describe` with local image — text description returned
