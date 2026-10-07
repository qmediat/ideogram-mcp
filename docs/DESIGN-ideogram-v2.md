# DESIGN — `@qmediat.io/ideogram-mcp` 2.x: the whole Ideogram platform, one API, delivered by family

Status: proposed (step 0 not started) · Date: 2026-10-07 · Owner: qmt · Decision: operator GO on the RAR of 2026-10-07
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
  `precise-masked-edit`, `virtual-try-on`, video edit `seedance-2`, `GET /v2/assets/reference-usage`), 58 v1 operations
  (among them capabilities v2 lacks: custom-model training `/v1/ideogram-v{3,4}/train-model[-advanced]`, `/v1/ideogram-v4/
  magic-prompt`, `/v1/layerize-logos`, `/v1/snap-mask`, `/v1/provenance/verify`, `/v1/ideogram-v45/generate`, Flux 2 Klein,
  Ernie, 4.0 cfg-distilled / fp8 / stable, generate-design, graphic, try-on, image-to-image), 15 unversioned legacy
  operations (`/generate`, `/edit`, `/describe`, `/datasets`, `/models`…: Ideogram 1.0/2.0-era, superseded by v2
  `ideogram-2` / `ideogram-2a`), 9 internal (`/manage/*` web-app and organization administration, `/mini-apps/*`,
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
                 legacy:    unversioned Ideogram 1.0/2.0-era paths — never exposed (v2 ideogram-2/2a cover them)
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
Lifecycle      = Sync {result} | Async {generation_id → poll GET /v2/generations/{id} every POLL_MS (2 000, ×1.5 to
                 10 000) until completed|failed or LIFECYCLE_TIMEOUT_MS (images 600 000, video 1 800 000); failed →
                 failure_reason; pending at the timeout → the generation_id returned so `ideogram_generation` can finish}
Result         = { generation_id, seed, images: Saved[] (path, url, resolution, seed, prompt, is_image_safe),
                   unsafe: number (url null), usage_cost_usd_micros | null (from GenerationResponse when polled; the
                   sync 200 of a v2 op carries none — a `cost: unknown` field says so), model, operation: OperationId }
Quote          = PriceQuote (as the spec) + { usd: Decimal string with 6 places, credits: Decimal, operation, model }
Usage          = GetAccountUsageResponse buckets → { start, end, line_items: {product, endpoint, cost_total, currency,
                   units {unit, quantity, unit_price}, api_key (redacted), source} } — the shape ai-cost will read
Error          = IdeogramApiError {status, code, message, reject_reason?, retry_after_s?, max_inflight?} (402 and 429
                 typed from GenerationErrorResponse; 4xx validation errors never reach the API: zod refuses first)
ToolSpec       = { name: "ideogram_<family>", input: ZodObject (one object per family: `model` enum of that family's
                   ids + the UNION of the family's request fields, each field only on the models whose schema has it —
                   the handler refuses a field the chosen model does not take, naming the models that do), handler }
RawCall        = ideogram_api { operation: OperationId (documented | spec_only | v1_only only), params: object, files:
                   {field: path}[], dry_run?: boolean } → validated by the operation's generated zod schema, the response
                   returned as the spec types it, images downloaded like a curated tool's
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
src/spec/operations.ts            Operation[] built from the snapshot at build time (class, family, model, flags, docsUrl,
                                  toolText) — typed, frozen; src/spec/classify.ts holds the ONE classification rule
src/registry.ts                   Registry + the newest table + the CI check (tests/registry.test.mjs)
src/client.ts                     as today (retries, Retry-After, allowed download hosts, 50 MB cap) + json bodies,
                                  dry_run query, typed 402/429, `Api-Key` only (never Bearer)
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
| a response the generated zod schema rejects | the raw body is returned with `schema_mismatch: true` and the zod issues — never silently reshaped; counted in the run's stderr line |
| the registry disagrees with the snapshot | the build fails (CI) with both lists |
| the live spec differs from the snapshot | the weekly job opens/updates ONE issue with the diff of exposed operations; the build is untouched |

## 5. Costs and bounds

| bound | value | why |
|---|---|---|
| tool count after step 2 | ≤ 15 | MCP clients degrade with wide tool lists (the RAR's assumption; measured when the first client complains) |
| generated code | ≤ 600 KB committed (`src/generated/`) | 486 schemas × zod; filtered to the exposed operations |
| request timeout | images 120 s sync (today), video: async only | the spec says video is acknowledgement-only |
| poll | 2 s → ×1.5 → 10 s cap; images 10 min, video 30 min | a Quality 4.5 × 4 images takes minutes; video longer |
| upload | ≤ 25 MB per file, ≤ 10 files (the spec's caps, enforced before the call) | a 413 from the API is a wasted round trip |
| download | 50 MB cap, allow-listed hosts (today) | unchanged |
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
- Each new check must fail on the previous version (Step 1b's rule): the registry/classify tests fail on 1.2.1 by
  construction (no registry); the lifecycle tests fail on the v1 client (no `generation_id`).

## 7. Versioning and migration (2.0.0)

Breaking: `rendering_speed` → `quality` (`FLASH`→`very_low`, `TURBO`→`low`, `DEFAULT`→`medium`, `QUALITY`→`high`; the old
values are accepted for one major version with a deprecation note in the result); `model` values are the spec's ids
(`"3.0"`/`"4.0"` accepted as aliases of `ideogram-3`/`ideogram-4` for one major); `ideogram_edit` becomes an alias of
`ideogram_inpaint`; v1-only parameters of 3.0 (`style_codes`, `color_palette`, `style_reference_images`, …) move to the v2
fields of the same meaning where the spec has them — the migration table in `CHANGELOG.md`. The default `generate` model
is `ideogram-4-5` (the newest; the quote tool tells the price before a call).

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

## 10. Open questions for the consult (section 12 records the answers)

1. One tool per family with a `model` enum and a union of fields, or one tool per (family, model)? The first keeps ~15
   tools; the second gives exact schemas per model but 60+ tools.
2. Commit the generated code (`src/generated/`) or generate at build time? (Reviewers read diffs; the build must not need
   the network — the note says commit.)
3. `ideogram_api` from day one: does a raw validated call undermine the curated tools' UX for LLM clients, or is it the
   honest "everything the platform offers" answer until a family is curated?
4. The snapshot drift job: weekly issue vs failing CI on provider changes.
5. Keeping the 1.x tool names with aliases for one major, or a clean break at 2.0.0?

## 11. Validation before the PR

(filled when step 0 is implemented: the registry and classify counts, the dry_run suite's quotes, the tool count, the
generated size, the selftest and CI runs)

## 12. Consult

(the architecture pass's findings and what changed, with the consult's output file)
