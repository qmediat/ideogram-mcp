// The curated tools and the platform tools against a fake API: input → wire body per model, the model-field refusal,
// the 1.x adapter's mappings, the shaping of each outcome, and the refusals of ideogram_api / ideogram_quote.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { startFakeApi, testContext, tool, PNG } from "./support/fake-api.mjs";

const dir = await mkdtemp(join(tmpdir(), "ideogram-tools-"));
after(() => rm(dir, { recursive: true, force: true }));
const png = join(dir, "source.png");
await writeFile(png, PNG);

const accepted = (id) => ({ json: { generation_id: id, seed: 1 } });
const pending = (id) => ({ json: { generation_id: id, status: "pending", created: "2026-10-07T00:00:00Z" } });

/** Runs one tool call against a fake API; the handler answers each request. */
async function call(name, args, handler = (req) => (req.method === "POST" ? accepted("g") : pending("g"))) {
  const api = await startFakeApi((req, n) => handler(req, n, api));
  try {
    const ctx = await testContext(api.base, join(dir, `out-${Math.random().toString(16).slice(2)}`));
    const result = await (await tool(name)).handler(ctx, args);
    return { result, requests: api.requests, ctx, api };
  } finally {
    await api.close();
  }
}

const text = (result) => result.content.map((c) => c.text).join("\n");
const sentJson = (requests) => JSON.parse(requests[0].body.toString());

test("ideogram_generate defaults to ideogram-3 and sends the fields as given, async, to the v2 path", async () => {
  const { requests } = await call("ideogram_generate", { prompt: "a red door", num_images: 2, wait_s: 0 });
  assert.equal(requests[0].url, "/v2/image/generate/ideogram-3");
  assert.deepEqual(sentJson(requests), { prompt: "a red door", num_images: 2, async: true });
});

test("each model goes to its own path with its own fields: 4.5 takes quality and source images", async () => {
  const { requests } = await call("ideogram_generate", { model: "ideogram-4-5", prompt: "edit it", images: [png], quality: "high", wait_s: 0 });
  assert.equal(requests[0].url, "/v2/image/generate/ideogram-4-5");
  assert.match(requests[0].headers["content-type"], /^multipart\/form-data; boundary=/);
  const body = requests[0].body.toString("latin1");
  assert.match(body, /name="quality"\r\n\r\nhigh\r\n/);
  assert.match(body, /name="images"; filename="images.png"\r\nContent-Type: image\/png/);
  const nano = await call("ideogram_generate", { model: "nano-banana-pro", prompt: "x", wait_s: 0 });
  assert.equal(nano.requests[0].url, "/v2/image/generate/nano-banana-pro");
});

test("a field the chosen model does not take is refused before any request, naming the models that take it", async () => {
  const { registryProblems } = await import("../dist/registry.js");
  assert.deepEqual(registryProblems(), []);
  const api = await startFakeApi(() => accepted("g"));
  try {
    const ctx = await testContext(api.base, dir);
    const generate = await tool("ideogram_generate");
    await assert.rejects(
      () => generate.handler(ctx, { model: "ideogram-4", prompt: "x", style_codes: ["ABCD1234"] }),
      /`style_codes` is not a parameter of ideogram-4; the models that take it: .*ideogram-3\b/,
    );
    await assert.rejects(() => generate.handler(ctx, { prompt: "x", denoise: 0.5 }), /no ideogram_generate model takes it/);
    await assert.rejects(() => generate.handler(ctx, { prompt: "x", async: true }), /managed by this tool: use wait_s/);
    await assert.rejects(() => generate.handler(ctx, { prompt: "x", webhook_url: "https://example.com" }), /through ideogram_api only/);
    await assert.rejects(() => generate.handler(ctx, { model: "ideogram-9", prompt: "x" }), /has no model ideogram-9; one of: auto/);
    await assert.rejects(() => generate.handler(ctx, { prompt: "" }), /ideogram-3 refuses the input:\nprompt:/);
    assert.equal(api.requests.length, 0);
  } finally {
    await api.close();
  }
});

test("the 1.x adapter: model 3.0, uppercase speed / magic prompt / style type are mapped, and the result says so", async () => {
  const { requests, result } = await call("ideogram_generate", {
    model: "3.0", prompt: "x", rendering_speed: "TURBO", magic_prompt: "OFF", style_type: "REALISTIC", wait_s: 0,
  });
  assert.equal(requests[0].url, "/v2/image/generate/ideogram-3");
  assert.deepEqual(sentJson(requests), { prompt: "x", rendering_speed: "turbo", magic_prompt: "off", style_type: "realistic", async: true });
  assert.match(text(result), /Mapped from the 1.x inputs: model "3.0" → ideogram-3; rendering_speed TURBO → turbo; magic_prompt OFF → off; style_type REALISTIC → realistic/);
});

test("the 1.x adapter: a 1.x palette preset name (EMBER) becomes v2's ember", async () => {
  const { requests, result } = await call("ideogram_generate", { prompt: "x", color_palette: { name: "EMBER" }, wait_s: 0 });
  assert.deepEqual(sentJson(requests).color_palette, { name: "ember" });
  assert.match(text(result), /color_palette EMBER → ember/);
});

test("the 1.x adapter: QUALITY on Ideogram 4.5 becomes quality high; 4.0 keeps rendering_speed; FLASH is refused", async () => {
  const v45 = await call("ideogram_generate", { model: "ideogram-4-5", prompt: "x", rendering_speed: "QUALITY", wait_s: 0 });
  assert.deepEqual(sentJson(v45.requests), { prompt: "x", quality: "high", async: true });
  assert.match(text(v45.result), /rendering_speed QUALITY → quality high/);
  const v4 = await call("ideogram_generate", { model: "4.0", prompt: "x", rendering_speed: "DEFAULT", wait_s: 0 });
  assert.equal(v4.requests[0].url, "/v2/image/generate/ideogram-4");
  assert.equal(sentJson(v4.requests).rendering_speed, "default");
  const flash = await call("ideogram_generate", { prompt: "x", rendering_speed: "FLASH" }).catch((e) => e);
  assert.match(flash.message, /FLASH does not exist in v2/);
});

test("describe: describe_model_version V_3 names ideogram-3, V_2 is refused; the description is returned", async () => {
  const body = { created: "2026-10-07T00:00:00Z", description_id: "d", descriptions: [{ text: "a red door" }] };
  const { requests, result } = await call("ideogram_describe", { image: png, describe_model_version: "V_3" }, () => ({ json: body }));
  assert.equal(requests[0].url, "/v2/image/describe/ideogram-3");
  assert.match(text(result), /1\. a red door/);
  assert.match(text(result), /describe_model_version V_3 → model ideogram-3/);
  const v2 = await call("ideogram_describe", { image: png, describe_model_version: "V_2" }).catch((e) => e);
  assert.match(v2.message, /V_2 has no v2 model/);
});

test("ideogram_edit is ideogram_inpaint: the same path, and inpaint without a mask is refused", async () => {
  const { requests } = await call("ideogram_edit", { image: png, mask: png, prompt: "a door", wait_s: 0 });
  assert.equal(requests[0].url, "/v2/image/inpaint/ideogram-3");
  const missing = await call("ideogram_edit", { image: png, prompt: "a door" }).catch((e) => e);
  assert.match(missing.message, /inpaint needs the source .* and the mask/);
});

test("a completed generation: safe images saved, unsafe ones counted, the id and the reported cost shown", async () => {
  const handler = (req, _n, api) => {
    if (req.url.startsWith("/img/")) return { status: 200, headers: { "content-type": "image/png" }, body: PNG };
    if (req.method === "POST") return accepted("g7");
    return {
      json: {
        generation_id: "g7", status: "completed", created: "2026-10-07T00:00:00Z", usage_cost_usd_micros: 120000,
        data: [
          { object_type: "image.generation", url: `${api.base}/img/a.png`, prompt: "p", resolution: "1024x1024", is_image_safe: true, seed: 5 },
          { object_type: "image.generation", url: null, prompt: "p", resolution: "1024x1024", is_image_safe: false, seed: 6 },
        ],
      },
    };
  };
  const { result, ctx } = await call("ideogram_generate", { prompt: "x" }, handler);
  const out = text(result);
  assert.match(out, /Generation g7 completed\./);
  assert.match(out, /Cost reported by Ideogram: 0\.120000 USD/);
  assert.match(out, /1 of 2 image\(s\) saved\./);
  assert.match(out, /1 image\(s\) withheld by Ideogram's safety check/);
  assert.equal(result.isError, undefined);
  assert.equal((await readdir(ctx.outputDir)).length, 1);
});

test("a generation still running is returned with its id and how to collect it; a failed one is an error", async () => {
  const { result } = await call("ideogram_generate", { prompt: "x", wait_s: 0 });
  assert.match(text(result), /Accepted: generation g is still running\.\nCollect it with ideogram_generation \{"generation_id": "g"\}/);
  const failed = await call("ideogram_generate", { prompt: "x" }, (req) =>
    req.method === "POST" ? accepted("g8") : { json: { generation_id: "g8", status: "failed", created: "2026-10-07T00:00:00Z", failure_reason: "content_policy_violation" } },
  );
  assert.equal(failed.result.isError, true);
  assert.match(text(failed.result), /g8 failed: content_policy_violation/);
});

test("ideogram_generation collects an id; a contract mismatch is an error that keeps the id", async () => {
  const { requests, result } = await call("ideogram_generation", { generation_id: "abc", wait_s: 0 }, () => pending("abc"));
  assert.equal(requests[0].url, "/v2/generations/abc");
  assert.match(text(result), /generation abc is still running/);
  const broken = await call("ideogram_generate", { prompt: "x" }, () => ({ json: { generation_id: "g9", seed: "nine" } }));
  assert.equal(broken.result.isError, true);
  assert.match(text(broken.result), /does not match its own specification/);
  assert.match(text(broken.result), /Generation id: g9/);
});

test("ideogram_quote prices exactly the tool's call with dry_run and refuses describe locally", async () => {
  const priceQuote = { object: "price_quote", billing_identifier: "ideogram-3-turbo", quantity: 1, usd_micros: 30000, credit_millis: 30, qualifier: "exact" };
  const { requests, result } = await call("ideogram_quote", { tool: "ideogram_generate", arguments: { prompt: "x", rendering_speed: "TURBO" } }, () => ({ json: priceQuote }));
  assert.equal(requests[0].url, "/v2/image/generate/ideogram-3?dry_run=true");
  assert.deepEqual(sentJson(requests), { prompt: "x", rendering_speed: "turbo" }, "no async on a dry run");
  assert.match(text(result), /0\.030000 USD exact/);
  assert.match(text(result), /Nothing was generated or billed/);
  const describe = await call("ideogram_quote", { tool: "ideogram_describe", arguments: { image: png } }).catch((e) => e);
  assert.match(describe.message, /does not declare dry_run/);
});

test("ideogram_api refuses by class, by the support table and undocumented operations without the opt-in", async () => {
  const cases = [
    [{ operation: "post_generate_image" }, /legacy path/],
    [{ operation: "post_batch" }, /provider's own/],
    [{ operation: "get_usage_info" }, /web-app session/],
    [{ operation: "post_generate_video_seed_dance2_text_to_video" }, /planned for a later release/],
    [{ operation: "post_reframe_image_auto" }, /set allow_undocumented: true/],
    [{ operation: "nope" }, /No operation nope/],
  ];
  for (const [args, message] of cases) {
    const { result, requests } = await call("ideogram_api", args);
    assert.equal(result.isError, true, args.operation);
    assert.match(text(result), message);
    assert.equal(requests.length, 0);
  }
});

test("ideogram_api checks the body against the operation's schema and runs a served operation", async () => {
  const unknown = await call("ideogram_api", { operation: "post_remove_background_v2", files: [{ field: "image", path: png }], params: { body: { seed: 1 } } }).catch((e) => e);
  assert.match(unknown.message, /body: unknown field\(s\) seed; the fields: async, image, image_asset_identifier/);
  const wrongType = await call("ideogram_api", { operation: "post_precise_edit_image_v2_ideogram45", params: { body: { prompt: 5 } } }).catch((e) => e);
  assert.match(wrongType.message, /body: prompt: Invalid input: expected string/);
  const byAsset = await call("ideogram_api", { operation: "post_remove_background_v2", params: { body: {} } }).catch((e) => e);
  assert.match(byAsset.message, /image_asset_identifier/, "a JSON call (no file) is checked against the JSON body, which needs the asset");
  const { requests, result } = await call("ideogram_api", {
    operation: "post_reframe_image_auto", allow_undocumented: true, files: [{ field: "image", path: png }], params: { body: { aspect_ratio: "16:9" } }, wait_s: 0,
  }, (req) => (req.method === "POST" ? { json: { generation_id: "r1", seed: 1, width: 1024, height: 1024 } } : pending("r1")));
  assert.equal(requests[0].url, "/v2/image/reframe/auto");
  assert.match(text(result), /undocumented \(spec_only\)/);
});

test("ideogram_api refuses a header parameter the operation does not declare, before any request", async () => {
  const api = await startFakeApi(() => accepted("h"));
  try {
    const ctx = await testContext(api.base, dir);
    const raw = await tool("ideogram_api");
    await assert.rejects(
      () => raw.handler(ctx, { operation: "post_remove_background_v2", params: { headers: { "X-Forwarded-For": "1.2.3.4" }, body: {} }, files: [{ field: "image", path: png }] }),
      /headers: post_remove_background_v2 takes no header parameters; not X-Forwarded-For/,
    );
    assert.equal(api.requests.length, 0);
  } finally {
    await api.close();
  }
});

test("a model that is not a string is refused, never silently the default (quote arguments and the edit alias bypass the SDK schema)", async () => {
  const quote = await call("ideogram_quote", { tool: "ideogram_generate", arguments: { model: 4.5, prompt: "x" } }).catch((e) => e);
  assert.match(quote.message, /model must be a string, got 4\.5/);
  const edit = await call("ideogram_edit", { model: 3, image: png, mask: png, prompt: "x" }).catch((e) => e);
  assert.match(edit.message, /model must be a string/);
});

test("ideogram_api: dry_run inside params.query is refused (the dry_run argument is the quote path); a .gif upload is refused", async () => {
  const q = await call("ideogram_api", { operation: "post_remove_background_v2", params: { query: { dry_run: true }, body: {} }, files: [{ field: "image", path: png }] }).catch((e) => e);
  assert.match(q.message, /query\.dry_run: use the dry_run argument/);
  const gif = join(dir, "a.gif");
  await writeFile(gif, PNG);
  const g = await call("ideogram_remix", { image: gif, prompt: "x" }).catch((e) => e);
  assert.match(g.message, /unsupported file type \.gif; one of \.png, \.jpg, \.jpeg, \.webp/);
});

test("a completed generation that lists no image says so instead of '0 of 0 saved'", async () => {
  const { result } = await call("ideogram_generate", { prompt: "x" }, (req) =>
    req.method === "POST" ? accepted("g0") : { json: { generation_id: "g0", status: "completed", created: "2026-10-07T00:00:00Z", data: [] } },
  );
  assert.equal(result.isError, true);
  assert.match(text(result), /listed no image for this generation/);
});

test("ideogram_operations lists a family and details one operation with its fields and limits", async () => {
  const family = await call("ideogram_operations", { family: "generate" });
  assert.equal(text(family.result).split("\n").filter((l) => l.includes("/v2/image/generate/")).length, 18);
  const one = await call("ideogram_operations", { operation: "post_describe_image_ideogram_v3" });
  assert.match(text(one.result), /image: local file path/);
  assert.match(text(one.result), /image: 10 MB/);
  assert.doesNotMatch(text(one.result), /quotable/);
});
