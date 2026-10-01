<p align="left">
  <a href="https://www.qmediat.io/open-source?utm_source=oss-readme&utm_medium=ideogram-mcp&utm_campaign=open-source">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-light.svg">
      <img src="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-badge.svg" alt="Quantum Media Technologies" height="40">
    </picture>
  </a>
</p>

# @qmediat.io/ideogram-mcp

MCP server for [Ideogram 3.0](https://developer.ideogram.ai) through Ideogram's v1 API (`api.ideogram.ai/v1/ideogram-v3/*`) — generate, edit (inpaint), remix, reframe, replace background, upscale and describe images from Claude Code, Claude Desktop, or any MCP client over stdio. Ideogram 4.x and the v2 API are not used; Ideogram documents the v1 API as still working, with no announced sunset.

[![npm version](https://img.shields.io/npm/v/@qmediat.io/ideogram-mcp)](https://www.npmjs.com/package/@qmediat.io/ideogram-mcp)
[![license](https://img.shields.io/npm/l/@qmediat.io/ideogram-mcp)](https://github.com/qmediat/ideogram-mcp/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://github.com/qmediat/ideogram-mcp/blob/main/tsconfig.json)
[![node](https://img.shields.io/node/v/@qmediat.io/ideogram-mcp)](https://github.com/qmediat/ideogram-mcp/blob/main/package.json)

## Why this server?

- **7 tools** covering the Ideogram 3.0 endpoints — generate, edit (inpaint), remix, reframe, replace background, upscale, describe. Style and character reference images, colour palettes, style presets and custom models are not exposed
- **Guarded I/O** — HTTPS-only downloads from an allowlist with redirects blocked, a symlinked image file rejected, `image/*` Content-Type required, Zod schemas on every success response, output paths contained in the output directory ([details](https://github.com/qmediat/ideogram-mcp/blob/main/SECURITY.md))
- **2 runtime dependencies** — `@modelcontextprotocol/sdk` + `zod`; native `fetch`, `FormData` and `Blob`
- **Direct calls to api.ideogram.ai** — not proxied through a third-party service
- **Failure handling** — 3 retries with exponential backoff and `Retry-After`, safety-filtered images reported, a failed download isolated per image

## Quick Start

Requires Node.js 22 or newer and an `IDEOGRAM_API_KEY` — create one in Ideogram's API dashboard at [ideogram.ai/platform](https://ideogram.ai/platform) → **API Keys** → **Create key** ([setup guide](https://developer.ideogram.ai/ideogram-api/api-setup)).

```bash
claude mcp add --scope user ideogram -e IDEOGRAM_API_KEY=your-api-key -e IDEOGRAM_OUTPUT_DIR=/tmp/ideogram-output -- npx -y @qmediat.io/ideogram-mcp
```

or by hand (below). `npm install -g @qmediat.io/ideogram-mcp` installs the `ideogram-mcp` command, which can replace the `npx` line in any config.

## Configuration

### Claude Code

Add to `~/.claude.json` → `mcpServers`:

```json
{
  "ideogram": {
    "command": "npx",
    "args": ["-y", "@qmediat.io/ideogram-mcp"],
    "env": {
      "IDEOGRAM_API_KEY": "your-api-key",
      "IDEOGRAM_OUTPUT_DIR": "/tmp/ideogram-output"
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
      "args": ["-y", "@qmediat.io/ideogram-mcp"],
      "env": {
        "IDEOGRAM_API_KEY": "your-api-key",
        "IDEOGRAM_OUTPUT_DIR": "/tmp/ideogram-output"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `IDEOGRAM_API_KEY` | Yes | — | Your Ideogram API key ([ideogram.ai/platform](https://ideogram.ai/platform) → API Keys) |
| `IDEOGRAM_OUTPUT_DIR` | No | `/tmp/ideogram-output` | Any folder where you want images saved. Use absolute paths (e.g. `/home/user/images/ideogram`) |

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `ideogram_generate` | Generate images from text prompts | `prompt`, `aspect_ratio`, `rendering_speed`, `style_type`, `num_images` |
| `ideogram_describe` | Generate text description of an image | `image` (file path), `describe_model_version` (`V_2` / `V_3`) |
| `ideogram_edit` | Edit the masked areas of an image (Ideogram's inpaint endpoint) | `image`, `mask` (black = edit), `prompt` |
| `ideogram_remix` | Transform an image with a new prompt | `image`, `prompt`, `image_weight` (0-100, default 50), `negative_prompt` |
| `ideogram_reframe` | Extend an image to a new resolution (outpainting) | `image`, `resolution` (69 valid sizes) |
| `ideogram_replace_background` | Replace background, preserving foreground | `image`, `prompt` |
| `ideogram_upscale` | Upscale with guided enhancement | `image`, `prompt` (optional), `resemblance` (0-100), `detail` (0-100) |

Every input image is a local file (`.png`, `.jpg`, `.jpeg`, `.webp`) of at most 25 MB — Ideogram's maximum.

### Common Parameters

| Parameter | Available In | Values |
|-----------|-------------|--------|
| `rendering_speed` | generate, edit, remix, reframe, replace_background | `FLASH`, `TURBO`, `DEFAULT`, `QUALITY` |
| `magic_prompt` | generate, edit, remix, replace_background, upscale | `AUTO`, `ON`, `OFF` |
| `style_type` | generate, edit, remix | `AUTO`, `GENERAL`, `REALISTIC`, `DESIGN`, `FICTION` (omitted: the API's default, GENERAL) |
| `negative_prompt` | generate, remix | free text |
| `aspect_ratio` | generate, remix | `1x1`, `16x9`, `9x16`, `4x3`, `3x4`, and 10 more |
| `num_images` | all tools except describe | `1`-`8` |
| `seed` | all tools except describe | `0`-`2,147,483,647` |

## Security

A defensive, minimal-dependency design:

- **SSRF protection** — HTTPS-only downloads, hostname allowlist, redirect blocking
- **Symlink rejection** — `lstat()` rejects a symlinked image file before reading (a symlinked parent directory is resolved)
- **Content-Type validation** — downloads must be `image/*`, rejecting HTML/JSON error pages
- **Zod response validation** — every success response is parsed through a schema
- **Path traversal prevention** — extension allowlist + `path.relative()` containment check on saved files
- **Input paths** — the model may name any readable `.png`/`.jpg`/`.jpeg`/`.webp` file on the machine for upload; run the server as a user whose readable images you are willing to send to Ideogram

Full details in [SECURITY.md](https://github.com/qmediat/ideogram-mcp/blob/main/SECURITY.md).

## Development

```bash
git clone https://github.com/qmediat/ideogram-mcp.git
cd ideogram-mcp
npm install
npm run build
npm run typecheck
npm test            # builds, then the stdio smoke test and the endpoint tests (a fake fetch, no key)
```

Run locally:

```bash
IDEOGRAM_API_KEY=your-key node dist/index.js
```

## Contributing

See [CONTRIBUTING.md](https://github.com/qmediat/ideogram-mcp/blob/main/CONTRIBUTING.md) for architecture guidelines and PR requirements.


## Trademarks and affiliation

Ideogram is a trademark of Ideogram. This is an independent, community-maintained integration published by Quantum Media Technologies sp. z o.o.; it is not affiliated with, sponsored by or endorsed by Ideogram. Use of the Ideogram API through this server is subject to Ideogram's own terms and to your own API key or account.

## License

[MIT](https://github.com/qmediat/ideogram-mcp/blob/main/LICENSE) — [Quantum Media Technologies](https://www.qmediat.io)

---

Made by [Quantum Media Technologies](https://www.qmediat.io/open-source?utm_source=oss-readme&utm_medium=ideogram-mcp&utm_campaign=open-source) · [more open source from qmediat](https://github.com/qmediat)
