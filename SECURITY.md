# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately:

- **Preferred:** GitHub's [Report a vulnerability](https://github.com/qmediat/ideogram-mcp/security/advisories/new) form (Security tab → Advisories) — it reaches the maintainers privately and tracks the fix and the disclosure.
- **Email:** security@qmediat.io
- **Subject:** `[SECURITY] ideogram-mcp: <brief description>`

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

**Please do NOT open public GitHub issues for security vulnerabilities.**

## Security Model

`ideogram-mcp` is designed with a defensive, minimal-dependency approach. Every security decision is documented below. One trust boundary to know: the server trusts `api.ideogram.ai`'s success responses after schema parsing, and it uploads any readable local image path the model names (the input path is validated for extension, size and symlinks, not restricted to a directory).

### Supply Chain

| Measure | Implementation |
|---------|---------------|
| **2 runtime dependencies only** | `@modelcontextprotocol/sdk` + `zod` — no axios, no form-data |
| **Native fetch** | Node.js built-in `fetch`; multipart bodies encoded by the server itself — no HTTP library |
| **Pinned exact versions** | No `^` or `~` ranges in `package.json` |
| **No eval/exec** | Zero usage of `eval()`, `child_process`, `exec`, or `Function()` in the server (`src/`); the smoke test in `test/` spawns the built server to talk to it over stdio |
| **No telemetry** | No analytics, no phoning home, no tracking |
| **Audit gate** | CI and the publish workflow refuse a build with a known high-severity advisory in the shipped dependency tree (`npm audit --omit=dev --audit-level=high`); Dependabot security updates are enabled |
| **Provenance** | Staged from GitHub Actions with `npm stage publish --provenance` and public only after a maintainer approves the version with two-factor authentication; the npm page of every version links the workflow run that built it |

### Network Security

| Threat | Protection |
|--------|-----------|
| **SSRF via download URLs** | HTTPS required + hostname allowlist (`ideogram.ai` and its subdomains, the known CDN) |
| **SSRF via a URL input** (a file field given a URL: the model names the host, there is no allow-list) | HTTPS only; no credentials in the URL; no IP literal; no local or single-label host name; every address the host resolves to must be globally reachable (private, loopback, link-local, carrier NAT, the special-purpose and documentation blocks, multicast, reserved, and in IPv6 unique-local, link-local, site-local, multicast, documentation, discard and the embedded IPv4 forms — mapped, NAT64, 6to4, compatible — refused); the lookup and the fetch run under the call's budget; the connection is pinned to the very address the lookup answered (the name is never resolved a second time: a rebinding reaches nothing); a redirect refused; the body a type the field takes, under the field's limit and the request cap, never empty; local files are read before any fetch. Design note section 9b |
| **SSRF via redirects** | `redirect: "manual"` — all redirects blocked and reported |
| **API key exfiltration** | Key sent only to `api.ideogram.ai` (hardcoded base URL), never logged |
| **Request timeout** | One budget per tool call: 55 s (the MCP client's 60 s minus a margin), ended earlier by the caller's cancellation; every attempt (bounded by the budget's remainder; the 120 s attempt cap applies only to a caller whose budget leaves more than that — never inside a tool call), retry sleep, poll and download of the call is judged against what remains. A POST is sent again only when it never left the machine (DNS, a refused connect) or got a 429; a timeout, a reset or a 5xx after sending is reported, never repeated (one call never creates two billed jobs). A GET (a poll, a download) is retried on network failures, 429 and 5xx |
| **Content-Type validation** | Downloads must be an image type or `video/mp4` — HTML/JSON error pages rejected |
| **Download size limit** | Content-Length pre-check, then the body streamed to a partial file with a byte counter: stopped at 50 MB, the partial file removed |

### Local File Security

| Threat | Protection |
|--------|-----------|
| **Path traversal** | Extension allowlist for uploads (`.png`, `.jpg`, `.jpeg`, `.webp` — the types the specification names); the local file name is never sent (a file goes as `<field>.<ext>`) |
| **Symlink attacks** | `lstat()` on the image path before reading — a symlinked file is rejected; a symlinked parent directory is resolved |
| **File size DoS** | `stat()` check of every file before any is read, against its operation and field's own limit as Ideogram's specification states it (describe 10 MB, remix 50 MB, 25 MB × 5 for Ideogram 4.5's images, …; 50 MB where none is stated), the number of files per field and any whole-request cap |
| **Filename injection** | Output filenames are `ideogram-{timestamp}-{random}.{ext}` — no user input |
| **Output directory escape** | Saved files are named by the server (no input in the name) directly in the output directory |

### Data Validation

| Layer | Mechanism |
|-------|-----------|
| **Input validation** | Each model's request schema generated from Ideogram's specification, plus reviewed rules the specification states only in prose; a parameter the model does not take is refused by name |
| **Response validation** | The generated schema on every success response — a body it rejects is reported as a contract mismatch, never as a success; 402/429 bodies are typed (`GenerationErrorResponse`), other error bodies read for their message |
| **Error isolation** | `IdeogramApiError` class — raw stack traces never exposed to MCP clients |
| **Retry logic** | Exponential backoff with jitter (or `Retry-After`), on the conditions in the request-timeout row above |

### What This Server Does NOT Do

- Does not execute arbitrary code
- Does not access the filesystem outside of validated image paths
- Does not store or cache API keys on disk
- Does not make network requests to any host other than `api.ideogram.ai` and its CDN
- Does not collect, transmit, or log any user data

## Code Review History

Release 1.0.0 (April 2026) passed 4 rounds of parallel code review by GPT-5.3-Codex, Gemini 2.5 Pro, Grok-4 and GitHub Copilot; all CRITICAL and MAJOR findings were fixed and verified with tests. Later releases are reviewed through the same multi-model pipeline per pull request; the review record lives in each pull request.
