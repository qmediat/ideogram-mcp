// The derived operation table and the reviewed overlay: families and async kinds from the facts, the quote
// allow-list, the PriceQuote binding, the per-operation file limits as the specification states them, the semantic
// constraints (each anchored to its phrase in the specification, both ways) and the support table.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { OPERATIONS, operationById, isExposable } = await import("../dist/spec/operations.js");
const { quoteAllowed, quoteRefusal, responseSchemaFor, fileLimitsOf, CONSTRAINTS, constraintViolations, MIB, UNSTATED_FILE_BYTES } =
  await import("../dist/spec/overlay.js");
const { supportOf, servedByRawCall } = await import("../dist/spec/support.js");

const spec = JSON.parse(readFileSync(new URL("../spec/openapi.json", import.meta.url), "utf8"));
const op = (id) => {
  const found = operationById(id);
  assert.ok(found, `${id} exists`);
  return found;
};

function fieldDescription(operation, field) {
  const item = spec.paths[operation.path][operation.method.toLowerCase()];
  const ref = Object.values(item.requestBody?.content ?? {})[0]?.schema?.$ref;
  const property = ref ? spec.components.schemas[ref.split("/").pop()].properties?.[field] : undefined;
  if (!property) return null;
  const own = property.description ?? "";
  const target = property.$ref ?? property.allOf?.[0]?.$ref;
  return `${own} ${target ? (spec.components.schemas[target.split("/").pop()].description ?? "") : ""}`;
}

test("every exposable operation has a family and its generated schemas; none outside the exposable classes does", () => {
  for (const o of OPERATIONS) {
    assert.equal(o.family !== null, isExposable(o), o.key);
    if (!isExposable(o)) continue;
    assert.ok(o.schemas.response, `${o.key} has a response schema`);
    if (o.body !== "none") assert.ok(o.schemas.body, `${o.key} has a body schema`);
    for (const media of o.facts.bodies) assert.ok(o.schemas.bodyByMedia[media], `${o.key} has a ${media} body schema`);
  }
});

test("families, models, body media and async kinds come from the path and the facts", () => {
  const generate = op("post_generate_image_v2_ideogram45");
  assert.deepEqual([generate.family, generate.model, generate.body, generate.async, generate.dryRun], ["generate", "ideogram-4-5", "multipart", "optional", true]);
  const ideogram2 = op("post_generate_image_v2_ideogram_v2");
  assert.equal(ideogram2.body, "json", "an operation without multipart is sent as JSON");
  assert.equal(op("post_replace_background_ideogram_v3").async, "only", "a 200 that is only a generation id is an acknowledgement");
  assert.equal(op("post_describe_image_ideogram_v3").async, "none");
  assert.equal(op("post_generate_video_seed_dance2_text_to_video").family, "video_text");
  assert.equal(op("post_edit_video_minimax_h3_reference_to_video").family, "video_reference");
  assert.equal(op("train_model_v4").family, "training");
  assert.equal(op("post_generate_image_v45").family, "generate");
  assert.equal(op("get_generation_v2").family, "generation");
});

test("the body schema follows the media sent: remove-background takes a file by multipart, an asset by JSON", () => {
  const removeBackground = op("post_remove_background_v2");
  assert.equal(removeBackground.schemas.bodyByMedia.multipart.safeParse({ image: "a.png" }).success, true);
  assert.equal(removeBackground.schemas.bodyByMedia.json.safeParse({}).success, false, "JSON needs image_asset_identifier");
});

test("only an operation that declares dry_run may be quoted; describe may not", () => {
  assert.equal(quoteAllowed(op("post_generate_image_v2_ideogram_v3")), true);
  assert.equal(quoteAllowed(op("post_describe_image_ideogram_v3")), false);
  assert.match(quoteRefusal(op("post_describe_image_ideogram_v3")), /does not declare dry_run/);
  assert.match(quoteRefusal(op("post_add_credits_for_api")), /not exposed/);
  const declared = OPERATIONS.filter((o) => isExposable(o) && o.dryRun).length;
  assert.equal(OPERATIONS.filter(quoteAllowed).length, declared);
});

test("a dry run is validated against PriceQuote, a real call against the operation's response", () => {
  const generate = op("post_generate_image_v2_ideogram_v3");
  const quote = { object: "price_quote", billing_identifier: "ideogram-3", quantity: 1, usd_micros: 60000, credit_millis: 60, qualifier: "exact" };
  assert.equal(responseSchemaFor(generate, true).safeParse(quote).success, true);
  assert.equal(responseSchemaFor(generate, false).safeParse(quote).success, false);
  assert.equal(responseSchemaFor(generate, true).safeParse({ generation_id: "g", seed: 1 }).success, false);
});

test("file limits are per operation and field, as the descriptions state them", () => {
  const limit = (id, field) => fileLimitsOf(op(id)).find((l) => l.field === field);
  assert.equal(limit("post_describe_image_ideogram_v3", "image").maxBytes, 10 * MIB, "describe: max 10MB");
  assert.equal(limit("post_remix_image_v2_ideogram_v3", "image").maxBytes, 50 * MIB, "remix: max 50MB");
  assert.equal(limit("post_generate_image_v2_ideogram45", "images").maxBytes, 25 * MIB, "4.5: max 25MB each");
  assert.equal(limit("post_generate_image_v2_ideogram45", "images").maxItems, 5);
  const mask = limit("post_inpaint_image_v2_ideogram_v3", "mask");
  assert.deepEqual([mask.stated, mask.maxBytes], [false, UNSTATED_FILE_BYTES], "an unstated limit is said to be unstated");
});

test("each constraint's anchor phrase is stated by exactly the operations it lists", () => {
  for (const c of CONSTRAINTS) {
    const stating = OPERATIONS.filter((o) => isExposable(o) && c.anchor.phrase.test(fieldDescription(o, c.anchor.field) ?? "")).map((o) => o.id);
    assert.deepEqual([...c.operations].sort(), stating.sort(), c.id);
  }
});

test("the constraints refuse what the API refuses and pass what it takes", () => {
  const cases = [
    ["post_generate_image_v2_ideogram_v3", { prompt: "x", resolution: "1024x1024", aspect_ratio: "1x1" }, /resolution and aspect_ratio/],
    ["post_remix_image_v2_ideogram_v3", { prompt: "x", image: "a.png", image_asset_identifier: { asset_type: "UPLOAD", asset_id: "a" } }, /alternatives/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", mask: "m.png" }, /mask needs the source image/],
    ["post_generate_image_v2_ideogram_v3", { prompt: "x", style_preset: "BRIGHT_ART", style_codes: ["ABCD1234"] }, /style_preset/],
    ["post_inpaint_image_v2_ideogram_v3", { prompt: "x", image: "a.png" }, /inpaint needs/],
    ["post_generate_image_v2_ideogram_v3_character", { prompt: "x", character_reference_mask: "m.png" }, /character_reference_images/],
    ["post_generate_image_v2_ideogram45", { prompt: "x", size: "source" }, /size "source"/],
  ];
  for (const [id, fields, message] of cases) {
    const violations = constraintViolations(op(id), fields);
    assert.equal(violations.length, 1, `${id}: ${JSON.stringify(fields)}`);
    assert.match(violations[0], message);
  }
  const passing = [
    ["post_generate_image_v2_ideogram_v3", { prompt: "x", resolution: "1024x1024" }],
    ["post_inpaint_image_v2_ideogram_v3", { prompt: "x", image: "a.png", mask_asset_identifier: { asset_type: "UPLOAD", asset_id: "m" } }],
    ["post_generate_image_v2_ideogram45", { prompt: "x", size: "source", images: ["a.png"] }],
    ["post_generate_image_v2_ideogram_v4", { prompt: "x", resolution: "1024x1024", aspect_ratio: "1x1" }],
  ];
  for (const [id, fields] of passing) assert.deepEqual(constraintViolations(op(id), fields), [], id);
});

test("the support table: the seven families' documented models and the generation lookup are curated", () => {
  assert.equal(supportOf(op("post_generate_image_v2_ideogram45")), "curated");
  assert.equal(supportOf(op("get_generation_v2")), "curated");
  assert.equal(supportOf(op("post_precise_edit_image_v2_ideogram45")), "raw");
  assert.equal(supportOf(op("post_reframe_image_auto")), "raw", "a spec-only image operation is raw (opt-in at call time)");
  assert.equal(supportOf(op("post_generate_video_seed_dance2_text_to_video")), "planned");
  assert.equal(supportOf(op("get_account_usage")), "planned");
  assert.equal(supportOf(op("post_generate_image")), "unsupported", "legacy");
  assert.equal(servedByRawCall(op("post_ad_resizer")), false);
  const counts = {};
  for (const o of OPERATIONS) counts[supportOf(o)] = (counts[supportOf(o)] ?? 0) + 1;
  assert.deepEqual(counts, { curated: 40, raw: 7, planned: 80, unsupported: 73 });
});
