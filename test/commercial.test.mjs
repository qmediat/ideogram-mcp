// The single-operation tools of 2.5.0: each runs its one operation with the operation's own fields (no model input),
// the commercial tools as generations (accepted → pending or saved), the v1 utilities with their own answers: a JSON
// prompt printed, a provenance record printed, the detected layers beside the saved base image, a snapped mask saved
// from an image/png answer. Against the fake API; nothing live.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { z } from "zod/v4";
import { startFakeApi, testContext, tool, PNG } from "./support/fake-api.mjs";

const dir = await mkdtemp(join(tmpdir(), "ideogram-commercial-"));
const png = join(dir, "ad.png");
await writeFile(png, PNG);
after(() => rm(dir, { recursive: true, force: true }));

const accepted = (id) => ({ json: { generation_id: id, created: "2026-10-07T00:00:00Z" } });
const pending = (id) => ({ json: { generation_id: id, status: "pending", created: "2026-10-07T00:00:00Z" } });
const text = (r) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

async function call(name, args, handler = (req) => (req.method === "POST" ? accepted("c1") : pending("c1"))) {
  const api = await startFakeApi((req, n) => handler(req, n, api));
  try {
    const ctx = await testContext(api.base, join(dir, `out-${Math.random().toString(16).slice(2)}`));
    const result = await (await tool(name)).handler(ctx, args);
    return { result, requests: api.requests, ctx };
  } finally {
    await api.close();
  }
}

test("a commercial tool runs its one operation with its own fields: no model input, foreign fields refused by name, the generation accepted", async () => {
  const schema = z.toJSONSchema((await tool("ideogram_ad_resizer")).inputSchema, {
    io: "input",
    unrepresentable: "any",
  });
  assert.equal(schema.properties.model, undefined, "a single-operation tool advertises no model");
  assert.ok(
    schema.properties.resolution && schema.properties.platform && schema.properties.inline_images,
    "its own fields, each with our sentence, and the inline option",
  );
  assert.match(schema.properties.platform.description, /safe zone/);
  assert.equal(schema.oneOf.length, 1, "one variant");
  assert.ok(
    schema.oneOf[0].properties.resolution.enum.includes("1080x1920"),
    "the variant carries the operation's own enum",
  );
  const run = await call("ideogram_ad_resizer", { image: png, resolution: "1080x1080", platform: "meta", wait_s: 0 });
  assert.equal(run.requests[0].url, "/v2/tool/ad-resizer");
  assert.match(run.requests[0].body.toString("latin1"), /name="image"; filename="image.png"/);
  assert.match(
    run.requests[0].body.toString("latin1"),
    /name="private"\r\n\r\ntrue/,
    "private defaults to true as on every curated call",
  );
  assert.match(text(run.result), /Accepted: generation c1 is still running/);
  const foreign = await call("ideogram_ad_resizer", { image: png, resolution: "1080x1080", num_videos: 2 }).catch(
    (e) => e,
  );
  assert.match(foreign.message, /`num_videos` is not a parameter of ideogram_ad_resizer \(post_ad_resizer\)/);
  const withModel = await call("ideogram_ad_resizer", { image: png, resolution: "1080x1080", model: "x" }).catch(
    (e) => e,
  );
  assert.match(withModel.message, /runs one operation \(post_ad_resizer\); it takes no model/);
  const badSize = await call("ideogram_ad_resizer", { image: png, resolution: "1024x1024" }).catch((e) => e);
  assert.match(badSize.message, /ideogram_ad_resizer refuses the input:\nresolution: Invalid option/);
  const both = await call("ideogram_colorways", {
    image: png,
    image_asset_identifier: { asset_type: "UPLOAD", asset_id: "AAAAAAAAAAAAAAAAAAAAAA" },
    colors: ["#B3202C"],
    masks: [png],
  }).catch((e) => e);
  assert.match(
    both.message,
    /image and image_asset_identifier are alternatives/,
    "the shared rules reach the commercial tools",
  );
  const localized = await call("ideogram_ad_localizer", {
    image: png,
    language: "de",
    exact_copy: "Sale => Angebot",
    wait_s: 0,
  });
  assert.equal(localized.requests[0].url, "/v2/tool/ad-localizer");
  assert.match(localized.requests[0].body.toString("latin1"), /name="exact_copy"\r\n\r\nSale => Angebot/);
  const quote = await call(
    "ideogram_quote",
    { tool: "ideogram_colorways", arguments: { image: png, colors: ["#B3202C"], masks: [png] } },
    () => ({
      json: {
        object: "price_quote",
        billing_identifier: "colorways",
        quantity: 1,
        usd_micros: 100000,
        credit_millis: 100,
        qualifier: "exact",
      },
    }),
  );
  assert.equal(quote.requests[0]?.url, "/v2/tool/colorways?dry_run=true", text(quote.result));
  const noDryRun = await call("ideogram_quote", {
    tool: "ideogram_ad_variations",
    arguments: { image: png, variation_type: "people" },
  });
  assert.match(
    text(noDryRun.result),
    /post_ad_variations does not declare dry_run/,
    "a commercial tool without a dry run is refused locally, never sent",
  );
  assert.equal(noDryRun.requests.length, 0, "never sent");
  const texts = Object.fromEntries(
    await Promise.all(
      ["ideogram_ad_variations", "ideogram_colorways"].map(async (n) => [n, (await tool(n)).description]),
    ),
  );
  assert.match(
    texts.ideogram_ad_variations,
    /no price quote \(the operation offers no dry run\)/,
    "a tool without a dry run does not promise a quote",
  );
  assert.match(texts.ideogram_colorways, /ideogram_quote prices a call first/);
  const colorSchema = z.toJSONSchema((await tool("ideogram_colorways")).inputSchema, {
    io: "input",
    unrepresentable: "any",
  });
  assert.match(
    colorSchema.properties.aspect_ratio.description,
    /with a colon — 1:1/,
    "the tool family's own sentence for a shared field",
  );
  assert.match(colorSchema.properties.quality.description, /^low, medium or high/);
  const noPhoto = await call("ideogram_ghost_mannequin", { view: "front" }).catch((e) => e);
  assert.match(
    noPhoto.message,
    /ideogram_ghost_mannequin needs at least one garment photo/,
    "the source rule, in the tool's name",
  );
  const bothMasks = await call("ideogram_colorways", {
    image: png,
    colors: ["#B3202C"],
    masks: [png],
    mask_asset_identifiers: [{ asset_type: "UPLOAD", asset_id: "AAAAAAAAAAAAAAAAAAAAAA" }],
  }).catch((e) => e);
  assert.match(bothMasks.message, /exactly one of masks and mask_asset_identifiers/);
  const noMask = await call("ideogram_colorways", { image: png, colors: ["#B3202C"] }).catch((e) => e);
  assert.match(
    noMask.message,
    /exactly one of masks and mask_asset_identifiers/,
    "neither is refused too: the API would bill an invalid request otherwise",
  );
  const unpaired = await call("ideogram_colorways", { image: png, colors: ["#B3202C", "#000000"], masks: [png] }).catch(
    (e) => e,
  );
  assert.match(unpaired.message, /as many colors as masks/);
  const speed = await call("ideogram_ad_resizer", {
    image: png,
    resolution: "1080x1920",
    rendering_speed: "TURBO",
  }).catch((e) => e);
  assert.match(
    speed.message,
    /`rendering_speed` is not a parameter of ideogram_ad_resizer/,
    "the 1.x adapter does not touch a single-operation tool",
  );
  assert.match(text(quote.result), /0\.100000 USD exact/);
});

test("the v1 utilities answer in their own shapes: a JSON prompt, a provenance record, the detected layers beside the saved base image", async () => {
  const example = JSON.parse(await readFile(new URL("../spec/openapi.json", import.meta.url), "utf8")).components
    .schemas.MagicPromptV4Response.example; // the provider's own example: schema-complete
  const magic = await call("ideogram_magic_prompt", { text_prompt: "a lighthouse at dawn" }, () => ({ json: example }));
  assert.equal(magic.requests[0].url, "/v1/ideogram-v4/magic-prompt");
  assert.deepEqual(JSON.parse(magic.requests[0].body.toString()), { text_prompt: "a lighthouse at dawn" });
  assert.match(
    text(magic.result),
    /^Aspect ratio: 1x1\nJSON prompt:\n\{\n  "compositional_deconstruction": \{/,
    "the ratio the model picked is said",
  );
  const noPrice = await call("ideogram_quote", { tool: "ideogram_magic_prompt", arguments: { text_prompt: "x" } });
  assert.equal(noPrice.result.isError, true, "no dry run on the v1 utility");
  assert.equal(noPrice.requests.length, 0, "never sent");
  const prov = await call("ideogram_provenance", { content: png }, () => ({
    json: {
      provenance_detected: true,
      provider: "Ideogram",
      system_version: "3.0",
      generation_id: "g1",
      created_at: "2026-10-01T00:00:00Z",
      validation_state: "VALID",
    },
  }));
  assert.equal(prov.requests[0].url, "/v1/provenance/verify");
  assert.match(prov.requests[0].body.toString("latin1"), /name="content"; filename="content.png"/);
  assert.match(text(prov.result), /"provenance_detected": true/);
  const logos = await call("ideogram_layerize_logos", { design_image: png, reference_images: [png] }, (req, _n, api) =>
    req.url === "/b/base.png"
      ? { status: 200, headers: { "content-type": "image/png" }, body: PNG }
      : {
          json: {
            base_image_url: `${api.base}/b/base.png`,
            layers: [{ ref_id: "REF_0", x: 0, y: 0, width: 10, height: 10 }],
          },
        },
  );
  assert.equal(logos.requests[0].url, "/v1/layerize-logos");
  assert.match(
    logos.requests[0].body.toString("latin1"),
    /name="design_image"; filename="design_image.png"[\s\S]*name="reference_images"; filename="reference_images.png"/,
  );
  assert.match(
    text(logos.result),
    /1 of 1 base image\(s\) saved \(1 design\(s\)\)\.\nSaved: .*\.png[\s\S]*Layers of design 1 \(1\):\n\[\n  \{\n    "ref_id": "REF_0"/,
    "logo layers are layers, not text blocks",
  );
});

test("ideogram_snap_mask saves the PNG the operation answers with; an answer of another type or a failure is said", async () => {
  const snapped = await call("ideogram_snap_mask", { image: png, mask: png }, () => ({
    status: 200,
    headers: { "content-type": "image/png" },
    body: PNG,
  }));
  assert.equal(snapped.requests[0].url, "/v1/snap-mask");
  assert.match(
    snapped.requests[0].body.toString("latin1"),
    /name="image"; filename="image.png"[\s\S]*name="mask"; filename="mask.png"/,
  );
  assert.match(text(snapped.result), /^Saved: .*\.png \(0\.00 MB, image\/png\)$/);
  assert.equal((await readdir(snapped.ctx.outputDir)).length, 1);
  assert.equal(snapped.result.content.length, 1, "no inline content unless asked");
  const inline = await call("ideogram_snap_mask", { image: png, mask: png, inline_images: true }, () => ({
    status: 200,
    headers: { "content-type": "image/png" },
    body: PNG,
  }));
  assert.equal(inline.result.content.length, 2, "asked, the mask comes back as image content too");
  assert.equal(inline.result.content[1].type, "image");
  assert.equal(inline.result.content[1].mimeType, "image/png");
  const snapSchema = z.toJSONSchema((await tool("ideogram_snap_mask")).inputSchema, {
    io: "input",
    unrepresentable: "any",
  });
  assert.equal(snapSchema.properties.wait_s, undefined, "a synchronous file answer takes no wait");
  assert.doesNotMatch(
    snapSchema.properties.image.description,
    /asset/,
    "snap mask's image sentence names no asset form",
  );
  for (const n of ["ideogram_magic_prompt", "ideogram_provenance", "ideogram_layerize_logos"])
    assert.equal(
      z.toJSONSchema((await tool(n)).inputSchema, { io: "input", unrepresentable: "any" }).properties.wait_s,
      undefined,
      `${n} answers within the call: no wait_s`,
    );
  assert.ok(
    z.toJSONSchema((await tool("ideogram_ad_resizer")).inputSchema, { io: "input", unrepresentable: "any" }).properties
      .wait_s,
    "a job keeps its wait",
  );
  const magicSchema = z.toJSONSchema((await tool("ideogram_magic_prompt")).inputSchema, {
    io: "input",
    unrepresentable: "any",
  });
  assert.match(
    magicSchema.properties.aspect_ratio.description,
    /AUTO .* with an x/,
    "magic prompt's own aspect sentence, not the tool family's colon",
  );
  assert.match(
    (await tool("ideogram_snap_mask")).description,
    /as is for ideogram_remove_object \(white = the region to remove\)[\s\S]*invert it for ideogram_inpaint/,
    "the mask colours as the two operations define them",
  );
  assert.ok(snapSchema.properties.inline_images, "but it can be returned inline");
  let n429 = 0;
  const retried = await call("ideogram_snap_mask", { image: png, mask: png }, () =>
    n429++ === 0
      ? { status: 429, headers: { "retry-after": "0" }, json: { error: "slow down" } }
      : { status: 200, headers: { "content-type": "image/png" }, body: PNG },
  );
  assert.equal(retried.requests.length, 2, "a 429 is retried as on every call");
  assert.match(text(retried.result), /^Saved: /);
  const fileDir = join(dir, "snap-not-a-dir");
  await writeFile(fileDir, "x");
  const api2 = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  try {
    const ctx2 = await testContext(api2.base, join(fileDir, "out"));
    const lost = await (await tool("ideogram_snap_mask")).handler(ctx2, { image: png, mask: png });
    assert.equal(lost.isError, true);
    assert.match(
      text(lost),
      /answered 200; its answer could not be saved: .*\nThe operation ran and answered; the file is lost here\. Sending it again runs it again\./,
      "a lost answer is said as what it is, never as may have run",
    );
    assert.doesNotMatch(text(lost), /MAY have run/);
  } finally {
    await api2.close();
  }
  const json = await call("ideogram_snap_mask", { image: png, mask: png }, () => ({ json: { error: "unexpected" } }));
  assert.equal(json.result.isError, true);
  assert.match(
    text(json.result),
    /^ideogram_snap_mask: post_snap_mask answered 200: Expected an image, got: application\/json\nThe operation ran and answered, with no file this server keeps\.$/,
    "an answer that is no file is said as such, never as a lost file",
  );
  assert.doesNotMatch(text(json.result), /Sending it again runs it again|MAY have run/);
  const refused = await call("ideogram_snap_mask", { image: png, mask: png }, () => ({
    status: 400,
    json: { error: "mask size" },
  }));
  assert.match(text(refused.result), /ideogram_snap_mask: Ideogram API error HTTP_400 \(400\): mask size/);
  assert.doesNotMatch(text(refused.result), /MAY have run/);
  const down = await call("ideogram_snap_mask", { image: png, mask: png }, () => ({
    status: 503,
    json: { error: "down" },
  }));
  assert.match(text(down.result), /MAY have run — send it again only if the answer is not in the output directory/);
  assert.equal(down.requests.length, 1, "a POST that may have run is never resent");
  const raw = await call(
    "ideogram_api",
    {
      operation: "post_snap_mask",
      files: [
        { field: "image", path: png },
        { field: "mask", path: png },
      ],
    },
    () => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }),
  );
  assert.match(
    text(raw.result),
    /^Saved: .*\.png \(0\.00 MB, image\/png\)$/,
    "the raw call saves a file answer the same way",
  );
  const missing = await call("ideogram_snap_mask", { image: png }).catch((e) => e);
  assert.match(
    missing.message,
    /ideogram_snap_mask refuses the input:\nmask: /,
    "both files are required by the schema",
  );
});
