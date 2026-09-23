# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-09-23

### Security
- Lockfile refresh closes all 45 open Dependabot advisories (9 high; all transitive dependencies of the MCP SDK):
  `hono` 4.13.8, `fast-uri` 3.1.8, `qs` 6.16.0, `body-parser` 2.3.0, `ip-address` 10.7.2. `npm audit` reports
  0 vulnerabilities. Direct dependencies stay pinned exactly (`@modelcontextprotocol/sdk` 1.29.0, `zod` 4.3.6).
- CI now typechecks, runs the smoke test and refuses a build with a known high-severity advisory in the shipped
  dependency tree (`npm audit --omit=dev --audit-level=high`); the CI token is read-only.
- The publish workflow verifies that the release tag equals the `package.json` version before publishing and runs
  the same audit gate.
- Dependabot configuration (`.github/dependabot.yml`): weekly grouped npm updates and GitHub Actions updates.
- Dependabot security updates and GitHub private vulnerability reporting are enabled on the repository;
  `SECURITY.md` points to the private reporting form first.

### Fixed
- Starting without `IDEOGRAM_API_KEY` printed a serialized Zod issue list naming `apiKey`; it now prints
  `Configuration error: IDEOGRAM_API_KEY is required` (found by the new smoke test).

### Added
- `npm test`: a stdio smoke test on Node's built-in runner — the built server completes the MCP handshake and lists
  its seven tools; it refuses to start without `IDEOGRAM_API_KEY`. No new dependency.

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
