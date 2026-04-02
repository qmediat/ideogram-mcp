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

- Repo: `qmediat/ideogram-mcp` (PRIVATE)
- Topics: mcp, ideogram, image-generation, claude-code, ai, model-context-protocol, typescript
- PR #1 (Phase 1) — merged
- PR #2 (Phase 2) — merged
- 4 rundy code review × 4 reviewerów = 16 przeglądów

### Krok 2: Phase 1 + 2 ✅ DONE

- 7 tooli: generate, describe, edit, remix, reframe, replace-bg, upscale
- image-input.ts (unified loader)
- LICENSE (MIT)
- Security: SSRF, symlink, Content-Type, retry, Zod validation, path traversal

### Krok 3: Przygotowanie do publikacji ⏳ TODO

**package.json** — już zaktualizowany z branding i metadata.

**README.md — kluczowe sekcje (marketing):**
1. Logo/banner + jednozdaniowy pitch
2. "Why this server?" — tabela porównawcza vs konkurencja (security, deps, tools)
3. Quick start (3 linie: npx/install/configure)
4. All 7 tools z opisem + przykładami
5. Security design section (selling point!)
6. Built by QMT badge + link do www.qmediat.io

**Konfiguracja w `~/.claude.json`:**

Najprościej przez `npx` (nie wymaga instalacji):
```json
{
  "ideogram": {
    "command": "npx",
    "args": ["-y", "ideogram-mcp"],
    "env": {
      "IDEOGRAM_API_KEY": "${IDEOGRAM_API_KEY}",
      "IDEOGRAM_OUTPUT_DIR": "~/Pictures/ideogram"
    }
  }
}
```

`IDEOGRAM_OUTPUT_DIR` — dowolny folder, gdzie chcesz zapisywać obrazy. Domyślnie `/tmp/ideogram-output`. Przykłady:
- `~/Pictures/ideogram` — folder w home
- `./output/images` — relatywny do CWD
- `/tmp/ideogram-output` — tymczasowy (domyślny)

**End-to-end test z prawdziwym API** — wymaga IDEOGRAM_API_KEY.

### Krok 4: Publikacja (dzień release) ⏳ TODO

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

1. `gh repo view qmediat/ideogram-mcp` — repo istnieje ✅
2. Po Phase 3: `npm publish --dry-run` — package gotowy
3. Po publikacji: `npx ideogram-mcp` — serwer startuje
4. `npm search ideogram mcp` — nasza paczka w wynikach
