# DESIGN — `@qmediat.io/ideogram-mcp` 2.x: the whole Ideogram platform, one API, delivered by family

Status: proposed, revised after the consult (step 0 not started) · Date: 2026-10-07 · Owner: qmt · Decision: operator GO on the RAR of 2026-10-07
("D — a core generated from the OpenAPI snapshot, curated tools per family, a raw validated call from day one; one
release per finished family") · Consult: architecture pass before the first line of code (section 12).

## 1. Why

Ideogram is a platform, not one model. Its v2 API (`https://api.ideogram.ai/v2/`, the default documentation index since
2026) sells, through ONE `Api-Key` and ONE prepaid credit balance, Ideogram 4.5 / 4.0 / 3.0 / 2a / 2.0 and other vendors'
models (GPT Image 2.5 Flare and Sunburst, GPT Image 2, Nano Banana Pro and 2, Z-Image, P-Image, Topaz upscalers, Kling v3,
MiniMax H3, Seedance 2.5 and 2.0), plus commercial tools (ad localizer / resizer / variations, colorways, ghost mannequin,
material swap, model pose variants, sketch to render), signed webhooks, `dry_run` price quotes and an account usage API.
Version 1.2.1 of this server exposes 7 tools on the v1 API: Ideogram 3.0 everywhere, 4.0 only for `generate`, no quote, no
cost, no async, no video, no account. The operator's reading (2026-10-07): every model the platform sells through its key
is native for our users; the goal is full coverage, shipped feature by feature — this is one of the company's flagship
open-source packages, so the standard is Invariant #14 (typed boundaries, small units, tests, lint) from the first line.

### The facts the design rests on (read 2026-10-07)

- **The specification exists and is complete**: `https://api.ideogram.ai/openapi.json` (the two URLs the docs index names
  are 404). OpenAPI 3.0.2, 1 109 860 bytes, **200 operations, 486 schemas**, security `ApiKeyAuth` (`Api-Key` header) and
  `BearerAuth` (JWT, the web app). Snapshot of 2026-10-07: sha256 `919a744eb885e9fb…` (kept at
  `~/.claude/state/ideogram-spec/openapi-2026-10-07.json` until this PR commits it as `spec/openapi.json`).
- **The documented surface is 66 of the 200** (`https://developer.ideogram.ai/v2/llms.txt`): every documented path is in
  the spec. The other 134: 20 undocumented v2 operations (reframe `auto`/`bria-expand`/`gpt-image-2-5-flare`/
  `nano-banana-pro`, tools `living-image`, `product-360-video`, `packshots`, `vectorizer`, `text-layerizer`, `model-swap`,
  `swap-product`, `sole-swap`, `skechers-style-editor`, `swan-s-logo-design`/`-install`, workflows `lookbook`,
  `precise-masked-edit`, `virtual-try-on`, video edit `seedance-2`, `GET /v2/assets/reference-usage`), 73 v1 and
  unversioned operations — by the shipped rule 41 `v1_only` (capabilities v2 lacks: custom-model training `/v1/ideogram-v{3,4}/train-model[-advanced]`, `/v1/ideogram-v4/
  magic-prompt`, `/v1/layerize-logos`, `/v1/snap-mask`, `/v1/provenance/verify`, `/v1/ideogram-v45/generate`, Flux 2 Klein,
  Ernie, 4.0 cfg-distilled / fp8 / stable, generate-design, graphic, try-on, image-to-image, the training datasets and
  models) and 32 `legacy` (`/generate`, `/edit`, `/describe`, `/v1/ideogram-v3/*`…: paths whose capability v2 covers;
  the first reading by URL age, 58 + 15, is superseded by the rule in `src/spec/classify.ts`) —, 9 internal (`/manage/*` web-app and organization administration, `/mini-apps/*`,
  `/internal-testing`, `/internal/batch`) and 32 Bearer-only (organization, billing portal, subscriptions).
- **Every v2 generation operation has the same envelope**: `multipart/form-data` or `application/json` body; `dry_run`
  query parameter ("validated and priced but not run: nothing is generated, stored, or billed" — the response is a
  `PriceQuote {object, billing_identifier, quantity, usd_micros, credit_millis, qualifier: exact|estimate,
  upper_bound_usd_micros}`); `async` + `webhook_url` + `private` + `target_collection_id`; `images` as files or
  `image_asset_identifiers` (`AssetIdentifier {asset_type: ASSET|CANVAS_ASSET|LAYERED_ASSET|RESPONSE|UPLOAD, asset_id,
  collection_id}`); 200 → `<Op>Response {generation_id, seed, data?: GeneratedImageObject[] (url nullable when unsafe)}`;
  402 and 429 → `GenerationErrorResponse {error, reject_reason: insufficient_funds|subscription_required|daily_limit|
  priority_credit_required|inflight_limit|feature_limit, max_inflight_requests, task_completion_speed}`; async results by
  `GET /v2/generations/{id}` → `GenerationResponse {generation_id, status: pending|completed|failed, created,
  response_type: url, usage_cost_usd_micros, failure_reason, data}`. Video operations are async-only (the 200 is an
  acknowledgement; links expire). Image `quality` is `very_low|low|medium|high` (4.5) — v1's `rendering_speed`
  (`FLASH|TURBO|DEFAULT|QUALITY`) does not exist in v2.
- **Prices are not in the spec or the docs** (the official table loads dynamically); `dry_run` is the price source, per
  request, exact or an estimate with an upper bound. Third-party captures of 2026-08-25: 4.0 Turbo/Default/Quality
  0.03/0.06/0.10 USD per image, remove-background 0.01, upscale 0.06 — labelled as such, never printed as ours.
- `x-tool-description` (44 operations) and `x-fern-examples` (17) are provider-written texts and examples the generated
  tools and the contract tests reuse.

## 2. Data model (types, not prose)

```
OperationClass = "documented" | "spec_only" | "v1_only" | "legacy" | "internal" | "bearer_only"
                 documented: in the v2 docs index (66) — curated tools and the raw call
                 spec_only: a public /v2 path the index does not list (20) — the raw call, flagged `spec_only: true`
                 v1_only:   a v1 capability v2 lacks (training, magic-prompt, snap-mask, provenance, layerize-logos,
                            ideogram-v45, Flux 2 Klein, Ernie, cfg-distilled/fp8/stable, generate-design, graphic, try-on,
                            image-to-image, p-image tiers) — step 5, raw call first, curated later
                 legacy:    unversioned paths whose capability v2 covers (/generate, /edit, /remix, /reframe, /upscale,
                            /describe, /magic-prompt) — never exposed; /datasets and /models are API-key reachable and
                            feed training, so they are v1_only, not legacy: class by capability and effective auth,
                            never by URL age alone (consult F14)
                 internal:  /manage/*, /mini-apps/*, /internal* — never exposed
                 bearer_only: security [BearerAuth] alone — never exposed (not reachable with an API key)
Operation      = { id: OperationId (the spec's operationId), method, path, class: OperationClass, family: Family,
                   model: ModelId | null, body: "multipart" | "json" | "none", request: ZodSchema, response: ZodSchema,
                   errors: {402, 429}, dryRun: boolean, async: "optional" | "only" | "none", docsUrl: URL | null,
                   toolText: string | null (x-tool-description) }  — generated from the snapshot, never written by hand
Family         = "generate" | "precise_edit" | "inpaint" | "remix" | "reframe" | "upscale" | "replace_background" |
                 "remove_background" | "remove_object" | "describe" | "layerize" | "video_text" | "video_image" |
                 "video_reference" | "video_edit" | "tool" | "workflow" | "generation" | "account" | "training"
ModelId        = the last path segment of a v2 operation ("ideogram-4-5", "gpt-image-2-5-flare", "topaz-wonder-3-5", "auto")
Registry       = { [family]: { models: ModelId[] (the spec's order), newest: ModelId (a hand-kept table: Ideogram's newest
                   per family — generate ideogram-4-5, precise_edit ideogram-4-5, remix ideogram-4, describe ideogram-4,
                   inpaint/reframe/replace_background/layerize ideogram-3 — validated in CI: every model id of the
                   spec's /v2 paths is in the registry and every registry id is in the spec, or the build fails with the
                   two lists) } }
Request        = { path: {…}, query: {…}, headers: {…}, body: {media: "multipart" | "json", fields, files} } — the four
                 locations kept apart with the spec's serialization rules (repeated query arrays, JSON-encoded multipart
                 fields, `generation_id` in the path); never one flat object (consult F6)
Lifecycle      = Accepted {generation_id} is what a tool returns by default the moment the API accepts the job; an
                 optional bounded wait (`wait_s`, default 45, max 50: the MCP SDK's client timeout is 60 s — consult F3,
                 Gemini F1) polls GET /v2/generations/{id} (2 s → ×1.5 → 30 s cap, 60 s for video — Gemini F6) and returns
                 Completed {payload} | Failed {failure_reason} | Pending {generation_id, how to resume}; `ideogram_generation`
                 resumes any id across restarts (operation ids are kept in the result so the client never resubmits paid
                 work). Retries: a POST is retried ONLY when the connection failed before the request was sent or the API
                 rejected it before acceptance (4xx, 429 with Retry-After); never after a possible acceptance (consult F4)
Outcome        = Completed {payload: Payload, usage_cost_usd_micros | null, credits | null} | Pending {generation_id} |
                 Failed {failure_reason} | ContractMismatch {status, generation_id?, issues: ZodIssue[] (bounded, redacted),
                 body_excerpt} — a discriminated union; a paid generation whose body the schema rejects is never passed
                 off as a success (consult F10)
Payload        = Images {items: Saved[] (path | url, resolution, seed?, prompt?, is_image_safe), unsafe: number, safety
                 notes when the response carries them} | Description {description_id, text | json_prompt} |
                 Video {items: Saved[] (mp4)} | Svg {…} | Layered {…} — by the operation's response kind (consult F7)
Quote          = PriceQuote (as the spec) + { usd: Decimal string with 6 places, credits: Decimal, operation, model }
Usage          = GetAccountUsageResponse buckets → { start, end, line_items: {product, endpoint, cost_total, currency,
                   units {unit, quantity, unit_price}, api_key (redacted), source} } — the shape ai-cost will read
Error          = IdeogramApiError {status, code, message, reject_reason?, retry_after_s?, max_inflight?} (402 and 429
                 typed from GenerationErrorResponse; 4xx validation errors never reach the API: zod refuses first)
ToolSpec       = { name: "ideogram_<family>", input: a discriminated union on `model` (JSON Schema `oneOf` per model:
                   exact fields per model, no hallucinated combinations — Gemini F4; the advertised schema's bytes are
                   measured in tests/budget.test.mjs), semantic: Constraint[] (reviewed rules the spec states only in
                   prose: mask ↔ first image, size vs source, file caps per operation — consult F8), handler }
Constraint     = { operation, rule: (req) => Issue | null, text } — reviewed, versioned, tested with negative cases;
                 a 400 the API still returns is formatted as a tool error with the API's message (Gemini F3)
Support        = per release: { operation: OperationId, status: "curated" | "raw" | "planned" } — runtime support is a
                 separate table from OperationClass (consult F9): `ideogram_api` serves only operations whose status is
                 curated or raw in the SHIPPED release; a `spec_only` operation needs `allow_undocumented: true`
FileLimits     = per operation from the spec (describe 10 MB, precise edit 50 MB, generate 25 MB × 5…) — never one cap
                 (consult F12); downloads streamed to disk with a byte counter, never buffered whole (Gemini F7)
RawCall        = ideogram_api { operation: OperationId, params: object (free-form in the ADVERTISED schema — a union of
                   200 request schemas would not fit a client's context, Gemini F2 — validated at call time by the
                   operation's generated schema), files: {field: path}[], dry_run?, allow_undocumented? } + a discovery
                   tool ideogram_operations {family?, operation?} → the operation's fields, kinds, limits and docs URL
QuoteSupport   = the allow-list of operations that declare the `dry_run` parameter (describe and some workflows do not:
                 a dry_run sent to them could run and bill — consult F1); the quote tool refuses the rest locally; the
                 dry_run response is PriceQuote by a reviewed overlay (no operation response references it in the spec)
```

## 3. Module map

```
spec/openapi.json                 the committed snapshot (1.1 MB) + spec/SNAPSHOT (date, sha256, source URL)
scripts/spec-pull.mjs             fetch → normalize (sorted keys) → diff of the EXPOSED operations against the snapshot →
                                  exit 1 with the list (CI weekly job opens an issue; never fails the build on its own)
scripts/spec-generate.mjs         @hey-api/openapi-ts (modified 2026-09-30; zod v4 default) with parser.filters.operations
                                  .include = the documented + spec_only + v1_only paths, exclude = legacy|internal|bearer;
                                  plugins: @hey-api/typescript + zod (NO client plugin: the hardened fetch client stays)
src/generated/{types,zod}.ts      output, committed (a reviewer reads the diff; the build does not need the network)
src/spec/operations.ts            Operation[] built from the snapshot at build time (class, family, model, flags, docsUrl)
                                  — typed, frozen; src/spec/classify.ts holds the ONE classification rule;
                                  src/spec/overlay.ts the reviewed overlay (dry_run → PriceQuote, quote allow-list,
                                  per-operation file limits, semantic constraints); src/spec/support.ts the per-release
                                  support table; provider x-tool-description is SOURCE material for our reviewed tool
                                  texts, never shipped verbatim (it carries host-specific instructions — consult F11)
src/registry.ts                   Registry + the newest table + the CI check (tests/registry.test.mjs)
src/client.ts                     as today (retries, Retry-After, allowed download hosts, 50 MB cap) + json bodies,
                                  dry_run query, typed 402/429, `Api-Key` only (never Bearer)
src/budget.ts                     Clock + CallBudget (deadline, cancellation signal) — one per tool call, built in the handler
src/lifecycle.ts                  sync | async | poll | timeout → Result (one function per step, ≤ 40 lines)
src/cost.ts                       quote (dry_run) → Quote; usage → Usage; micros → Decimal strings (never floats)
src/tools/<family>.ts             one curated tool per family: generate, precise_edit, inpaint, remix, reframe,
                                  replace_background, remove_background, remove_object, describe, layerize, upscale
                                  (step 0 migrates the 7 that exist; step 1 adds the rest of the family set)
src/tools/raw.ts                  ideogram_api (step 0) · src/tools/generation.ts (poll a generation_id) · quote.ts
src/tools/video.ts (step 3) · src/tools/commercial/*.ts (step 4) · src/tools/training.ts (step 5, v1)
src/server.ts                     registers the tools of the shipped steps; tool count ≤ 15 through step 2
docs/API-REFERENCE.md             generated from Operation[] (family × model × fields) — never hand-edited again
```

Tool naming keeps the 1.x names (`ideogram_generate`, `ideogram_edit` → kept as the alias of `ideogram_inpaint` for one
major version with a deprecation note, `ideogram_remix`, `ideogram_reframe`, `ideogram_replace_background`,
`ideogram_upscale`, `ideogram_describe`), adds `model` to each, and adds `ideogram_precise_edit`, `ideogram_remove_background`,
`ideogram_remove_object`, `ideogram_layerize`, `ideogram_quote`, `ideogram_generation`, `ideogram_api`, later
`ideogram_usage`, `ideogram_video`, the commercial tools.

## 4. Error policy (what fails loud, what is tolerated and counted)

| case | behaviour |
|---|---|
| a tool input the chosen model does not take | refused before the call: "`<field>` is not a parameter of `<model>`; the models that take it: …" |
| `dry_run` quote `qualifier: estimate` | the quote carries `upper_bound_usd` and says "estimate" — never printed as exact |
| 402 `reject_reason` | the error names the reason and the remedy (add credits / subscription / daily limit / inflight) — never retried |
| 429 | retried with `Retry-After` (today's backoff), `max_inflight_requests` surfaced; after the retries: the error |
| an unsafe image (`url: null`) | counted in `Result.unsafe`, the others saved; the result says how many |
| async timeout | the `generation_id` is returned with `status: pending`; `ideogram_generation` resumes it |
| a download host outside the allow-list | refused and said (today's rule; the list gains the hosts the spec's examples show) |
| a `spec_only` operation through `ideogram_api` | runs, the result carries `spec_only: true` and the docs-index note |
| `legacy` / `internal` / `bearer_only` through `ideogram_api` | refused by class, the message says why |
| a response the generated zod schema rejects | `ContractMismatch` outcome (status, the generation_id when present, bounded redacted issues) — never a success, never silently reshaped; counted |
| a 400 from the API after zod accepted the input | a tool error with the API's message and the field it names (the spec states some rules only in prose) |
| a retry after a possible acceptance | never (one tool call must not create two billed jobs); the Accepted id is returned instead |
| the registry disagrees with the snapshot | the build fails (CI) with both lists |
| the live spec differs from the snapshot | the weekly job opens/updates ONE issue with the diff of exposed operations; the build is untouched |

## 5. Costs and bounds

| bound | value | why |
|---|---|---|
| tools/list after step 2 | 16 tools, advertised schema ≤ 64 KB serialized, measured in `tests/budget.test.mjs` | the count alone says nothing (consult F15): the bytes and the routing accuracy are what a client pays |
| generated code | ≤ 600 KB committed (`src/generated/`) | 486 schemas × zod; filtered to the exposed operations |
| one budget per tool call | `CallBudget` (src/budget.ts): deadline = start + 55 s (the caller's 60 s minus a margin) and the caller's cancellation signal (the SDK's `extra.signal`); every HTTP attempt, retry sleep (Retry-After included), poll and download of the call is judged against what remains; a POST is resent only when the time left covers an attempt as long as the one just rejected; a download the budget cuts is "Not saved" beside the id; one attempt is at most 120 s | pieces of a call bounded apart (a sleep budget, a per-request timeout) added up past the caller — step back after #36 r2 (Codex: a 429 answered at 40 s was resent at 70 s) |
| wait inside a tool call | default 45 s, max 50 s, then Pending {generation_id} | the MCP SDK's client timeout is 60 s (consult F3) |
| poll | 2 s → ×1.5 → 30 s cap (60 s video); `ideogram_generation` resumes without limit | 180 polls per video would court 429s (Gemini F6) |
| upload | per operation from the spec (describe 10 MB, precise edit 50 MB, generate 25 MB × 5…), enforced before the call | one cap was wrong for both ends (consult F12) |
| download | streamed to disk with a byte counter, 50 MB cap, allow-listed hosts | today's downloader buffers the whole body before the cap (consult F12) |
| live tests | `dry_run` only in CI: 0 USD; real generations by hand, each named with its quote | cost is counted (§0 of the operator's rules) |

## 6. Test plan

- `tests/registry.test.mjs` — every /v2 model id in the spec is in the registry and the reverse; `newest` ids exist.
- `tests/classify.test.mjs` — the 200 operations fall into the six classes with the counts above (66/20/58/15/9/32);
  a documented path is never `spec_only`; a Bearer-only path is never exposed.
- `tests/contract.test.mjs` — for every exposed operation: the generated zod schema parses the spec's `x-fern-examples`
  request/response (17 operations) and a synthetic minimal request; `ideogram_api` refuses `legacy`/`internal`.
- `tests/tools.test.mjs` — each curated tool: input → form/json body (field placement, file fields, the model-field
  refusal), result shaping (unsafe count, cost unknown vs known), the lifecycle against a fake server (sync, async →
  completed, async → failed, async → timeout → pending id), 402/429 typing.
- `tests/live-dry-run.test.mjs` — behind `IDEOGRAM_API_KEY`: every curated operation with `dry_run=true` (0 USD) must
  return a `PriceQuote`; the quotes are written to `docs/PRICES-<date>.md` as the price evidence (labelled "quotes of
  <date>, your account's prices may differ").
- `tests/wire.test.mjs` — independently authored wire fixtures (the exact bytes a known-good request produces:
  multipart boundaries, JSON-encoded multipart fields, repeated query arrays, the path id) and negative semantic cases
  (a mask without an image, a size with a source, a 60 MB describe upload); mutation-checked (consult F13).
- `tests/budget.test.mjs` — the serialized tools/list of the shipped release ≤ the budget of section 5.
- The dry_run suite needs an account with a non-zero balance (Gemini F10: a quote may check the balance) — said in the
  test's skip message.
- Each new check must fail on the previous version (Step 1b's rule), by behaviour, not by absence: the lifecycle tests
  fail on the v1 client because it waits instead of returning an id; the wire tests fail because v1 sends
  `rendering_speed` where v2 takes `quality`.

## 7. Versioning and migration (2.0.0)

Compatibility is defined per operation and model, not globally (consult F2): in v2 `ideogram-3` and `ideogram-4`
still take `rendering_speed` (lowercase `turbo|default|quality`), only `ideogram-4-5` takes `quality`
(`very_low|low|medium|high`); `FLASH` exists nowhere in v2. A 1.x call maps through a compatibility adapter: the
uppercase value is lowercased for the 3.x/4.0 models, mapped to `quality` for 4.5, refused with the table otherwise; the
result says what was mapped. `model` values are the spec's ids (`"3.0"` / `"4.0"` accepted as aliases for one major);
`ideogram_edit` is an alias of `ideogram_inpaint`; the 1.x names and aliases stay through 2.x and leave in 3.x (consult
Q5). **The default `generate` model stays `ideogram-3`** (cost-neutral for a 1.x call that omits `model` — Gemini F5,
consult Q5); the README leads with `ideogram-4-5` and `ideogram_quote` tells the price before a call. Switching the
default is the operator's call, recorded in the CHANGELOG when taken.

## 8. Steps (one release per finished family — Invariant #15)

| step | release | content |
|---|---|---|
| 0 | 2.0.0 | this note + ADR-0001 (OpenAPI as the source of truth); spec snapshot + generator + registry + classes; client on v2 (json, dry_run, typed 402/429); lifecycle; cost (quote); the 7 existing tools on v2 with `model`; `ideogram_quote`, `ideogram_generation`, `ideogram_api`; API-REFERENCE generated; README truth |
| 1 | 2.1.0 | `ideogram_precise_edit` (4.5), `ideogram_remove_background`, `ideogram_remove_object`, `ideogram_layerize`, transparent generation, custom-model and character variants — every image family of the index |
| 2 | 2.2.0 | `ideogram_usage` (the shape ai-cost reads), invoices, api-keys; webhooks documented (verification of the signature as a helper) |
| 3 | 2.3.0 | `ideogram_video` (text/image/reference-to-video, model enum; async only; mp4 download) + video edit |
| 4 | 2.4.0 | the 8 commercial tools (each its own inputs) + the documented reframe/upscale `auto` |
| 5 | 2.5.0 | v1-only: custom-model training (datasets, train, models), magic-prompt-v4, snap-mask, layerize-logos, provenance/verify; the v1 model variants through `ideogram_api` |

## 9. Out of scope

Bearer-only and internal operations (the web app's); remote HTTP transport and OAuth (Ideogram's own MCP owns that
niche); a local price table (the quote is the price); exposing `legacy` paths.

## 10. Open questions — answered by the consult (section 12)

1. One tool per family with a `model` enum and a union of fields, or one tool per (family, model)? The first keeps ~15
   tools; the second gives exact schemas per model but 60+ tools.
2. Commit the generated code (`src/generated/`) or generate at build time? (Reviewers read diffs; the build must not need
   the network — the note says commit.)
3. `ideogram_api` from day one: does a raw validated call undermine the curated tools' UX for LLM clients, or is it the
   honest "everything the platform offers" answer until a family is curated?
4. The snapshot drift job: weekly issue vs failing CI on provider changes.
5. Keeping the 1.x tool names with aliases for one major, or a clean break at 2.0.0?

## 11. Validation before the PR

Measured on the PR's head (branch `qmt/v2-foundation`, 2026-10-07):

| what | measured | budget / rule |
|---|---|---|
| operations in the snapshot | 200 | — |
| classes (the one rule, `src/spec/classify.ts`) | documented 66 · spec_only 20 · v1_only 41 · legacy 32 · internal 9 · bearer_only 32 | `test/classify.test.mjs` pins the counts |
| generated code (`src/generated/`) | 438 932 bytes | 614 400 (`scripts/spec-generate.mjs`) |
| tools/list over a real MCP session | 12 tools, 62 871 bytes | 65 536 (`test/budget.test.mjs`) |
| support | curated 40 · raw 7 · planned 80 · unsupported 73 | `src/spec/support.ts` |
| tests | 83, all passing (`npm test`; the live dry-run suite included when a key is set) | — |
| live dry-run suite (`test/live-dry-run.test.mjs`, funded key) | 33 quotes in `docs/PRICES-2026-10-07.md`, 4 custom-model skips, 0 failures, 0 USD | every curated quotable model |

Commands green at the head: `npm run typecheck`, `npm test` (83), `npm run spec:check` (regeneration byte-identical),
`node scripts/api-reference.mjs --check`, `actionlint` on both workflows, `npm audit --omit=dev --audit-level=high`
(0). The generator toolchain (`scripts/spec-gen/`, dev-only, never installed by users) carries js-yaml advisories
GHSA-52cp-r559-cp3m / GHSA-2883-xcg3-v3hh through openapi-ts; it runs only on a maintainer's machine against the
committed snapshot.

What the live suite found: the test's own PNG fixture wrote its size as one byte, so a 1024-pixel image had a zero
IHDR and the API answered "Could not read a source image." (fixed: the size as 32-bit big-endian); and the API refuses
a character model without a character reference with a 400 the schema does not state → the overlay constraint
`character-needs-reference`.

Commits: `02f27bf` spec: the OpenAPI snapshot, the classification rule and the generated code · `d3fea91` spec:
Operation[], the reviewed overlay, the support table and the model registry · `6919a0e` client, lifecycle and cost on
the v2 API · `11cca3e` tools: the curated families on v2 with a model per call, quote, generation, discovery and the
raw call · `df245cc` drift check, generated API reference, README/CHANGELOG/ADR/SECURITY · `67696ee` this section ·
`d49e03b` version 2.0.0, the live suite, the character rule · the self-review fixes (below).

Self-review of the head (Step 1 of the review pipeline, before the external round): the download client had dropped
1.x's `redirect: "manual"` — fetch followed redirects, so the host allow-list could be skipped by a hop and the
`REDIRECT_BLOCKED` branch never ran (P1, a regression against 1.2.1; fixed, with a test that fails on the previous
head); a `Retry-After` of 300 s or more was dropped from the error and the 429 retried after 1 s (P2: reported
whatever its size, not retried beyond 300 s); a 2xx whose body the connection cut off surfaced as a bare TypeError
(P2: typed `RESPONSE_READ_FAILED`, saying the job may be running); `ideogram_api` passed header parameters unchecked
(P3: refused unless the operation declares them — none does in this snapshot). Each fix has a test that is red on the
code before it.

Deviations from the note, confirmed in review: the generator runs from its own toolchain `scripts/spec-gen/`
(openapi-ts needs the TypeScript 6 compiler API, TS 7 has none) and `classify.ts` landed in the first commit (the
generator config imports it); `docsUrl` is null everywhere (the snapshot has no per-operation URL — `DOCS_INDEX_URL`
instead); `/v1/edit`, `/v1/edit-lite`, `/v1/.well-known/jwks.json` added to v1_only and
`/integration-assets/{external_ref}` classed legacy; spec_only `/v2/image/*` operations are `raw` behind
`allow_undocumented` (else the flag could never apply in 2.0.0); curated tools leave `webhook_url` / `private` /
`target_collection_id` to `ideogram_api` (schema budget); `ideogram_edit` advertises a pointer, not a schema copy;
FLASH → `quality: very_low` on the models that take `quality`, refused on those that take `rendering_speed`; extra
modules `src/wire.ts`, `src/uploads.ts`, `src/counters.ts`, `src/spec/facts.ts`, `src/spec/fields.ts`,
`src/tools/{family,compat,fields,results,context,curated,discovery}.ts`; a body schema is chosen per media type
(remove-background's multipart and JSON schemas differ; the generator emits one).

Review scope: `spec/openapi.json` (the provider's 1.1 MB document) and `src/generated/*.ts` (generator output, byte-identical
to what the snapshot generates — CI proves it) are marked `linguist-generated` and `-diff` in `.gitattributes`: GitHub
collapses them and the review packets list them as not reviewed; what is reviewed instead is `openapi-ts.config.ts`,
`scripts/spec-generate.mjs` and the classification lists.

## 12. Consult (2026-10-07, before the first line of code)

Codex gpt-6-astra xhigh (read-only, `docs/consults/2026-10-07-design-v2.codex.json`) and Gemini 3.1 Pro
(`docs/consults/2026-10-07-design-v2.gemini.json`). Answers: Q1 one tool per family with a `model` enum, exact schemas
per model (discriminated union, not a flat union) — both; Q2 commit the generated code, the snapshot, the overlay and the
generator config, deterministic regeneration checked in CI — both; Q3 keep `ideogram_api` from day one as an advanced
fallback restricted to the shipped support table, with a discovery tool and undocumented operations opt-in — both (Gemini:
never one giant schema); Q4 a weekly issue with semantic drift, CI tied to the snapshot — both; Q5 keep the 1.x names
through 2.x with real compatibility adapters (Codex) vs a clean break (Gemini) — Codex's, because aliases without
behaviour would break callers that omit `model`. Findings taken into the note: F1 quote allow-list (describe and some
workflows have no `dry_run`), F2 compatibility per model (3.x/4.0 keep `rendering_speed`), F3 return the id at
acceptance, bounded wait ≤ 50 s, F4 no retry after a possible acceptance, F5 the PriceQuote overlay, F6 the four request
locations, F7 payload kinds (description, video, svg, layered), F8 semantic constraints apart from structural schemas,
F9 runtime support apart from class, F10 ContractMismatch, F11 provider texts as source only, F12 per-operation file
limits and streamed downloads, F13 independent wire fixtures, F14 `/datasets` and `/models` are v1_only (capability and
auth, not URL age), F15 a measured schema budget; Gemini F5 the default model stays `ideogram-3`, F6 the poll cap, F8
safety notes, F9 credits beside USD, F10 the balance note. Not taken: Gemini F2's "remove `ideogram_api`" — the raw tool
advertises a small schema (`operation` + free-form `params`) and validates at call time, which answers the size concern.
