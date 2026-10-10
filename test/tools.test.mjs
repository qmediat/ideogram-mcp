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
  assert.deepEqual(sentJson(requests), { prompt: "a red door", num_images: 2, private: true, async: true });
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
  assert.deepEqual(sentJson(requests), { prompt: "x", rendering_speed: "turbo", magic_prompt: "off", style_type: "realistic", private: true, async: true });
  assert.match(text(result), /Mapped from the 1.x inputs: model "3.0" → ideogram-3; rendering_speed TURBO → turbo; magic_prompt OFF → off; style_type REALISTIC → realistic/);
});

test("the 1.x adapter: a 1.x palette preset name (EMBER) becomes v2's ember", async () => {
  const { requests, result } = await call("ideogram_generate", { prompt: "x", color_palette: { name: "EMBER" }, wait_s: 0 });
  assert.deepEqual(sentJson(requests).color_palette, { name: "ember" });
  assert.match(text(result), /color_palette EMBER → ember/);
});

test("the 1.x adapter: QUALITY on Ideogram 4.5 becomes quality high; 4.0 keeps rendering_speed; FLASH is refused", async () => {
  const v45 = await call("ideogram_generate", { model: "ideogram-4-5", prompt: "x", rendering_speed: "QUALITY", wait_s: 0 });
  assert.deepEqual(sentJson(v45.requests), { prompt: "x", quality: "high", private: true, async: true });
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
  assert.deepEqual(sentJson(requests), { prompt: "x", rendering_speed: "turbo", private: true, async: true }, "exactly the request the tool would send");
  assert.match(text(result), /0\.030000 USD exact/);
  assert.match(text(result), /Nothing was generated or billed/);
  const describe = await call("ideogram_quote", { tool: "ideogram_describe", arguments: { image: png } });
  assert.equal(describe.result.isError, true);
  assert.match(text(describe.result), /does not declare dry_run/);
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

test("a legacy input of another tool is a foreign field: describe_model_version on ideogram_generate is refused by name", async () => {
  const error = await call("ideogram_generate", { prompt: "x", describe_model_version: "V_3" }).catch((e) => e);
  assert.match(error.message, /`describe_model_version` is not a parameter of ideogram-3; no ideogram_generate model takes it/);
});

test("ideogram_api: a misspelled location is refused, and several files of one array field are checked as an array and sent as parts", async () => {
  const typo = await call("ideogram_api", { operation: "post_remove_background_v2", params: { bodyy: {} }, files: [{ field: "image", path: png }] });
  assert.equal(typo.result.isError, true);
  assert.match(text(typo.result), /params: Unrecognized key.*bodyy/);
  const two = await call("ideogram_api", {
    operation: "post_generate_image_v2_gpt_image2", params: { body: { prompt: "x" } }, files: [{ field: "images", path: png }, { field: "images", path: png }], wait_s: 0,
  });
  assert.equal(two.requests[0].url, "/v2/image/generate/gpt-image-2");
  const body = two.requests[0].body.toString("latin1");
  assert.equal(body.split('name="images"; filename="images.png"').length - 1, 2, "two file parts under images");
});

test("ideogram_api on get_generation_v2 reads the status it returns: a failed generation is Failed, not 'still running'", async () => {
  const { requests, result } = await call("ideogram_api", { operation: "get_generation_v2", params: { path: { generation_id: "gF" } }, wait_s: 0 }, () => ({
    json: { generation_id: "gF", status: "failed", created: "2026-10-07T00:00:00Z", failure_reason: "content_policy_violation" },
  }));
  assert.equal(requests[0].url, "/v2/generations/gF");
  assert.equal(result.isError, true);
  assert.match(text(result), /gF failed: content_policy_violation/);
});

test("a 1.x alias and the field it maps to, both given, are refused (quality + rendering_speed on Ideogram 4.5)", async () => {
  const both = await call("ideogram_generate", { model: "ideogram-4-5", prompt: "x", quality: "very_low", rendering_speed: "QUALITY" }).catch((e) => e);
  assert.match(both.message, /rendering_speed QUALITY maps to quality, which is also given \("very_low"\); give one/);
});

test("ideogram_api refuses a body for an operation that takes none (get_generation_v2) instead of dropping it", async () => {
  const { result, requests } = await call("ideogram_api", { operation: "get_generation_v2", params: { path: { generation_id: "g" }, body: { prompt: "x" } }, wait_s: 0 }).catch((e) => ({ result: { isError: true, content: [{ text: e.message }] }, requests: [] }));
  assert.match(text(result), /body: get_generation_v2 takes no body; given prompt/);
  assert.equal(requests.length, 0);
});

test("ideogram_quote refuses an unquotable tool before any file is read: describe with a missing file gets the dry_run refusal", async () => {
  const { result, requests } = await call("ideogram_quote", { tool: "ideogram_describe", arguments: { image: join(dir, "does-not-exist.png") } });
  assert.equal(result.isError, true);
  assert.match(text(result), /does not declare dry_run/);
  assert.equal(requests.length, 0);
});

test("ideogram_api on get_generation_v2 with a wait polls a still-pending generation until it completes", async () => {
  const done = { generation_id: "gW", status: "completed", created: "2026-10-07T00:00:00Z", data: [{ object_type: "image.generation", url: null, is_image_safe: false, seed: 1, prompt: "p", resolution: "1024x1024" }] };
  const { requests, result } = await call("ideogram_api", { operation: "get_generation_v2", params: { path: { generation_id: "gW" } }, wait_s: 20 }, (_req, n) => (n < 3 ? pending("gW") : { json: done }));
  assert.equal(requests.length, 3, "the first lookup, then two polls");
  assert.match(text(result), /Generation gW completed/);
});

test("ideogram_operations lists a family and details one operation with its fields and limits", async () => {
  const family = await call("ideogram_operations", { family: "generate" });
  assert.equal(text(family.result).split("\n").filter((l) => l.includes("/v2/image/generate/")).length, 18);
  const one = await call("ideogram_operations", { operation: "post_describe_image_ideogram_v3" });
  assert.match(text(one.result), /image: local file path/);
  assert.match(text(one.result), /image: 10 MB/);
  assert.doesNotMatch(text(one.result), /quotable/);
});

test("a download the call's budget cuts is 'Not saved' with the way to collect it in a new call; nothing past the deadline is fetched", async () => {
  let ctx;
  const api = await startFakeApi((req) => {
    if (req.method === "POST") return accepted("g10");
    if (req.url.startsWith("/v2/generations/")) {
      ctx.clock.t += 60_000; // the poll is answered as the call's 55 s run out: the result is known, the download cannot start
      return { json: { generation_id: "g10", status: "completed", created: "2026-10-07T00:00:00Z", data: [{ url: `${api.base}/img.png`, prompt: "x", resolution: "1024x1024", is_image_safe: true, seed: 1, object_type: "image.generation" }] } };
    }
    return { status: 200, headers: { "content-type": "image/png" }, body: PNG };
  });
  try {
    ctx = await testContext(api.base, join(dir, "cut"));
    const result = await (await tool("ideogram_generate")).handler(ctx, { prompt: "x" });
    assert.match(text(result), /Generation g10 completed\./);
    assert.match(text(result), /Not saved: .*img\.png — the call's time ran out before this request could be made \(ideogram_generation with the id above saves the generation's images in a new call\)/);
    assert.equal(api.requests.filter((r) => r.url === "/img.png").length, 0, "no download started past the deadline");
  } finally {
    await api.close();
  }
});

test("ideogram_api refuses async: false for a run (its result would arrive only in the POST answer) and quotes it with dry_run", async () => {
  const api = await startFakeApi(() => accepted("g"));
  try {
    const ctx = await testContext(api.base, dir);
    await assert.rejects(async () => (await tool("ideogram_api")).handler(ctx, { operation: "post_generate_image_v2_ideogram_v3", params: { body: { prompt: "x", async: false } } }), /async: false is not served/);
    assert.equal(api.requests.length, 0, "nothing sent");
  } finally {
    await api.close();
  }
  const priceQuote = { object: "price_quote", billing_identifier: "ideogram-3", quantity: 1, usd_micros: 60000, credit_millis: 60, qualifier: "exact" };
  const quoted = await call("ideogram_api", { operation: "post_generate_image_v2_ideogram_v3", params: { body: { prompt: "x", async: false } }, dry_run: true }, () => ({ json: priceQuote }));
  assert.equal(quoted.result.isError, undefined, text(quoted.result));
  assert.equal(quoted.requests.length, 1);
  assert.match(quoted.requests[0].url, /dry_run=true/);
});

test("ideogram_precise_edit: Ideogram 4.5 by default, the image, mask and reference images as parts, the rules before any request", async () => {
  const acceptedEdit = (req) => (req.method === "POST" ? { json: { generation_id: "e", seed: 1, generation_kind: "sampling" } } : pending("e"));
  const { requests, result } = await call("ideogram_precise_edit", { prompt: "swap the sign", image: png, mask: png, reference_images: [png, png], context_window: "auto", wait_s: 0 }, acceptedEdit);
  assert.equal(result.isError, undefined, text(result));
  assert.match(text(result), /Accepted: generation e is still running/);
  assert.equal(requests[0].url, "/v2/image/precise-edit/ideogram-4-5");
  const body = requests[0].body.toString("latin1");
  assert.match(body, /name="image"; filename="image.png"/);
  assert.match(body, /name="mask"; filename="mask.png"/);
  assert.equal(body.split('name="reference_images"; filename="reference_images.png"').length - 1, 2);
  assert.match(body, /name="context_window"\r\n\r\nauto\r\n/);
  assert.match(body, /name="async"\r\n\r\ntrue\r\n/);
  const noMask = await call("ideogram_precise_edit", { prompt: "x", image: png, context_window: "auto" }).catch((e) => e);
  assert.match(noMask.message, /context_window "auto" needs a mask/);
  const speed = await call("ideogram_precise_edit", { prompt: "x", image: png, rendering_speed: "TURBO", wait_s: 0 }, acceptedEdit);
  assert.match(speed.requests[0].body.toString("latin1"), /name="quality"\r\n\r\nlow\r\n/, "the 1.x speed maps to quality on 4.5");
  assert.match(text(speed.result), /rendering_speed TURBO → quality low/);
});

test("ideogram_remove_background and ideogram_remove_object go to their ideogram-1 paths; remove object needs a mask", async () => {
  const bg = await call("ideogram_remove_background", { image: png, wait_s: 0 });
  assert.equal(bg.requests[0].url, "/v2/image/remove-background/ideogram-1");
  assert.match(bg.requests[0].body.toString("latin1"), /name="async"\r\n\r\ntrue\r\n/);
  const obj = await call("ideogram_remove_object", { image: png, mask: png, seed: 7, wait_s: 0 });
  assert.equal(obj.requests[0].url, "/v2/image/remove-object/ideogram-1");
  assert.match(obj.requests[0].body.toString("latin1"), /name="seed"\r\n\r\n7\r\n/);
  assert.doesNotMatch(obj.requests[0].body.toString("latin1"), /name="async"/, "remove object takes no async field: it is a job by construction");
  const missing = await call("ideogram_remove_object", { image: png }).catch((e) => e);
  assert.match(missing.message, /remove object needs the source .* and the mask/);
  const prompt = await call("ideogram_remove_background", { image: png, prompt: "x" }).catch((e) => e);
  assert.match(prompt.message, /`prompt` is not a parameter of ideogram-1; no ideogram_remove_background model takes it/);
});

test("ideogram_layerize: font files go under font_candidate_files as fonts, an image there is refused, and the result saves the base image and lists the text blocks", async () => {
  const ttf = join(dir, "brand.ttf");
  await writeFile(ttf, Buffer.from("00010000", "hex"));
  const handler = (req, _n, api) => {
    if (req.url.startsWith("/img/")) return { status: 200, headers: { "content-type": "image/png" }, body: PNG };
    if (req.method === "POST") return accepted("L1");
    return {
      json: {
        generation_id: "L1", status: "completed", created: "2026-10-07T00:00:00Z",
        data: [{ object_type: "layerized_image", base_image_url: `${api.base}/img/base.png`, is_image_safe: true, resolution: "1024x1024", seed: 3, text_blocks: [{ text: "SALE", font_name: "Brand", font_size: 72, color: "#212121", alignment: "left", formatting: ["bold"], x: 10, y: 20, width: 300, height: 80 }] }],
      },
    };
  };
  const { requests, result, ctx } = await call("ideogram_layerize", { image: png, font_candidate_files: [ttf], prompt: "a poster" }, handler);
  assert.equal(requests[0].url, "/v2/design/layerize/ideogram-3");
  assert.match(requests[0].body.toString("latin1"), /name="font_candidate_files"; filename="font_candidate_files.ttf"\r\nContent-Type: font\/ttf/);
  const out = text(result);
  assert.match(out, /Generation L1 completed\./);
  assert.match(out, /1 of 1 base image\(s\) saved \(1 design\(s\)\)\./);
  assert.match(out, /Text blocks of design 1 \(1\):\n\[\n  \{\n    "alignment": "left"/);
  assert.match(out, /"text": "SALE"/);
  assert.equal(result.isError, undefined);
  assert.equal((await readdir(ctx.outputDir)).length, 1);
  const notFont = await call("ideogram_layerize", { image: png, font_candidate_files: [png] }).catch((e) => e);
  assert.match(notFont.message, /font_candidate_files: unsupported file type \.png; one of \.ttf, \.otf, \.woff, \.woff2/);
  const fontAsImage = await call("ideogram_layerize", { image: ttf }).catch((e) => e);
  assert.match(fontAsImage.message, /image: unsupported file type \.ttf; one of \.png, \.jpg, \.jpeg, \.webp/);
});

test("ideogram_generation shows a layerized design collected by id the same way; a design Ideogram withheld is an error, nothing fetched", async () => {
  const done = { generation_id: "L2", status: "completed", created: "2026-10-07T00:00:00Z", data: [{ object_type: "layerized_image", base_image_url: null, is_image_safe: false, resolution: "1024x1024", seed: 1, text_blocks: [] }] };
  const { result, requests } = await call("ideogram_generation", { generation_id: "L2", wait_s: 0 }, () => ({ json: done }));
  assert.equal(result.isError, true, "nothing usable");
  assert.match(text(result), /0 of 0 base image\(s\) saved \(1 design\(s\)\)\./);
  assert.match(text(result), /Design 1 withheld by Ideogram's safety check/);
  assert.match(text(result), /Text blocks of design 1 \(0\)/);
  assert.equal(requests.length, 1, "no download attempted");
});

test("ideogram_quote prices the new tools through their own dry run", async () => {
  const priceQuote = { object: "price_quote", billing_identifier: "remove-background", quantity: 1, usd_micros: 10000, credit_millis: 10, qualifier: "exact" };
  const { requests, result } = await call("ideogram_quote", { tool: "ideogram_remove_background", arguments: { image: png } }, () => ({ json: priceQuote }));
  assert.equal(requests[0].url, "/v2/image/remove-background/ideogram-1?dry_run=true");
  assert.match(text(result), /0\.010000 USD exact/);
});

test("private is sent as true unless the caller says otherwise, on every model that takes it (remove background follows the plan's setting when omitted)", async () => {
  const bg = await call("ideogram_remove_background", { image: png, wait_s: 0 });
  assert.match(bg.requests[0].body.toString("latin1"), /name="private"\r\n\r\ntrue\r\n/);
  const published = await call("ideogram_replace_background", { image: png, prompt: "a beach", private: false, wait_s: 0 });
  assert.match(published.requests[0].body.toString("latin1"), /name="private"\r\n\r\nfalse\r\n/, "the caller's false goes through");
  const gen = await call("ideogram_generate", { prompt: "x", wait_s: 0 });
  assert.deepEqual(sentJson(gen.requests), { prompt: "x", private: true, async: true });
  const noField = await call("ideogram_remove_object", { image: png, mask: png, wait_s: 0 });
  assert.doesNotMatch(noField.requests[0].body.toString("latin1"), /name="private"/, "remove object takes no private field: nothing is invented");
  const raw = await call("ideogram_api", { operation: "post_remove_background_v2", files: [{ field: "image", path: png }], params: { body: {} }, wait_s: 0 });
  assert.doesNotMatch(raw.requests[0].body.toString("latin1"), /name="private"/, "ideogram_api sends what the caller gave");
});

test("a tool that works on an image refuses a call without a source, before any request; a JSON call is checked against the JSON schema", async () => {
  for (const [name, args] of [["ideogram_remove_background", {}], ["ideogram_precise_edit", { prompt: "x" }], ["ideogram_layerize", {}], ["ideogram_remix", { prompt: "x" }], ["ideogram_upscale", {}], ["ideogram_describe", {}]]) {
    const { result, requests } = await call(name, args).catch((e) => ({ result: { isError: true, content: [{ text: e.message }] }, requests: [] }));
    assert.match(text(result), /needs a source image: image \(a local file\) or image_asset_identifier/, name);
    assert.equal(requests.length, 0, name);
  }
  const { buildRequest } = await import("../dist/tools/family.js");
  const { operationById } = await import("../dist/spec/operations.js");
  await assert.rejects(() => buildRequest(operationById("post_remove_background_v2"), {}), /post_remove_background_v2 sent as json refuses the input:\nimage_asset_identifier/);
});

test("a completed remove-background generation (an image without prompt or seed, as the API lists it) is saved like any image", async () => {
  const handler = (req, _n, api) => {
    if (req.url.startsWith("/img/")) return { status: 200, headers: { "content-type": "image/png" }, body: PNG };
    if (req.method === "POST") return accepted("bg1");
    return { json: { generation_id: "bg1", status: "completed", created: "2026-10-07T00:00:00Z", data: [{ object_type: "image.without-prompt-or-seed", url: `${api.base}/img/fg.png`, resolution: "1024x1024", is_image_safe: true }] } };
  };
  const { result, ctx } = await call("ideogram_remove_background", { image: png }, handler);
  assert.equal(result.isError, undefined, text(result));
  assert.match(text(result), /1 of 1 image\(s\) saved\./);
  assert.doesNotMatch(text(result), /Seed:/);
  assert.equal((await readdir(ctx.outputDir)).length, 1);
});

test("a layerized design generation shows the design's own link and its editable page beside the base image", async () => {
  const done = { generation_id: "L3", status: "completed", created: "2026-10-07T00:00:00Z", data: [{ object_type: "layerized_design.generation", base_image_url: null, url: "https://ideogram.ai/d/L3.psd", html_url: "https://ideogram.ai/d/L3.html", is_image_safe: true, resolution: "1024x1024", seed: 2, text_blocks: [] }] };
  const { result } = await call("ideogram_generation", { generation_id: "L3", wait_s: 0 }, () => ({ json: done }));
  assert.match(text(result), /Design 1: https:\/\/ideogram\.ai\/d\/L3\.psd/);
  assert.match(text(result), /Editable page of design 1: https:\/\/ideogram\.ai\/d\/L3\.html/);
  assert.equal(result.isError, undefined, "a safe design with a link is a success even without a base image");
  assert.match(text(result), /Design 1: no base image listed by Ideogram/);
  assert.doesNotMatch(text(result), /withheld/);
});

test("the source rule is one rule: ideogram_api refuses a precise edit without a source as the curated tool does; a quote too", async () => {
  const { result, requests } = await call("ideogram_api", { operation: "post_precise_edit_image_v2_ideogram45", params: { body: { prompt: "x" } }, files: [{ field: "reference_images", path: png }] }).catch((e) => ({ result: { isError: true, content: [{ text: e.message }] }, requests: [] }));
  assert.match(text(result), /post_precise_edit_image_v2_ideogram45 needs a source image/);
  assert.equal(requests.length, 0);
  const quote = await call("ideogram_quote", { tool: "ideogram_remove_background", arguments: {} }).catch((e) => e);
  assert.match(quote.message, /ideogram_remove_background needs a source image/);
});

test("the schema inliner ends on a cycle of aliases and keeps the $ref that cannot be inlined", async () => {
  const { inlineSmallDefinitions } = await import("../dist/tools/family.js");
  const json = { oneOf: [{ type: "object", properties: { a: { $ref: "#/definitions/x" } } }], definitions: { x: { $ref: "#/definitions/y" }, y: { $ref: "#/definitions/x" }, z: { type: "string" } } };
  inlineSmallDefinitions(json);
  const refs = JSON.stringify(json).match(/#\/definitions\/[a-z]/g) ?? [];
  for (const ref of refs) assert.ok(ref.replace("#/definitions/", "") in json.definitions, `${ref} resolves`);
  assert.equal("z" in json.definitions, false, "an unreferenced short definition is dropped");
});
