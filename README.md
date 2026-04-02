# ideogram-mcp

MCP server for the [Ideogram V3 API](https://developer.ideogram.ai) — generate, edit, remix, upscale, and describe images from Claude Code, Claude Desktop, or any MCP client.

[![npm version](https://img.shields.io/npm/v/ideogram-mcp)](https://www.npmjs.com/package/ideogram-mcp)
[![license](https://img.shields.io/npm/l/ideogram-mcp)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](./tsconfig.json)

## Why this server?

- **7 tools** — full Ideogram V3 coverage (generate, edit, remix, reframe, replace background, upscale, describe)
- **Security-first** — SSRF protection, symlink rejection, Content-Type validation, path traversal prevention, Zod response validation ([details](./SECURITY.md))
- **2 runtime dependencies** — `@modelcontextprotocol/sdk` + `zod`. No axios, no form-data, no HTTP libraries
- **Native Ideogram API** — direct V3 endpoints, not proxied through fal.ai or Replicate
- **Production-hardened** — retry with exponential backoff, safety filter handling, partial failure resilience

## Quick Start

```bash
npm install -g ideogram-mcp
```

Or use directly:

```bash
npx ideogram-mcp
```

Requires `IDEOGRAM_API_KEY` — get one at [ideogram.ai/manage-api](https://ideogram.ai/manage-api).

## Configuration

### Claude Code

Add to `~/.claude.json` → `mcpServers`:

```json
{
  "ideogram": {
    "command": "npx",
    "args": ["-y", "ideogram-mcp"],
    "env": {
      "IDEOGRAM_API_KEY": "your-api-key",
      "IDEOGRAM_OUTPUT_DIR": "~/Pictures/ideogram"
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ideogram": {
      "command": "npx",
      "args": ["-y", "ideogram-mcp"],
      "env": {
        "IDEOGRAM_API_KEY": "your-api-key",
        "IDEOGRAM_OUTPUT_DIR": "~/Pictures/ideogram"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `IDEOGRAM_API_KEY` | Yes | — | Your Ideogram API key ([get one here](https://ideogram.ai/manage-api)) |
| `IDEOGRAM_OUTPUT_DIR` | No | `/tmp/ideogram-output` | Any folder where you want images saved. Examples: `~/Pictures/ideogram`, `./output`, `/tmp/ideogram-output` |

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `ideogram_generate` | Generate images from text prompts | `prompt`, `aspect_ratio`, `rendering_speed`, `style_type`, `num_images` |
| `ideogram_describe` | Generate text description of an image | `image` (file path) |
| `ideogram_edit` | Edit areas of an image with mask-based inpainting | `image`, `mask`, `prompt` |
| `ideogram_remix` | Transform an image with a new prompt | `image`, `prompt`, `image_weight` (0-100) |
| `ideogram_reframe` | Extend an image to a new resolution (outpainting) | `image`, `resolution` (69 valid sizes) |
| `ideogram_replace_background` | Replace background, preserving foreground | `image`, `prompt` |
| `ideogram_upscale` | Upscale with guided enhancement | `image`, `resemblance` (0-100), `detail` (0-100) |

### Common Parameters

| Parameter | Available In | Values |
|-----------|-------------|--------|
| `rendering_speed` | generate, edit, remix, reframe, replace_background | `FLASH`, `TURBO`, `DEFAULT`, `QUALITY` |
| `magic_prompt` | generate, edit, remix, replace_background, upscale | `AUTO`, `ON`, `OFF` |
| `style_type` | generate, edit, remix | `AUTO`, `GENERAL`, `REALISTIC`, `DESIGN`, `FICTION` |
| `aspect_ratio` | generate, remix | `1x1`, `16x9`, `9x16`, `4x3`, `3x4`, and 10 more |
| `num_images` | all tools | `1`-`8` |
| `seed` | all tools | `0`-`2,147,483,647` |

## Security

This server is designed with a zero-trust, minimal-dependency approach:

- **SSRF protection** — HTTPS-only downloads, hostname allowlist, redirect blocking
- **Symlink rejection** — `realpath()` comparison catches symlinks at any path level
- **Content-Type validation** — downloads must be `image/*`, rejecting HTML/JSON error pages
- **Zod response validation** — API responses parsed through schemas, no blind type casts
- **Path traversal prevention** — extension allowlist + `path.relative()` containment check

Full details in [SECURITY.md](./SECURITY.md).

## Development

```bash
git clone https://github.com/qmediat/ideogram-mcp.git
cd ideogram-mcp
npm install
npm run build
```

Run locally:

```bash
IDEOGRAM_API_KEY=your-key node dist/index.js
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for architecture guidelines and PR requirements.

## License

[MIT](./LICENSE) — [Quantum Media Technologies](https://www.qmediat.io)
