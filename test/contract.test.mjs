// The contract between the generated schemas and the provider: the specification's own response examples of every
// operation this release serves parse with the generated zod schemas (the prose rule "an item without object_type is an
// image" applied first), and the bodies the live API really sends (captured 2026-10-07, values anonymised) parse too —
// the spec's example writes `created` with a Z, the API with "+00:00" and microseconds, which the generator's default
// z.iso.datetime() rejected (scripts/spec-generate.mjs: acceptOffsets). The provider's examples that contradict their
// own schema are listed, each with its reason: a fixed or a newly broken example changes this list and fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const spec = JSON.parse(readFileSync(new URL("../spec/openapi.json", import.meta.url), "utf8"));
const { OPERATIONS, generatedComponent } = await import("../dist/spec/operations.js");
const { supportOf } = await import("../dist/spec/support.js");
const { withImageKind } = await import("../dist/lifecycle.js");

const schemaOf = (name) => generatedComponent(name); // the generator's export names are a case transform of the component names

/** The provider's examples that do not match the provider's schemas (not this server's doing). */
const EXAMPLES_CONTRADICTING_THEIR_SCHEMA = {
  GenerateImageIdeogram45Response: "generation_kind is null in the example, an enum (sampling | workflow) in the schema",
  PreciseEditImageIdeogram45Response: "generation_kind is null in the example, an enum (sampling | workflow) in the schema",
  ToolRemixResponse: 'seed is "" in the example, an integer in the schema',
};

test("every served operation's response example parses with its generated schema, except the provider's own contradictions", () => {
  const served = OPERATIONS.filter((op) => ["curated", "raw"].includes(supportOf(op)));
  const seen = new Set();
  const failing = {};
  for (const op of served) {
    const name = op.facts.responseSchema;
    const example = name === null ? undefined : spec.components.schemas[name]?.example;
    if (example === undefined || seen.has(name)) continue;
    seen.add(name);
    const schema = schemaOf(name);
    assert.ok(schema, `${name} is generated`);
    const body = name === "GenerationResponse" ? withImageKind(example) : example;
    const result = schema.safeParse(body);
    if (!result.success) failing[name] = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  assert.ok(seen.size >= 40, `${seen.size} response schemas with an example`);
  assert.deepEqual(Object.keys(failing).sort(), Object.keys(EXAMPLES_CONTRADICTING_THEIR_SCHEMA).sort(), JSON.stringify(failing, null, 1));
});

test("the spec's GenerationResponse example (items without object_type) is a completed image generation once the prose rule is applied", () => {
  const example = spec.components.schemas.GenerationResponse.example;
  assert.equal(example.data[0].object_type, undefined, "the example omits object_type");
  assert.equal(schemaOf("GenerationResponse").safeParse(example).success, false, "the discriminator alone rejects it");
  const parsed = schemaOf("GenerationResponse").safeParse(withImageKind(example));
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.data[0].object_type, "image.generation");
});

test("the bodies the live API sends parse: acceptance, a completed poll with a +00:00 offset, a synchronous result, a price quote", () => {
  const acceptance = { generation_id: "A", seed: 1 };
  assert.equal(schemaOf("GenerateImageZImageResponse").safeParse(acceptance).success, true);
  const completed = {
    created: "2026-10-07T15:09:24.239178+00:00", generation_id: "A", status: "completed", response_type: "url",
    data: [{ asset_id: null, is_image_safe: true, object_type: "image.generation", prompt: "p", resolution: "1024x1024", seed: 1, url: "https://ideogram.ai/api/images/a.png" }],
  };
  const poll = schemaOf("GenerationResponse").safeParse(completed);
  assert.equal(poll.success, true, JSON.stringify(poll.error?.issues));
  const sync = { generation_id: "B", seed: 2, data: [{ url: "https://ideogram.ai/api/images/b.png", prompt: "p", resolution: "1024x1024", is_image_safe: true, seed: 2 }] };
  assert.equal(schemaOf("GenerateImageZImageResponse").safeParse(sync).success, true);
  const quote = { object: "price_quote", billing_identifier: "z_image_generation", quantity: 1, usd_micros: 5000, credit_millis: 500, qualifier: "exact" };
  assert.equal(schemaOf("PriceQuote").safeParse(quote).success, true);
});
