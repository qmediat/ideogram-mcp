# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately:

- **Preferred:** GitHub's [Report a vulnerability](https://github.com/qmediat/ideogram-mcp/security/advisories/new) form (Security tab → Advisories) — it reaches the maintainers privately and tracks the fix and the disclosure.
- **Email:** security@qmediat.io
- **Subject:** `[SECURITY] ideogram-mcp: <brief description>`

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

**Please do NOT open public GitHub issues for security vulnerabilities.**

## Security Model

`ideogram-mcp` is designed with a zero-trust, minimal-dependency approach. Every security decision is documented below.

### Supply Chain

| Measure | Implementation |
|---------|---------------|
| **2 runtime dependencies only** | `@modelcontextprotocol/sdk` + `zod` — no axios, no form-data |
| **Native fetch** | Node.js built-in `fetch`, `FormData`, `Blob` — no HTTP library |
| **Pinned exact versions** | No `^` or `~` ranges in `package.json` |
| **No eval/exec** | Zero usage of `eval()`, `child_process`, `exec`, or `Function()` in the server (`src/`); the smoke test in `test/` spawns the built server to talk to it over stdio |
| **No telemetry** | No analytics, no phoning home, no tracking |
| **Audit gate** | CI and the publish workflow refuse a build with a known high-severity advisory in the shipped dependency tree (`npm audit --omit=dev --audit-level=high`); Dependabot security updates are enabled |
| **Provenance** | Staged from GitHub Actions with `npm stage publish --provenance` and public only after a maintainer approves the version with two-factor authentication; the npm page of every version links the workflow run that built it |

### Network Security

| Threat | Protection |
|--------|-----------|
| **SSRF via download URLs** | HTTPS required + hostname allowlist (`ideogram.ai`, `api.ideogram.ai`, known CDN) |
| **SSRF via redirects** | `redirect: "manual"` — all redirects blocked and reported |
| **API key exfiltration** | Key sent only to `api.ideogram.ai` (hardcoded base URL), never logged |
| **Request timeout** | `AbortSignal.timeout(120s)` on every outbound request |
| **Content-Type validation** | Downloads must have `image/*` Content-Type — HTML/JSON error pages rejected |
| **Download size limit** | Content-Length pre-check + post-download buffer size cap (50 MB) |

### Local File Security

| Threat | Protection |
|--------|-----------|
| **Path traversal** | Extension allowlist (`.png`, `.jpg`, `.jpeg`, `.webp` only) |
| **Symlink attacks** | `lstat()` on original path before reading — rejects user-created symlinks |
| **File size DoS** | `stat()` check before read — 10 MB limit (Ideogram API limit) |
| **Filename injection** | Output filenames are `ideogram-{timestamp}-{random}.{ext}` — no user input |
| **Output directory escape** | `path.relative()` containment check on all saved files |

### Data Validation

| Layer | Mechanism |
|-------|-----------|
| **Input validation** | Zod schemas on all tool parameters (type, range, enum) |
| **Response validation** | Zod schemas on API responses — no blind `as` type casts |
| **Error isolation** | `IdeogramApiError` class — raw stack traces never exposed to MCP clients |
| **Retry logic** | Exponential backoff with jitter for 429/500/502/503/504 + network errors |

### What This Server Does NOT Do

- Does not execute arbitrary code
- Does not access the filesystem outside of validated image paths
- Does not store or cache API keys on disk
- Does not make network requests to any host other than `api.ideogram.ai` and its CDN
- Does not collect, transmit, or log any user data

## Code Review History

This codebase has passed **4 rounds of parallel code review** by:
- GPT-5.3-Codex (OpenAI)
- Gemini 2.5 Pro (Google)
- Grok-4 (xAI)
- GitHub Copilot

All CRITICAL and MAJOR findings were fixed and verified with tests.
