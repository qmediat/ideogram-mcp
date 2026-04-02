# Ideogram MCP — Repository & Publishing Strategy

## Context

Mamy działający MCP server dla Ideogram V3 API (Phase 1+2 done, 7 tooli, 4 rundy code review przeszedł). Pytanie: jak i kiedy upublicznić, żeby stać się referencyjną implementacją i budować rozpoznawalność qmediat.

## Analiza rynku (stan na 2026-04-01)

| Konkurent | Stars | npm | Jakość | Zagrożenie |
|-----------|------:|-----|--------|------------|
| delorenj/ideogram-mcp-server | ~4 | `ideogram-mcp-server` v3.1.0 | axios+FastMCP, brak security | Niskie — przestarzały stack |
| flowluap/ideogram-mcp-server | 3 | — | 2 commity, porzucony | Zerowe |
| Sunwood-ai-labs/ideagram-mcp-server | 4 | `@sunwood-ai-labs/ideagram-mcp-server` | Literówka w nazwie ("ideagram") | Niskie |
| PierrunoYT (2 repozytoria) | ~2 | — | Via fal-ai/Replicate, nie natywne API | Zerowe |

**Nasza przewaga:**
- Zero axios (native fetch) — security story
- Zod v4 response validation — jedyni na rynku
- SSRF/path traversal/retry protection — jedyni
- 4-rundowe code review przez 3 modele AI + Copilot — quality story
- 7 tooli vs max 4-5 u konkurencji
- Natywne Ideogram V3 API (nie przez proxy jak fal/Replicate)

## Strategia: Private → Public po Phase 3

**Rekomendacja: Prywatne repo TERAZ, publiczne po zakończeniu Phase 3 (README + live test).**

Dlaczego:
1. **Pierwsze wrażenie = jedyne wrażenie** — README i docs muszą być gotowe
2. **npm `ideogram-mcp` jest WOLNE** — możemy zarezerwować najlepszą nazwę
3. **Konkurencja jest słaba** — nie ma presji czasowej

## Status realizacji

### Krok 1: Repo na GitHub ✅ DONE

- Repo: `qmediat/ideogram-mcp` (**PUBLIC** od 2026-04-02)
- Topics: mcp, ideogram, image-generation, claude-code, ai, model-context-protocol, typescript
- PR #1 (Phase 1) — merged
- PR #2 (Phase 2) — merged
- PR #3 (Release v1.0) — merged
- PR #4 (Final polish) — merged
- 6 rund code review × 4 reviewerów = 24 przeglądy, 49 issues naprawionych

### Krok 2: Phase 1 + 2 ✅ DONE

- 7 tooli: generate, describe, edit, remix, reframe, replace-bg, upscale
- image-input.ts (unified loader)
- LICENSE (MIT)
- Security: SSRF, symlink, Content-Type, retry, Zod validation, path traversal

### Krok 3: Przygotowanie do publikacji ✅ DONE

- README.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md — all written
- package.json: v1.0.0, files field, prepack script, Node >=22
- npm pack: 23.1 KB, 65 plików, czyste (brak src/docs/internal/.env)
- Konfiguracja w ~/.claude.json jako serwer #20
- Live test: wszystkie 7 tooli verified z prawdziwym Ideogram API

### Krok 4: Publikacja ⏳ BLOCKED — npm 2FA

**Kolejność:**
1. `gh repo edit qmediat/ideogram-mcp --visibility public`
2. `npm publish --access public` (nazwa: `ideogram-mcp`)
3. Submit do MCP Registry: `registry.modelcontextprotocol.io`
4. Submit do Awesome MCP Servers: PR do `punkpeye/awesome-mcp-servers`
5. GitHub topics: ✅ już dodane
6. GitHub Release v1.0.0 z changelog

### Krok 5: SEO i discovery (post-launch) ⏳ TODO

- Dodać do `smithery.ai` + `mcp.so` + `glama.ai`
- Pin repo w profilu org `qmediat`
- Dodać link w qmediat.io (portfolio/open-source)
- Rozważyć scoped alias: `@qmediat/ideogram-mcp` → publikacja obu nazw

## Nazewnictwo — dlaczego `ideogram-mcp`

| Wariant | Dostępne npm? | SEO | Ocena |
|---------|:---:|-----|-------|
| `ideogram-mcp` | ✅ WOLNE | Najlepsze — "ideogram mcp" = top result | **WYBRANE** |
| `@qmediat/ideogram-mcp` | ✅ | Dobre, ale scoped = mniej widoczne w search | Alias/backup |
| `ideogram-mcp-server` | ❌ zajęte | — | — |
| `mcp-ideogram` | ✅ | Gorsze — szukający wpisują "ideogram" pierwszy | Odrzucone |

## Branding qmediat

**W README.md:**
```
Built with ❤️ by [Quantum Media Technologies](https://www.qmediat.io)
```

**W package.json:**
```
"author": "Quantum Media Technologies <dev@qmediat.io> (https://www.qmediat.io)"
```

**GitHub org profile:**
- Upewnić się, że qmediat org ma logo, opis, link do qmediat.io
- Pinned repos: ideogram-mcp (po publikacji)

## Weryfikacja

1. ✅ `gh repo view qmediat/ideogram-mcp` — repo istnieje, PUBLIC
2. ✅ `npm pack --dry-run` — 23.1 KB, 65 plików, czyste
3. ⏳ `npm publish --access public` — blocked na 2FA/granular token
4. ⏳ `npx ideogram-mcp` — po npm publish
5. ⏳ `npm search ideogram mcp` — po npm publish

## Blokada npm publish (2026-04-02)

npm wymaga 2FA lub granular access token z bypass 2FA.

**Rozwiązanie (do następnej sesji):**
1. https://www.npmjs.com/settings/tokens/create
2. Typ: "Granular Access Token"
3. Permissions: Read + Write
4. Packages: ideogram-mcp
5. Potem: `npm config set //registry.npmjs.org/:_authToken=TOKEN`
6. Potem: `npm publish --access public`

**Po npm publish:**
1. `gh release create v1.0.0 --generate-notes`
2. Submit do MCP Registry (`registry.modelcontextprotocol.io`)
3. PR do `punkpeye/awesome-mcp-servers`
4. Submit do smithery.ai + mcp.so + glama.ai
5. Pin repo w profilu org `qmediat`
