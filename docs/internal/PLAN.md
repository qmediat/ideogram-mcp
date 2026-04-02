# Ideogram MCP Server — Implementation Plan

## Context

Build a clean, secure MCP server for the Ideogram AI image generation API (V3). Built from scratch using official API documentation — no forked code, no security concerns from third-party packages.

**Status:** ✅ Complete — all 3 phases done, 7 tools live-tested, 6 rounds of code review passed.

## Architecture

- **Runtime:** Node.js 22+ / TypeScript / ES Modules
- **MCP SDK:** `@modelcontextprotocol/sdk` 1.29.0 (pinned)
- **HTTP:** Native `fetch` + `FormData` + `Blob` (Node built-in) — zero HTTP deps
- **Validation:** `zod` 4.3.6 via `zod/v4` (pinned)
- **License:** MIT

### Directory Structure

```
ideogram/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── docs/
│   ├── API-REFERENCE.md          # Ideogram API V3 specification
│   └── internal/
│       ├── PLAN.md               # This file
│       └── PUBLISHING-STRATEGY.md
├── src/
│   ├── index.ts              # Entry point (shebang + stdio transport)
│   ├── server.ts             # MCP server setup + registerTool for all 7 tools
│   ├── config.ts             # Zod-validated env vars (IDEOGRAM_API_KEY, IDEOGRAM_OUTPUT_DIR)
│   ├── client.ts             # Ideogram API client (fetch + retry + SSRF + download)
│   ├── errors.ts             # IdeogramApiError + retryable status/network classification
│   ├── image-input.ts        # Unified image loader (validate + read + Blob)
│   ├── storage.ts            # Safe image saving + input validation (symlink, extension, size)
│   ├── types.ts              # Shared Zod schemas (params + response + enums)
│   └── tools/
│       ├── generate.ts       # Text-to-image generation
│       ├── describe.ts       # Image-to-text description
│       ├── edit.ts           # Mask-based inpainting
│       ├── remix.ts          # Image transformation with style control
│       ├── reframe.ts        # Outpainting to new resolution (69 valid sizes)
│       ├── replace-bg.ts     # Background replacement
│       └── upscale.ts        # Guided image upscaling (image_request JSON format)
└── dist/                     # Compiled output (gitignored)
```

## Tools (7)

| Tool | Endpoint | Field Name | Format |
|------|----------|:----------:|--------|
| `ideogram_generate` | `POST /v1/ideogram-v3/generate` | — | Flat multipart |
| `ideogram_describe` | `POST /describe` | `image_file` | Flat multipart |
| `ideogram_edit` | `POST /v1/ideogram-v3/edit` | `image` + `mask` | Flat multipart |
| `ideogram_remix` | `POST /v1/ideogram-v3/remix` | `image` | Flat multipart |
| `ideogram_reframe` | `POST /v1/ideogram-v3/reframe` | `image` | Flat multipart |
| `ideogram_replace_background` | `POST /v1/ideogram-v3/replace-background` | `image` | Flat multipart |
| `ideogram_upscale` | `POST /upscale` | `image_file` | `image_request` JSON wrapper |

## Security Design

| Concern | Solution |
|---------|----------|
| Supply chain | **2 runtime deps only** — no axios, no form-data |
| API key safety | Env var `IDEOGRAM_API_KEY`, validated on startup via Zod, never logged |
| API key destination | Sent ONLY to `api.ideogram.ai` (hardcoded base URL) |
| SSRF (download URLs) | HTTPS required + hostname allowlist + `redirect: "manual"` |
| Content-Type | Downloads must be `image/*` — HTML/JSON error pages rejected |
| Download size | Content-Length pre-check + post-buffer 50 MB cap |
| Path traversal (input) | Extension allowlist (.png/.jpg/.jpeg/.webp) + `lstat()` symlink rejection |
| Path traversal (output) | `path.relative()` containment check + generated filenames |
| Symlink attacks | `lstat()` BEFORE `realpath()` — rejects user-created symlinks |
| File size DoS | `stat()` check before read — 10 MB limit |
| Filename injection | `ideogram-{timestamp}-{random}.{ext}` — no user input in names |
| Response validation | Zod schemas on all API responses — no blind `as` casts |
| Safety filter | `url: null` when `is_image_safe=false` — skipped, not crashed |
| Retry logic | Exponential backoff + jitter for 429/500/502/503/504 + network errors |
| Request timeout | `AbortSignal.timeout(120s)` on every fetch |
| Code injection | No `eval()`, `child_process`, `exec` |
| Telemetry | None — no phoning home |

## Dependencies (minimal)

**Runtime (2):**
- `@modelcontextprotocol/sdk` 1.29.0 — MCP protocol
- `zod` 4.3.6 — schema validation (via `zod/v4`)

**Dev (2):**
- `typescript` 6.0.2
- `@types/node` 22.15.3

## Implementation Phases

### Phase 1: Scaffold + API client + generate + describe ✅
- Project setup (package.json with pinned deps, tsconfig, ESM)
- config.ts, errors.ts, types.ts, client.ts, storage.ts
- MCP server with `ideogram_generate` + `ideogram_describe`
- Build + smoke test
- 2 rounds of code review (GPT-5.3-Codex, Gemini 2.5 Pro, Grok-4)

### Phase 2: Remaining 5 tools + image input ✅
- image-input.ts (unified loader)
- edit, remix, reframe, replace-bg, upscale
- Security hardening from code review findings
- 2 additional rounds of code review + Copilot

### Phase 3: Integration & documentation ✅
- README.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md
- Node engine downgrade (>=22), npm packaging (files field, prepack)
- Configuration in ~/.claude.json as server #20
- Live test with real Ideogram API (all 7 tools)
- 2 additional rounds of code review (release gate)

## Code Review History

6 rounds × 4 reviewers = 24 reviews total:
- GPT-5.3-Codex (OpenAI) — 19 true findings, 0 false positives (100%)
- GitHub Copilot — 14 true findings, 1 false positive (93%)
- Grok-4 (xAI) — 8 true findings, 4 false positives (67%)
- Gemini 2.5 Pro (Google) — 10 true findings, 14 false positives (42%)

49 issues found and fixed. All CRITICAL and MAJOR findings resolved.

## Configuration

```json
{
  "ideogram": {
    "command": "npx",
    "args": ["-y", "ideogram-mcp"],
    "env": {
      "IDEOGRAM_API_KEY": "your-api-key",
      "IDEOGRAM_OUTPUT_DIR": "/tmp/ideogram-output"
    }
  }
}
```

## Verification

1. ✅ `npm run build` — compiles without errors
2. ✅ `node dist/index.js` — starts on stdio, fails gracefully without API key
3. ✅ Server visible in Claude Code MCP list (server #20)
4. ✅ `ideogram_generate` — text-to-image, saved to output dir
5. ✅ `ideogram_describe` — image-to-text description
6. ✅ `ideogram_edit` — mask-based inpainting (mask must match image dimensions)
7. ✅ `ideogram_remix` — image transformation with image_weight control
8. ✅ `ideogram_reframe` — outpainting to 1536x640
9. ✅ `ideogram_replace_background` — tropical beach sunset
10. ✅ `ideogram_upscale` — 1024→2048 upscale
11. ✅ Security: symlink blocked, SSRF blocked, extension validated
12. ✅ `npm pack` — clean tarball (23 KB, no src/docs/internal/.env)
