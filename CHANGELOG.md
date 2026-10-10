# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Step 1 of `docs/DESIGN-ideogram-v2.md`: every image family of Ideogram's documentation index has its own tool.
Step 2: the account — usage and spend, invoices, API keys — and the webhook signature helper.

### Added

- A file field (image, mask, reference and style images, fonts) takes a public `https://` URL beside a local path, on
  every tool (the family tools, `ideogram_quote`, `ideogram_api`): fetched one after another under the field's own
  limit and the room the request cap leaves, as a type the field takes, from a public host only — no IP literal, no
  local name, no private / loopback / link-local / carrier / site-local / mapped / translated address after
  resolution, no redirect followed, never an empty body — inside the call's budget, over a connection pinned to the
  very address the lookup answered (a DNS rebinding reaches nothing), local files read before any fetch, every
  failure named with the URL and its cause; the threat model is section 9b of the design note.
- `inline_images: true` on every tool that saves images (the family tools, `ideogram_generation`, `ideogram_api`):
  each saved image under 3.75 MB (the model APIs behind the clients take 5 MiB of base64 per image), up to 10 MB per
  result, is also returned as MCP image content with its media type normalized, for a client without access to this
  machine's files; the others are named with their size and stay by path. Off by default.
- `ideogram_usage`: the organization's billed API usage as Ideogram reports it (`GET /v2/account/usage`: dense time
  buckets of line items — product, endpoint, cost, billed units, the redacted API key, the source), the last 7 days
  by day unless told otherwise, summed per product and per currency as decimal strings (never floats), the buckets
  handed on unchanged: the shape ai-cost reads. `ideogram_invoices` and `ideogram_api_keys` list what their
  endpoints return; a 404 is said as what it is (an organization-admin key is needed). Reads only, never billed.
- `verifyWebhook` (`dist/webhooks.js`): the canonical message Ideogram signs
  (`request_id\nuser_id\ntimestamp\nsha256_hex(body)`) checked against the JWKS of `GET /v1/.well-known/jwks.json`
  with Ed25519, the header's key first, a rotated key still accepted, the signature as base64, base64url or hex.
  A helper for the receiver: this server receives no webhook itself (a stdio process has no public URL).
- `get_asset_reference_usage` (spec-only) is served by `ideogram_api` behind `allow_undocumented`: a spec-only
  operation of a curated family is raw, as the undocumented reframe models are. Support: curated 47 · raw 5 ·
  planned 75. tools/list: 19 tools.

- `ideogram_precise_edit` (Ideogram 4.5: the image, an optional mask, up to four `reference_images` or
  `reference_image_asset_identifiers`, `context_window`), `ideogram_remove_background` and `ideogram_remove_object`
  (ideogram-1), `ideogram_layerize` (Ideogram 3.0: the text-free base image is saved, the detected text blocks are
  returned as JSON; `font_candidate_files` are sent as fonts — .ttf, .otf, .woff, .woff2 — and refused as images, and
  an image is refused as a font). Each is priced by `ideogram_quote` and collected by `ideogram_generation` like any
  other; the four were reachable through `ideogram_api` only in 2.0.0.
- The rules the specification states in prose for these operations, refused before any request (`src/spec/overlay.ts`,
  each anchored to its phrase): references by reference need the edited image by reference and no mask; a mask leaves
  room for three reference images; `context_window` needs the image as a file and `"auto"` needs a mask; remove object
  needs its source and its mask.
- A `layered` payload in the lifecycle: a `layerized_image` / `layerized_design.generation` entry of a generation is
  shown as its base image (saved, or withheld by the safety check), the design's own link and editable page when the
  API gives them, and its text blocks — never as a raw record.
- `private` is a field of every curated tool whose model takes it, and is sent as `true` unless the caller sets it:
  on remove background, replace background and the `auto` models an omitted `private` follows the plan's setting,
  public when the plan has none (the other operations default to private) — a server on an API key never publishes to
  Ideogram's public feed unless asked. `ideogram_api` sends what the caller gave, as before. (Opus cross-review X1.)
- A curated tool refuses a call without a source image (image, images or an asset identifier; every family but
  generate) before the schema and before any request, and checks the body against the schema of the format it is
  sent in — a call without a file goes as JSON, whose schema may require what the multipart one leaves optional (X3, X4).
- Three more rules from the prose: `reference_images` and `reference_image_asset_identifiers` are alternatives (the
  files would be ignored); `context_window`'s explicit region is four whole numbers, max above min, each side at least
  256 px, aspect ratio within 1:6 and 6:1, at most 4 194 304 pixels; `font_candidate_files` takes at most 5 (X5, X6, X9).

### Changed

- tools/list carries 16 tools; a definition shorter than its `$ref` is inlined (lossless, 1.3 KB; an inlined
  definition is walked again and a definition is dropped only when nothing refers to it any more), and the advertised
  schema budget is 80 KB measured (73 582 bytes over a real session on 2026-10-10, `private` included; the 64 KB of
  2.0.0 was the estimate before step 1 — `test/budget.test.mjs`, design note section 5).
- Verified on the live API on 2026-10-10 (0.07 USD): a precise edit (4.5, `very_low`) and a remove background run
  through acceptance, poll and download; the remove-background result is listed as an image without prompt or seed
  and saved like any image (`test/tools.test.mjs` pins the shape).
- `ideogram_api`'s refusal of a planned operation names "this release", not a version.
- The plan's order after step 2 (design note section 8, operator decision 2026-10-10): custom-model training (v1)
  before video, the commercial tools last; step 1's second change (not this one) brings inline image content and URL
  input, opt-in, for clients without file access.
- `docs/COMPETITION-2026-10-01.md`: the official MCP page names 12 tools (`generate_image` and
  `get_images_by_collection_id` were missing from the list).

- `scripts/spec-gen/`: js-yaml 4.3.2 through an exact `overrides` entry — the nested 4.2.0 openapi-ts' ref-parser pinned
  carried GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj and GHSA-2883-xcg3-v3hh (three high Dependabot alerts at the 2.0.0
  release); the lockfile regenerated under the override (`npm ls js-yaml`: one 4.3.2); CI audits that lockfile (#38).

## [2.0.0] - 2026-10-09

The server moves to Ideogram's v2 API and is built from its OpenAPI specification: every image model the platform
sells through an API key is reachable, priced before a call, and collected by id when it runs long
(`docs/DESIGN-ideogram-v2.md`, `docs/adr/0001-openapi-snapshot-as-the-source-of-truth.md`).

### Added

- `spec/openapi.json`: the specification snapshot of 2026-10-07 (200 operations), classified by one rule into
  documented 66 / spec_only 20 / v1_only 41 / legacy 32 / internal 9 / bearer_only 32; the types and zod schemas
  generated from it (`src/generated/`, `@hey-api/openapi-ts`), regenerated and compared in CI.
- `model` on every family tool, with the exact fields of each model (one variant per model in the advertised schema).
  `ideogram_generate` reaches 18 models: auto, Ideogram 4.5, 4.0 (+ custom model, transparent), 3.0 (+ character,
  custom model, transparent), 2a, 2.0, GPT Image 2 / 2.5 Flare / 2.5 Sunburst, Nano Banana 2 / Pro, P-Image, Z-Image.
  Remix adds Ideogram 4.0 and auto; reframe Nano Banana 2; replace background GPT Image 2; upscale the Topaz models,
  Nano Banana Pro and auto; describe Ideogram 4.0 (a structured JSON prompt). A field the chosen model does not take is
  refused, naming the models that take it.
- `ideogram_inpaint` (the v2 name of `ideogram_edit`, which stays as its alias through 2.x).
- `ideogram_quote`: the price of exactly the call a tool would make, from the API's own `dry_run` (USD and credits as
  decimal strings, exact or an estimate with its upper bound; nothing generated or billed). Operations without
  `dry_run` (describe) are refused locally — a quote request could run them.
- `ideogram_generation`: collect a generation by id. Every generation is sent asynchronously and returned at
  acceptance; the tool waits up to `wait_s` (default 45, at most 50 — the MCP client times out at 60) and otherwise
  answers with the id.
- `ideogram_operations` (discovery) and `ideogram_api`: any operation this release serves, by id, with its path,
  query, header and body parameters checked against the operation's generated schemas and the reviewed constraints;
  undocumented operations need `allow_undocumented: true`; legacy, internal and Bearer-only operations are refused.
- Typed 402 / 429 errors (`reject_reason` and what to do about it, `Retry-After`, the in-flight limit).
- A weekly drift check of the live specification (`scripts/spec-pull.mjs`, `.github/workflows/spec-drift.yml`): one
  issue, updated, never a failed build.
- `docs/API-REFERENCE.md` generated from the snapshot (family × model × fields).

### Changed

- Every call goes to `/v2/…`; images are downloaded by streaming to disk with a byte counter (50 MB cap) instead of
  buffering whole bodies.
- Upload limits are each operation's own, as the specification states them (describe 10 MB, remix 50 MB, 4.5's
  images 25 MB × 5, …), checked before any file is read ("MB" read as decimal megabytes); JPEG, PNG and WebP, the types the specification names.
- A request is sent again only when it never left the machine or the API rejected it with 429; a 5xx, a timeout or a
  reset after sending is reported, never repeated (one tool call never creates two billed jobs). Polls and downloads
  (GET) keep retrying network failures, 429 and 5xx.
- One budget per tool call: 55 s (the MCP client's 60 s minus a margin), ended earlier by the caller's cancellation;
  every attempt, retry sleep (Retry-After included), poll and download of the call is judged against what remains, so
  nothing of a call outlives its caller — a POST is resent only with time for an attempt as long as the rejected one,
  a cut download is listed as not saved beside the generation id (typed `CALL_TIMEOUT` / `CANCELLED`), and
  `ideogram_api` refuses `async: false` (a synchronous result this server could not wait for).
- A cut attempt is typed by construction (review rounds 3–6 of #36, two recorded step-backs): one timer per bound — the
  budget's own signal alone when it is the shorter bound, so no second timer races the same instant — and a poll the
  wait cuts in flight is a clean Pending (collect it with `ideogram_generation`), never "the last poll failed".
- A 2xx body the specification's schema rejects is reported as a contract mismatch with the generation id, never as a
  success.

### Migration from 1.x

The 1.x tool names keep working; a 1.x call is mapped and the result says what was mapped.

| 1.x | 2.0.0 |
|---|---|
| `ideogram_generate` default (Ideogram 3.0) | the same model, `ideogram-3` (cost-neutral; `ideogram-4-5` is the newest) |
| `model: "3.0"` / `"4.0"` | `ideogram-3` / `ideogram-4` (aliases through 2.x) |
| `rendering_speed: "TURBO" \| "DEFAULT" \| "QUALITY"` | lowercase on the models that take `rendering_speed` (Ideogram 2.x, 3.x, 4.0); `quality: "low" \| "medium" \| "high"` on those that take `quality` (Ideogram 4.5, GPT Image 2.5, P-Image) |
| `rendering_speed: "FLASH"` | refused where `rendering_speed` is taken (v2 has no FLASH); `quality: "very_low"` where `quality` is (GPT Image 2.5 has no `very_low`: refused there by its schema) |
| `magic_prompt`, `style_type` uppercase; `color_palette.name: "EMBER"` | lowercase (`auto`, `realistic`, `ember`) |
| `ideogram_edit` | `ideogram_inpaint` (the alias stays through 2.x) |
| `ideogram_describe` `describe_model_version: "V_3"` | `model: "ideogram-3"`; `"V_2"` is refused (no v2 model) |
| `character_reference_image` (one file) on generate / remix / edit | `model: "ideogram-3-character"` with `character_reference_images` |
| `custom_model_uri` on generate | `model: "ideogram-3-custom-model"` or `"ideogram-4-custom-model"` |
| `ideogram_upscale` (default model `auto`) `prompt` / `detail` | taken by other upscale models (`prompt`: nano-banana-pro, topaz-bloom-2, topaz-redefine; `detail`: topaz-redefine) — refused on auto, naming them |
| `ideogram_upscale` `resemblance` / `magic_prompt` | no v2 upscale model takes them: refused; `upscale_factor` sets the size |
| `ideogram_replace_background` `magic_prompt` / `seed` | not taken by v2's replace-background models: refused by name |
| `ideogram_generate` with model 4.0 refusing 3.0 fields | each model's own fields, refused naming the models that take them |

`webhook_url`, `private` and `target_collection_id` are reachable through `ideogram_api`; the curated tools poll and
save locally instead.

### Removed

- The v1 client, the hand-written schemas of the 1.x tools and their endpoint tests.

## [1.2.1] - 2026-10-06

### Added

- `.github/workflows/mcp-registry.yml` keeps the official MCP Registry in step with the releases: every run (at a
  release, at the end of the Release workflow, daily, by hand) publishes each of the last 10 releases that npm
  serves and the registry lacks, oldest first — the `server.json` of its tag with the default branch's description
  (GitHub Actions OIDC, no secret; `mcp-publisher` pinned by version and sha256). The registry listed an old version
  of this server; the next run lists the missing ones.

### Fixed

- `server.json` `description` within the registry's 100-character limit (the registry refused the longer one).

### Security

- `@modelcontextprotocol/sdk` 1.32.0 (was 1.30.1), past GHSA-6qxp-vccf-f47h (fixed in 1.31.0: the SDK's OAuth client
  could send credentials to an authorization server the MCP server chose). This server runs over stdio and imports only
  the SDK's server side, so it never used that client; the bump clears `npm audit`.

## [1.2.0] - 2026-10-01

A comparison with Ideogram's own MCP server and the current API (`docs/COMPETITION-2026-10-01.md`).

### Added

- Style controls on `ideogram_generate` (3.0), `ideogram_edit` and `ideogram_remix`: `style_reference_images` (1-3 files),
  `character_reference_image` with an optional `character_reference_mask`, `style_codes` (1-8), `style_preset` and
  `color_palette` (a preset name or 1-10 explicit colours with weights, never both) on all three; an exact `resolution`
  (one of the 69 sizes, not with `aspect_ratio`) on generate and remix; `custom_model_uri` and
  `enable_copyright_detection` on generate — each endpoint gets exactly the parameters its documentation lists, sent
  under the API's field names (a list as repeated fields, the palette as one `application/json` part as the OpenAPI
  spec declares — a live probe on 2026-10-01 accepted it; the tests stub `fetch`). The three tools' input schemas
  are strict: a parameter an endpoint does not take (an exact `resolution` on edit) is refused by name, never
  silently dropped. Every file
  counts against the 50 MB request limit, checked with `stat` before any file is read. Tests pin the encoding, the
  per-endpoint fields and the refusals on all three endpoints.
- `ideogram_generate` with `model: "4.0"` posts to `/v1/ideogram-v4/generate` (`text_prompt`, `resolution`,
  `rendering_speed` except `FLASH`, `enable_copyright_detection`); a 3.0-only parameter given with 4.0 is refused by
  name, never dropped. A live probe on 2026-10-01 returned the documented shape (`response_type`, `created`,
  `data[].url/prompt/resolution/is_image_safe/seed`), which the response schema accepts.

### Changed

- README and `docs/API-REFERENCE.md` said "Ideogram 4.x uses the v2 API": the v1 API has the `ideogram-v4` endpoints too.
  The v2 API (Ideogram 4.5, Precise Edit, async jobs, usage) is still not called.

## [1.1.0] - 2026-10-01

An audit of the npm page (2026-10-01, every claim checked against the code and Ideogram's documentation).

### Changed

- `ideogram_edit` posts to `/v1/ideogram-v3/inpaint`: Ideogram marks `/v1/ideogram-v3/edit` "Legacy: use inpaint instead. This endpoint will be removed in a future release" — same image, mask and prompt fields, same response. A test with a fake `fetch` pins the endpoint.
- The per-image cap is 25 MB, Ideogram's documented maximum (it was 10 MB, called an API limit); the error names the real limit. A test pins both sides of the cap. `ideogram_edit` refuses image + mask at or over Ideogram's 50 MB request limit before uploading anything. A timed-out POST is no longer retried: the server may have accepted and billed it, and the multipart body (now up to 50 MB) would be sent again; connection failures and 429/5xx are retried as before, and a timed-out image download (an idempotent GET) still is. The pair is measured with `stat` before either file is read, with 64 KB reserved for the multipart overhead. The `NETWORK_ERROR` message names the failure (`TimeoutError`, `TypeError`).
- Every public claim says what the code does: Ideogram 3.0 through the v1 API (Ideogram 4.x and the v2 API are not used; the v1 API keeps working with no announced sunset); the describe and upscale endpoints named as such; `style_type` defaults to GENERAL on the API side (the descriptions said AUTO); `num_images` and `seed` in every tool except `describe`; `describe_model_version`, `negative_prompt`, upscale's `prompt` and `image_weight` documented; API keys at ideogram.ai/platform (the old manage-api link answers 403); Node.js ≥ 22 stated; the `ideogram-mcp` command and a `claude mcp add` one-liner; `npm test` and `npm run typecheck` in Development; the mask has no "10 % black" rule; SECURITY.md labels the review history (1.0.0, April 2026) and says a symlinked parent directory is followed and that any readable image path the model names may be uploaded; "zero-trust" and "flagship" dropped; the npm and MCP registry descriptions agree.
- `package.json` names the repository as `git+https://…` — the form npm publishes, so a publish prints no auto-correction.

## [1.0.4] - 2026-09-29

### Changed

- Runtime dependencies: `@modelcontextprotocol/sdk` 1.30.1 (was 1.30.0) and `zod` 4.6.5 (was 4.3.6).
- Releases are staged on npm instead of published directly: the release workflow runs `npm stage publish`
  (Trusted Publishing, provenance), and a version becomes public only when a maintainer approves it on
  npmjs.com with two-factor authentication; the workflow pins npm 11.20.0 for it (staged publishing needs 11.15.0+).
- The README opens with the Quantum Media Technologies wordmark and closes with a "Made by" line, both linking to www.qmediat.io/open-source; `package.json` `homepage` points there (`author` already carried the company line).
- Development: the project builds with TypeScript 7 (the native compiler). The published JavaScript is byte-identical
  to 1.0.3; the type declarations describe the same types (only the order of union members and properties and the
  quote style differ) and the source maps are regenerated. The TypeScript 7 npm package ships only `tsc` — no
  `tsserver` and no JavaScript API — so an editor set to use the workspace TypeScript version cannot load it from
  `node_modules`; use the editor's bundled one.
- The release workflow checks that `CHANGELOG.md` has a section for the version, asks npm once whether the version
  is already public and stops on any answer other than yes or no (a registry error used to read as "not public"),
  runs an npm pinned by version and by the sha512 of its tarball, and names a failed stage in the run summary.

## [1.0.3] - 2026-09-23

### Security
- Lockfile refresh closes all 45 open Dependabot advisories (9 high; all transitive dependencies of the MCP SDK):
  `hono` 4.13.8, `fast-uri` 3.1.8, `qs` 6.16.0, `body-parser` 2.3.0, `ip-address` 10.7.2. `npm audit` reports
  0 vulnerabilities. `@modelcontextprotocol/sdk` is pinned to 1.30.0, the version this release was tested with;
  `zod` stays at 4.3.6. The advisories sit in transitive dependencies under the SDK's caret ranges, so a project
  that already has this package in its lockfile keeps its old tree until it runs `npm update` (or `npm audit fix`);
  a fresh install gets the refreshed tree.
- CI now typechecks, runs the smoke test and refuses a build with a known high-severity advisory in the shipped
  dependency tree (`npm audit --omit=dev --audit-level=high`); the CI token is read-only.
- The publish workflow verifies that the release tag equals the `package.json` version before publishing and runs
  the same audit gate.
- Dependabot configuration (`.github/dependabot.yml`): weekly grouped npm updates and GitHub Actions updates.
- Dependabot security updates and GitHub private vulnerability reporting are enabled on the repository;
  `SECURITY.md` points to the private reporting form first.

### Fixed
- The server advertised `version: 1.0.2` in `serverInfo` regardless of the package version; it now reads the
  version from `package.json`, and the smoke test asserts the two agree.
- The publish workflow accepted a release tag without the `v` prefix; the contract is `v<version>`.
- Starting without `IDEOGRAM_API_KEY` printed a serialized Zod issue list naming `apiKey`; it now prints
  `Configuration error: IDEOGRAM_API_KEY is required` (found by the new smoke test).

### Added
- `npm test` (builds first): a stdio smoke test on Node's built-in runner — the built server completes the MCP
  handshake, advertises the package version and lists its seven tools; it refuses to start without
  `IDEOGRAM_API_KEY`. Every request has a 10 s deadline and is rejected if the server exits. No new dependency.

## [1.0.2] - 2026-04-05

### Added
- MCP Registry support: `server.json` and the `mcpName` field (`io.github.qmediat/ideogram-mcp`).
- GitHub Actions: CI build on Node 22 and 24; npm publish with provenance on a GitHub Release.

## [1.0.1] - 2026-04-03

### Fixed
- Package author name; provenance removed from the local publish configuration (it requires a CI build).

## [1.0.0] - 2026-04-02

### Added
- 7 MCP tools for the Ideogram V3 API:
  - `ideogram_generate` — text-to-image generation
  - `ideogram_describe` — image-to-text description
  - `ideogram_edit` — mask-based inpainting
  - `ideogram_remix` — image transformation with style control
  - `ideogram_reframe` — outpainting to new resolutions
  - `ideogram_replace_background` — foreground-preserving background replacement
  - `ideogram_upscale` — guided image upscaling
- Security hardening: SSRF protection, symlink rejection, Content-Type validation, path traversal prevention, Zod response validation
- Retry logic with exponential backoff for 429/500/502/503/504 + network errors
- Safety filter handling (url=null images reported, not crashed)
- Parallel image downloads with `Promise.allSettled` for partial failure resilience
- Native Node.js `fetch` + `FormData` — zero HTTP dependencies
