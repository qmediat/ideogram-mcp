# Ideogram MCP — Repository & Publishing Strategy

## Context

Flagowy open-source MCP server Quantum Media Technologies dla Ideogram V3 API. Budujemy rozpoznawalność firmy (www.qmediat.io) przez jakość i bezpieczeństwo kodu.

## Analiza rynku (stan na 2026-04-01)

| Konkurent | Stars | npm | Jakość | Zagrożenie |
|-----------|------:|-----|--------|------------|
| delorenj/ideogram-mcp-server | ~4 | `ideogram-mcp-server` v3.1.0 | axios+FastMCP, brak security | Niskie |
| flowluap/ideogram-mcp-server | 3 | — | 2 commity, porzucony | Zerowe |
| Sunwood-ai-labs/ideagram-mcp-server | 4 | `@sunwood-ai-labs/ideagram-mcp-server` | Literówka ("ideagram") | Niskie |
| PierrunoYT (2 repozytoria) | ~2 | — | Via fal-ai/Replicate proxy | Zerowe |

**Nasza przewaga:**
- Zero axios (native fetch) — security story
- Zod v4 response validation — jedyni na rynku
- SSRF/path traversal/retry/symlink protection — jedyni
- 6 rund code review × 4 reviewerów (GPT-5.3, Gemini, Grok-4, Copilot) = 49 fixów
- 7 tooli vs max 4-5 u konkurencji
- Natywne Ideogram V3 API (nie proxy)

## Status realizacji

### Krok 1: Repo na GitHub ✅ DONE

- Repo: `qmediat/ideogram-mcp` (**PUBLIC** od 2026-04-02)
- Topics: mcp, ideogram, image-generation, claude-code, ai, model-context-protocol, typescript
- PR #1-4 merged, 6 rund code review

### Krok 2: Phase 1-3 ✅ DONE

- 7 tooli: generate, describe, edit, remix, reframe, replace-bg, upscale
- Security: SSRF, symlink (lstat before realpath), Content-Type, retry, Zod validation
- README.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md
- Live test: 7/7 tooli z prawdziwym Ideogram API

### Krok 3: Publikacja ✅ DONE (2026-04-03 / 2026-04-05)

| Co | Status | Link |
|----|:------:|------|
| npm publish | ✅ v1.0.2 | https://www.npmjs.com/package/@qmediat.io/ideogram-mcp |
| GitHub Release | ✅ v1.0.0 | https://github.com/qmediat/ideogram-mcp/releases/tag/v1.0.0 |
| MCP Registry | ✅ v1.0.2 | `io.github.qmediat/ideogram-mcp` |
| Awesome MCP Servers | ✅ PR #4191 | https://github.com/punkpeye/awesome-mcp-servers/pull/4191 |
| GitHub Actions CI | ✅ | Node 22 + 24, passes |
| GitHub Actions publish | ✅ | Triggered on release, npm publish with `--provenance` |
| NPM_TOKEN secret | ✅ | Configured in repo secrets |

### Krok 4: SEO i discovery ⏳ TODO

- Submit do `smithery.ai` + `mcp.so` + `glama.ai`
- Pin repo w profilu org `qmediat` (needs .github repo with profile/README.md)
- Dodać link na qmediat.io → `/open-source` page (instrukcja: `~/Projects/QMT/Website/docs/OPEN-SOURCE-PAGE.md`)

## Nazewnictwo — finalna decyzja

| Element | Wartość |
|---------|--------|
| **npm package** | `@qmediat.io/ideogram-mcp` (scoped, org `qmediat.io`) |
| **GitHub repo** | `qmediat/ideogram-mcp` |
| **MCP Registry** | `io.github.qmediat/ideogram-mcp` |
| **CLI command** | `npx @qmediat.io/ideogram-mcp` |
| **npm org** | `qmediat.io` (nie `qmediat` — to user account) |

## Branding

- **LICENSE:** `Quantum Media Technologies sp. z o.o.` (pełna forma prawna)
- **README / CONTRIBUTING / package.json:** `Quantum Media Technologies` (brand, bez sp. z o.o.)
- **Link:** https://www.qmediat.io

## Infrastructure

- **CI/CD:** GitHub Actions — build on push/PR (Node 22+24), publish on release with provenance
- **npm token:** Granular access token, expires 2026-05-03
- **MCP publisher CLI:** `/tmp/mcp-publisher` (reinstall from GitHub releases after reboot)
- **Registry tokens:** `.mcpregistry_*` files (gitignored)
