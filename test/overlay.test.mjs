// The derived operation table and the reviewed overlay: families and async kinds from the facts, the quote
// allow-list, the PriceQuote binding, the per-operation file limits as the specification states them, the semantic
// constraints (each anchored to its phrase in the specification, both ways) and the support table.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { OPERATIONS, operationById, isExposable } = await import("../dist/spec/operations.js");
const { quoteAllowed, quoteRefusal, responseSchemaFor, fileLimitsOf, CONSTRAINTS, constraintViolations, MB, requestLimitOf, requestBytesRefusal, UNSTATED_REQUEST_BYTES, UNSTATED_FILE_BYTES, FONT_FILE_FIELDS } =
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
  // the specification's own fact, read from the document: the exposable operations whose parameters include query dry_run
  const declaresDryRun = (o) => (spec.paths[o.path][o.method.toLowerCase()].parameters ?? []).some((p) => (p.$ref ? spec.components.parameters[p.$ref.split("/").pop()] : p).name === "dry_run");
  const fromSpec = OPERATIONS.filter((o) => isExposable(o) && declaresDryRun(o)).map((o) => o.id).sort();
  assert.ok(fromSpec.length >= 40, `${fromSpec.length} operations declare dry_run`);
  assert.deepEqual(OPERATIONS.filter(quoteAllowed).map((o) => o.id).sort(), fromSpec);
});

test("a dry run is validated against PriceQuote, a real call against the operation's response", () => {
  const generate = op("post_generate_image_v2_ideogram_v3");
  const quote = { object: "price_quote", billing_identifier: "ideogram-3", quantity: 1, usd_micros: 60000, credit_millis: 60, qualifier: "exact" };
  assert.equal(responseSchemaFor(generate).safeParse(quote).success, false, "a quote is not the operation's response");
  assert.equal(responseSchemaFor(generate).safeParse({ generation_id: "g", seed: 1 }).success, true, "the operation's response");
});

test("file limits are per operation and field, as the descriptions state them", () => {
  const limit = (id, field) => fileLimitsOf(op(id)).find((l) => l.field === field);
  assert.equal(limit("post_describe_image_ideogram_v3", "image").maxBytes, 10 * MB, "describe: max 10MB (decimal)");
  assert.equal(limit("post_remix_image_v2_ideogram_v3", "image").maxBytes, 50 * MB, "remix: max 50MB");
  assert.equal(limit("post_generate_image_v2_ideogram45", "images").maxBytes, 25 * MB, "4.5: max 25MB each");
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
    ["post_generate_image_v2_ideogram_v3_character", { prompt: "x", character_reference_mask: "m.png", character_reference_collection_id: "c" }, /character_reference_images/],
    ["post_generate_image_v2_ideogram_v3_character", { prompt: "x" }, /character model needs a character reference/],
    ["post_remix_image_v2_ideogram_v3_character", { prompt: "x", image: "a.png" }, /character model needs a character reference/],
    ["post_generate_image_v2_ideogram45", { prompt: "x", size: "source" }, /size "source"/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", reference_image_asset_identifiers: [{ asset_type: "UPLOAD", asset_id: "r" }] }, /needs the edited image by reference too/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", mask: "m.png", reference_images: ["1.png", "2.png", "3.png", "4.png"] }, /at most three/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image_asset_identifier: { asset_type: "UPLOAD", asset_id: "a" }, context_window: "none" }, /context_window needs the image/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "auto" }, /"auto" needs a mask/],
    ["post_remove_object_from_v2_assets", { image: "a.png" }, /remove object needs the source .* and the mask/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image_asset_identifier: { asset_type: "UPLOAD", asset_id: "a" }, reference_images: ["r.png"], reference_image_asset_identifiers: [{ asset_type: "UPLOAD", asset_id: "r" }] }, /reference_images and reference_image_asset_identifiers are alternatives/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "0,0,10,10" }, /each side at least 256 px/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "0,0,256,2048" }, /aspect ratio/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "0,0,2048,2049" }, /4194304 pixels/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "512,1024,256,3072" }, /max above min/],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "a,b,c,d" }, /whole numbers/],
    ["post_layerize_design_ideogram_v3", { image: "a.png", font_candidate_files: ["1.ttf", "2.ttf", "3.ttf", "4.ttf", "5.ttf", "6.ttf"] }, /at most 5 files/],
    ["post_remove_object_from_v2_assets", { mask_asset_identifier: { asset_type: "UPLOAD", asset_id: "m" } }, /remove object needs the source/],
  ];
  for (const [id, fields, message] of cases) {
    const violations = constraintViolations(op(id), fields);
    assert.equal(violations.length, 1, `${id}: ${JSON.stringify(fields)}`);
    assert.match(violations[0], message);
  }
  // references by reference with a mask: two rules fire (the mask also needs the image as a file), both said
  const maskAndReferences = constraintViolations(op("post_precise_edit_image_v2_ideogram45"), { prompt: "x", image_asset_identifier: { asset_type: "UPLOAD", asset_id: "a" }, reference_image_asset_identifiers: [{ asset_type: "UPLOAD", asset_id: "r" }], mask: "m.png" });
  assert.ok(maskAndReferences.some((v) => /cannot be combined with mask/.test(v)), maskAndReferences.join("; "));
  const passing = [
    ["post_generate_image_v2_ideogram_v3", { prompt: "x", resolution: "1024x1024" }],
    ["post_inpaint_image_v2_ideogram_v3", { prompt: "x", image: "a.png", mask_asset_identifier: { asset_type: "UPLOAD", asset_id: "m" } }],
    ["post_generate_image_v2_ideogram45", { prompt: "x", size: "source", images: ["a.png"] }],
    ["post_generate_image_v2_ideogram_v4", { prompt: "x", resolution: "1024x1024", aspect_ratio: "1x1" }],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", mask: "m.png", reference_images: ["1.png", "2.png", "3.png"], context_window: "auto" }],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image_asset_identifier: { asset_type: "UPLOAD", asset_id: "a" }, reference_image_asset_identifiers: [{ asset_type: "UPLOAD", asset_id: "r" }] }],
    ["post_remove_object_from_v2_assets", { image: "a.png", mask_asset_identifier: { asset_type: "UPLOAD", asset_id: "m" } }],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "512,1024,2048,3072" }],
    ["post_precise_edit_image_v2_ideogram45", { prompt: "x", image: "a.png", context_window: "0,0,2048,2048" }],
    ["post_layerize_design_ideogram_v3", { image: "a.png", font_candidate_files: ["1.ttf", "2.ttf", "3.ttf", "4.ttf", "5.ttf"] }],
    ["post_generate_image_v2_ideogram_v3_character", { prompt: "x", character_reference_collection_id: "c" }],
    ["post_inpaint_image_v2_ideogram_v3_character", { prompt: "x", image: "a.png", mask: "m.png", character_reference_asset_identifiers: [{ asset_type: "UPLOAD", asset_id: "a" }] }],
  ];
  for (const [id, fields] of passing) assert.deepEqual(constraintViolations(op(id), fields), [], id);
});

test("the support table: the eleven image families' documented models and the generation lookup are curated", () => {
  assert.equal(supportOf(op("post_generate_image_v2_ideogram45")), "curated");
  assert.equal(supportOf(op("get_generation_v2")), "curated");
  for (const id of ["post_precise_edit_image_v2_ideogram45", "post_remove_background_v2", "post_remove_object_from_v2_assets", "post_layerize_design_ideogram_v3"]) {
    assert.equal(supportOf(op(id)), "curated", `${id} is curated since 2.1.0`);
  }
  assert.equal(supportOf(op("post_reframe_image_auto")), "raw", "a spec-only image operation is raw (opt-in at call time)");
  assert.equal(supportOf(op("post_generate_video_seed_dance2_text_to_video")), "planned");
  assert.equal(supportOf(op("get_account_usage")), "curated", "the account listings are curated since 2.2.0");
  assert.equal(supportOf(op("get_asset_reference_usage")), "raw", "a spec-only operation of a curated family is raw (opt-in at call time)");
  assert.equal(supportOf(op("get_webhook_signing_jwks")), "planned", "v1-only stays for step 5");
  assert.equal(supportOf(op("train_model_v4_advanced")), "curated", "the training tools cover it since 2.3.0");
  assert.equal(supportOf(op("train_dataset_model")), "raw", "the one training operation no tool covers is raw");
  assert.equal(supportOf(op("post_generate_image")), "unsupported", "legacy");
  assert.equal(servedByRawCall(op("post_ad_resizer")), false);
  const counts = {};
  for (const o of OPERATIONS) counts[supportOf(o)] = (counts[supportOf(o)] ?? 0) + 1;
  assert.deepEqual(counts, { curated: 57, raw: 6, planned: 64, unsupported: 73 });
});

test("a dataset upload is the one operation whose file field names the ZIP archives and caption sidecars", async () => {
  const { DATASET_UPLOAD_OPERATIONS } = await import("../dist/spec/overlay.js");
  const stating = OPERATIONS.filter((o) => isExposable(o) && o.facts.fileFields.some((f) => /ZIP archives containing images and captions/.test(fieldDescription(o, f.name) ?? ""))).map((o) => o.id);
  assert.deepEqual(new Set(stating), DATASET_UPLOAD_OPERATIONS);
});

test("a font field is the one whose description names the font formats; every other file field takes images", () => {
  const fileFields = OPERATIONS.filter(isExposable).flatMap((o) => o.facts.fileFields.map((f) => ({ op: o, field: f.name })));
  const fonts = fileFields.filter(({ op: o, field }) => /\.ttf, \.otf, \.woff, \.woff2/.test(fieldDescription(o, field) ?? ""));
  assert.ok(fonts.length > 0, "the specification states a font field");
  assert.deepEqual(new Set(fonts.map((f) => f.field)), FONT_FILE_FIELDS);
  for (const { op: o, field } of fileFields) {
    if (FONT_FILE_FIELDS.has(field)) continue;
    assert.doesNotMatch(fieldDescription(o, field) ?? "", /\.ttf/, `${o.id}.${field} is an image field`);
  }
});

test("the whole request is bounded: the specification's cap where it states one, this server's 100 MB where it does not", () => {
  const v2 = op("post_generate_image_v2_gpt_image2"); // 16 × 25 MB by field, no stated request cap
  assert.deepEqual(requestLimitOf(v2), { maxBytes: UNSTATED_REQUEST_BYTES, stated: false });
  assert.equal(UNSTATED_REQUEST_BYTES, 100 * MB);
  assert.equal(requestBytesRefusal(v2, 100 * MB), null);
  assert.match(requestBytesRefusal(v2, 100 * MB + 1), /100\.0 MB; post_generate_image_v2_gpt_image2 takes at most 100 MB \(this server's cap/);
  const stated = OPERATIONS.find((o) => o.facts.requestMaxBytes !== null);
  assert.ok(stated, "the snapshot states a request cap somewhere (the v1 style-reference prose)");
  assert.deepEqual(requestLimitOf(stated), { maxBytes: 50 * MB, stated: true });
  assert.match(requestBytesRefusal(stated, 50 * MB + 1), /the limit Ideogram states for this request/);
});
