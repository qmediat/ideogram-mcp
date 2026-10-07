<p align="left">
  <a href="https://www.qmediat.io/open-source?utm_source=oss-readme&utm_medium=ideogram-mcp&utm_campaign=open-source">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-light.svg">
      <img src="https://raw.githubusercontent.com/qmediat/.github/b35746f6b3c933d9eeb539033ef40ea9876349ae/assets/qmediat-wordmark-badge.svg" alt="Quantum Media Technologies" height="40">
    </picture>
  </a>
</p>

# @qmediat.io/ideogram-mcp

MCP server for the [Ideogram](https://developer.ideogram.ai) platform through its v2 API: every image model Ideogram sells through one API key — Ideogram 4.5, 4.0, 3.0, 2a and 2.0, GPT Image, Nano Banana, P-Image, Z-Image, the Topaz upscalers — for generate, inpaint, remix, reframe, replace background, upscale and describe, from Claude Code, Claude Desktop or any MCP client over stdio. Every call can be priced first (the API's own dry run), long jobs are returned by id and collected later, and any other operation the release serves is one validated raw call away. Built from Ideogram's OpenAPI specification ([ADR-0001](https://github.com/qmediat/ideogram-mcp/blob/main/docs/adr/0001-openapi-snapshot-as-the-source-of-truth.md)).

[![npm version](https://img.shields.io/npm/v/@qmediat.io/ideogram-mcp)](https://www.npmjs.com/package/@qmediat.io/ideogram-mcp)
[![license](https://img.shields.io/npm/l/@qmediat.io/ideogram-mcp)](https://github.com/qmediat/ideogram-mcp/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://github.com/qmediat/ideogram-mcp/blob/main/tsconfig.json)
[![node](https://img.shields.io/node/v/@qmediat.io/ideogram-mcp)](https://github.com/qmediat/ideogram-mcp/blob/main/package.json)

## Why this server?

- **The platform, not one model** — `model` on every tool, with each model's own fields (a field the model does not take is refused, naming the models that do). The model lists and fields come from Ideogram's specification, so a new model is a reviewed snapshot update, not a rewrite
- **Price before you pay** — `ideogram_quote` asks the API what exactly this call would cost (USD and credits; nothing generated or billed)
- **Never billed twice** — a job is returned the moment Ideogram accepts it; the tool waits up to `wait_s` and otherwise hands back the `generation_id` for `ideogram_generation`. A request is resent only when it never left the machine or got a 429
- **Everything else, validated** — `ideogram_operations` lists what the API offers; `ideogram_api` calls any served operation by id, checked against its own schema first
- **Guarded I/O** — per-operation upload limits checked before any file is read, streamed downloads with a 50 MB cap from allow-listed HTTPS hosts, typed 402/429 errors that say what to do ([details](https://github.com/qmediat/ideogram-mcp/blob/main/SECURITY.md))
- **2 runtime dependencies** — `@modelcontextprotocol/sdk` + `zod`; native `fetch`

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

| Tool | What it does | Models |
|------|--------------|--------|
| `ideogram_generate` | Images from a text prompt | `ideogram-3` (default), `ideogram-4-5`, `ideogram-4`, `ideogram-3-character`, `ideogram-3-custom-model`, `ideogram-4-custom-model`, `ideogram-3-transparent`, `ideogram-4-transparent`, `ideogram-2a`, `ideogram-2`, `gpt-image-2`, `gpt-image-2-5-flare`, `gpt-image-2-5-sunburst`, `nano-banana-2`, `nano-banana-pro`, `p-image-ideogram`, `z-image`, `auto` |
| `ideogram_inpaint` | Repaint the masked part of an image (black = repaint) | `ideogram-3` (default), `ideogram-3-character`, `ideogram-3-custom-model` |
| `ideogram_edit` | The 1.x name of `ideogram_inpaint` (kept through 2.x) | as inpaint |
| `ideogram_remix` | New images from a source image and a prompt | `ideogram-3` (default), `ideogram-3-character`, `ideogram-3-custom-model`, `ideogram-4`, `auto` |
| `ideogram_reframe` | Extend an image to a new size (outpainting) | `ideogram-3` (default), `nano-banana-2` |
| `ideogram_replace_background` | A new background, the subject kept | `ideogram-3` (default), `gpt-image-2` |
| `ideogram_upscale` | Enlarge an image | `auto` (default), `topaz-bloom-2`, `topaz-redefine`, `topaz-standard-2`, `topaz-text-refine`, `topaz-wonder-3-5`, `nano-banana-pro` |
| `ideogram_describe` | Describe an image: words (`ideogram-3`, default) or a structured JSON prompt (`ideogram-4`) | `ideogram-3`, `ideogram-4` |
| `ideogram_quote` | The price of a call: `{"tool": "ideogram_generate", "arguments": {…}}` | every model that offers a dry run (all but describe) |
| `ideogram_generation` | Collect a generation by `generation_id` | — |
| `ideogram_operations` | What the API offers: families, operations, fields, limits | — |
| `ideogram_api` | Any served operation by id (precise edit, remove background, remove object, …) | — |

Each model's fields are listed in the tool's schema (one variant per model) and in [docs/API-REFERENCE.md](https://github.com/qmediat/ideogram-mcp/blob/main/docs/API-REFERENCE.md), generated from the specification. Image inputs are local file paths (or Ideogram asset identifiers where a model takes them); each operation's own upload limits apply, checked each file against its field's limit before any is read, the whole encoded request against the request cap before it is sent.

### Waiting, and collecting later

A generation is sent asynchronously and returned the moment Ideogram accepts it. The tool then waits up to `wait_s` seconds (default 45, at most 50: MCP clients time a call out at 60 s), polling at 2 s, ×1.5, up to 30 s apart. A job still running at the end of the wait comes back as its `generation_id`: `ideogram_generation {"generation_id": "…"}` collects it later, in this session or another. Sending the request again would start — and bill — a second job.
One HTTP attempt may take up to 120 s (an upload of tens of MB needs it); retries between attempts share a 30 s budget
and a poll never outlives the wait, but a client that gives up during a long upload cannot learn the id of a job the
API accepted after that — a limit of any HTTP client, not something this server can close.

### Prices

`ideogram_quote` sends exactly the request the tool would send, with Ideogram's `dry_run`: the answer is the price in USD and credits (at your account's credit rate), `exact` or an `estimate` with its upper bound; nothing is generated, stored or billed. Describe has no dry run, so it cannot be quoted. A completed generation shows the cost Ideogram reports for it. This server keeps no price table: prices are the API's, per request.

### Compatibility with 1.x

Calls written for 1.x keep working through 2.x, and the result says what was mapped:

| 1.x input | 2.0 |
|---|---|
| `ideogram_generate` without `model` | `ideogram-3`, as before |
| `model: "3.0"` / `"4.0"` | `ideogram-3` / `ideogram-4` |
| `rendering_speed: "TURBO"` / `"DEFAULT"` / `"QUALITY"` | `turbo` / `default` / `quality` on the models that take `rendering_speed`; `quality: low / medium / high` on those that take `quality` (Ideogram 4.5, GPT Image 2.5, P-Image) |
| `rendering_speed: "FLASH"` | refused (v2 has no FLASH) — `quality: very_low` on the models that offer it |
| `magic_prompt`, `style_type`, `color_palette.name` in capitals | lowercase |
| `ideogram_edit` | `ideogram_inpaint` |
| `describe_model_version: "V_3"` | `model: "ideogram-3"` |

A 1.x field that the chosen v2 model does not take is refused with the models that take it (the [changelog](https://github.com/qmediat/ideogram-mcp/blob/main/CHANGELOG.md) has the full table).

### The raw call

`ideogram_api` runs any operation this release serves — the curated ones and every other `/v2/image` operation (precise edit, remove background, remove object) — by its id, with its parameters kept in their places: `{"operation": "…", "params": {"path": {}, "query": {}, "body": {}}, "files": [{"field": "image", "path": "…"}], "dry_run": false}`. The parameters are checked against the operation's own schema and rules before anything is sent. Operations Ideogram's documentation does not list need `allow_undocumented: true`; web-app (Bearer) and internal operations are refused; video, the commercial tools and account usage come in later releases ([plan](https://github.com/qmediat/ideogram-mcp/blob/main/docs/DESIGN-ideogram-v2.md#8-steps-one-release-per-finished-family--invariant-15)).

## Security

A defensive, minimal-dependency design:

- **SSRF protection** — downloads over HTTPS only, from allow-listed hosts, redirects blocked
- **Symlink rejection** — `lstat()` rejects a symlinked input file before reading (a symlinked parent directory is resolved)
- **Upload limits per operation** — each file checked with `stat()` against its field's limit before any is read; the local file name is never sent (a file goes as `<field>.<ext>`)
- **Streamed, capped downloads** — written to disk with a byte counter, stopped at 50 MB, the partial file removed; `image/*` or `video/mp4` required
- **Schema validation** — inputs against each model's generated schema before any request; a success response the specification's schema rejects is reported as a contract mismatch, never as a success
- **Input paths** — the model may name any readable image file on the machine for upload; run the server as a user whose readable images you are willing to send to Ideogram

Full details in [SECURITY.md](https://github.com/qmediat/ideogram-mcp/blob/main/SECURITY.md).

## Development

```bash
git clone https://github.com/qmediat/ideogram-mcp.git
cd ideogram-mcp
npm install
npm run build
npm run typecheck
npm test            # builds, then every test against a fake API (no key, no network); with IDEOGRAM_API_KEY set, the live dry-run suite runs too (below)
```

The specification snapshot drives the code: `npm ci --prefix scripts/spec-gen && npm run spec:generate` regenerates
`src/generated/` (CI checks it with `npm run spec:check`), `npm run docs:api` the API reference, `npm run spec:pull`
compares the live specification with the snapshot. These scripts need Node.js 22.18 or newer (type stripping).
With `IDEOGRAM_API_KEY` set, `test/live-dry-run.test.mjs` quotes every curated model at no cost and writes the prices
to `docs/PRICES-<date>.md`.

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
