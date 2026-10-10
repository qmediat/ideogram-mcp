# Competitive landscape — 2026-10-01

What other tools offered that `@qmediat.io/ideogram-mcp` 1.1.0 did not, with the provider's own tools first. The
matrix is the 1.1.0 picture that motivated 1.2.0; a row 1.2.0 closed says so in its first cell. Every row
was read from the linked page on 2026-10-01; "unverified" marks what could not be opened.

## The provider: Ideogram

- **Official MCP server** — `https://mcp.ideogram.ai/mcp`, streamable HTTP, OAuth with the Ideogram account, billed to
  the Ideogram app subscription ("no separate billing for MCP requests"). Tools named on
  <https://ideogram.ai/features/mcp/> (12, read from the page's HTML on 2026-10-10; the full list needs an OAuth
  session): `generate_image`, `generate_images_bulk`, `edit_image`, `reframe_image`, `upscale_image`,
  `remove_background`, `upload_image`, `create_collection`, `get_images_by_collection_id`, `create_dataset`,
  `upload_dataset_assets`, `train_model`. Not named: remix, describe, replace background, precise edit, third-party
  models, a price quote. The endpoint answers an unauthenticated `tools/list` with 401 and
  `WWW-Authenticate: Bearer resource_metadata=…`; its authorization server offers dynamic client registration, PKCE
  S256 and the scopes `openid email profile`.
  Clients listed: Claude, ChatGPT, Cursor, Cline, OpenCode, Hermes. Its FAQ sends server-to-server use to the REST API,
  which is this package's niche (stdio + the user's own API key).
- **Docs MCP** — `https://developer.ideogram.ai/_mcp/server`, one tool `searchDocs` (probed with `tools/list`).
- **API today** (<https://developer.ideogram.ai/v1/llms.txt>, <https://developer.ideogram.ai/v2/llms.txt>): v1 has
  Ideogram 4.0 (`POST /v1/ideogram-v4/generate`, an async variant, `/v1/ideogram-v4/describe`), remove background,
  transparent generation; v2 has Ideogram 4.0 / 4.5, Precise Edit 4.5 (up to 4 `reference_images`), async with
  `webhook_url`, `GET /v2/generations/{id}`, `dry_run` price quotes, `usage_cost_usd_micros`, `GET /v2/account/usage`.
  The v3 generate endpoint accepts `style_reference_images`, `character_reference_images` (+ mask), `style_codes`,
  `style_preset`, `color_palette`, `resolution`, `custom_model_uri`, `enable_copyright_detection`
  (<https://developer.ideogram.ai/api-reference/api-reference/generate-v3>).
- **Open weights** — <https://github.com/ideogram-oss/ideogram4> (Ideogram 4, 9.3B, non-commercial licence, Python CLI).

## Community

| Package | Version / activity | npm 30-day | Positioning |
|---|---|---|---|
| @qmediat.io/ideogram-mcp (this) | 1.1.0, 2026-10-01 | 375 | 7 tools on v3, stdio + API key, hardened |
| @takeshijuan/ideogram-mcp-server | 3.0.0, 2026-03-06 | 100 | 10 tools on v3: character references, async + polling + cancel, local cost estimate |
| @runapi.ai/ideogram-v3-mcp | 0.2.0, 2026-09-30 | 195 | through the RunAPI reseller, task-based, `check_pricing` |
| ideogram-mcp-server (delorenj) | 3.1.0, 2025-08-28 | 168 | 4 tools, one style reference image (base64 or path) |
| @sunwood-ai-labs/ideagram-mcp-server | 0.2.12, 2025-05-18 | 72 | generate only, style codes and reference URLs |
| fal MCP, Replicate MCP (official hubs) | live | n/a | multi-model, remote HTTP, job submit/check, pricing |

## Feature matrix

| Feature | This package | Official MCP | Best community | Raw API |
|---|---|---|---|---|
| Ideogram 3.0 generate / inpaint / remix / reframe / replace background / upscale / describe | yes | generate, edit, reframe, upscale | takeshijuan (all) | v1 + v2 |
| Ideogram 4.0 / 4.5 | **no** in 1.1.0 → 4.0 generate in 1.2.0 (4.5 and v2 still no) | yes | no | v1 `ideogram-v4`, v2 `ideogram-4`, `ideogram-4-5` |
| Precise Edit 4.5 (reference images, exact-pixel keep) | **no** | `edit_image` (model unverified) | no | v2 |
| Remove background / transparent generation | **no** | yes | no | v1 |
| `style_reference_images`, `character_reference_images` (+ mask) | **no** in 1.1.0 → yes in 1.2.0 | unverified | takeshijuan (character), delorenj / sunwood (style) | generate, remix, inpaint |
| `style_codes`, `style_preset`, `color_palette`, `resolution`, `enable_copyright_detection` | **no** in 1.1.0 → yes in 1.2.0 (each where its endpoint takes it) | yes (`resolution`) | sunwood (style codes) | yes |
| Async + polling / cancel / webhook | **no** | training only | takeshijuan, runapi | v2 async, v1 v4-async |
| Real cost (`dry_run`, `usage_cost_usd_micros`, `/v2/account/usage`) | **no** | n/a (subscription) | takeshijuan (estimate) | yes |
| Image input from URL / base64; image returned inline as MCP content | **no** (local files, paths in text) | yes | takeshijuan, delorenj | file, URL, base64 |
| Custom models (`custom_model_uri`), datasets, training | **no** in 1.1.0 → `custom_model_uri` on generate in 1.2.0; no training | yes | no | yes |
| Hardening: HTTPS allowlist, redirects blocked, symlinks rejected, `image/*` required, Zod on every response, request-size checks before any read, safety-filtered images reported | **yes** (only this package) | unverified | no | — |
| Transport / auth | stdio + API key | remote HTTP + OAuth | stdio + key or reseller login | — |

## Gaps, ranked

1. Style and character controls on the endpoints already called (same multipart form; the size checks already cover
   extra files).
2. Ideogram 4.0 through `/v1/ideogram-v4/generate` (same auth, same base URL); 4.5 Precise Edit through v2 later.
3. Remove background and transparent generation (single-file endpoints).
4. Real cost reporting from the API instead of nothing.
5. Async jobs (v4-async, v2 async + `GET /v2/generations/{id}`) against client timeouts on QUALITY × 8.
6. URL / base64 input and inline `image` content in the MCP response (clients without file access).
7. Remove object, layerize text, magic-prompt-v4, describe-v4 (structured), upscale model choice.
8. `custom_model_uri`; training tools optional.
9. Remote HTTP + OAuth — not worth chasing: Ideogram owns that niche.

## Corrections to this package's own docs (found by the research)

- README and `docs/API-REFERENCE.md` said "Ideogram 4.x uses the v2 API": the v1 API has `ideogram-v4` endpoints too.
- mcp.film's listing says no official Ideogram MCP exists — stale since June 2026.
