// Prices from the live API, at no cost: every curated operation that offers dry_run is quoted (validated and priced,
// nothing generated, stored or billed) and the quotes are written to docs/PRICES-<date>.md as the price evidence.
// The live part runs only with IDEOGRAM_API_KEY set, against an account with a non-zero balance (a quote may check it).
// The offline part always runs: every curated quotable operation has a minimal request its tool accepts, or the
// reason it is skipped.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { after, test } from "node:test";
import { z } from "zod/v4";

const { FAMILY_TOOLS } = await import("../dist/tools/curated.js");
const { prepare, variantsOf } = await import("../dist/tools/family.js");
const { quoteAllowed } = await import("../dist/spec/overlay.js");
const { quote } = await import("../dist/cost.js");
const { IdeogramClient, defaultClientOptions } = await import("../dist/client.js");

const dir = await mkdtemp(join(tmpdir(), "ideogram-live-"));
after(() => rm(dir, { recursive: true, force: true }));

/** A valid 64×64 grey PNG (signature, IHDR, one IDAT, IEND), so a dry run can validate the image. */
function greyPng(size = 64) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => (buf.reduce((c, b) => crcTable[(c ^ b) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.from([0, 0, 0, size, 0, 0, 0, size, 8, 0, 0, 0, 0]);
  const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size, 128)])));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const image = join(dir, "grey.png");
await writeFile(image, greyPng());

/** Values for the fields a model requires; a required field not listed here makes the model skipped, with its name. */
const MINIMAL = {
  prompt: "a lighthouse at dawn, flat illustration",
  image,
  mask: image,
  images: [image],
  character_reference_images: [image],
  resolution: "1024x1024",
  aspect_ratio: "16:9",
};

function minimalArguments(spec, variant) {
  const required = z.toJSONSchema(variant.schema, { io: "input", unrepresentable: "any" }).required ?? [];
  const missing = required.filter((field) => !(field in MINIMAL));
  if (missing.length > 0) return { skip: `needs ${missing.join(", ")}` };
  const args = { model: variant.model };
  for (const field of required) args[field] = MINIMAL[field];
  if (variant.fields.has("prompt")) args.prompt = MINIMAL.prompt;
  const fileFields = new Set(variant.op.facts.fileFields.map((f) => f.name));
  const source = ["image", "images"].find((f) => fileFields.has(f));
  if (source !== undefined && !(source in args)) args[source] = MINIMAL[source];
  if (spec.family === "inpaint") args.mask = image;
  return { args };
}

function quotableCases() {
  return FAMILY_TOOLS.flatMap((spec) =>
    variantsOf(spec)
      .filter((variant) => quoteAllowed(variant.op))
      .map((variant) => ({ spec, variant, ...minimalArguments(spec, variant) })),
  );
}

test("every curated quotable operation has a minimal request its tool accepts, or a stated reason to skip it", async () => {
  const cases = quotableCases();
  assert.ok(cases.length >= 30, `${cases.length} quotable curated operations`);
  for (const c of cases.filter((x) => x.args)) {
    const call = await prepare(c.spec, c.args);
    assert.equal(call.req.op.id, c.variant.op.id);
  }
  const skipped = cases.filter((x) => x.skip).map((x) => `${x.variant.model}: ${x.skip}`);
  assert.ok(skipped.every((line) => /custom_model_uri|stacked_custom_models/.test(line)), `only custom models are skipped: ${skipped.join("; ")}`);
});

test("live: every curated quotable operation returns a PriceQuote; the quotes go to docs/PRICES-<date>.md", { skip: process.env.IDEOGRAM_API_KEY ? false : "IDEOGRAM_API_KEY is not set (and the account needs a non-zero balance: a quote may check it)" }, async () => {
  const client = new IdeogramClient(defaultClientOptions(process.env.IDEOGRAM_API_KEY));
  const rows = [];
  for (const c of quotableCases()) {
    if (c.skip) {
      rows.push(`| ${c.spec.name} | ${c.variant.model} | — | — | — | skipped: ${c.skip} |`);
      continue;
    }
    const call = await prepare(c.spec, c.args);
    const outcome = await quote(client, call.req);
    assert.equal(outcome.kind, "quote", `${c.variant.op.id}: ${JSON.stringify(outcome)}`);
    const q = outcome.quote;
    rows.push(`| ${c.spec.name} | ${c.variant.model} | ${q.usd}${q.upperBoundUsd ? ` (≤ ${q.upperBoundUsd})` : ""} | ${q.credits} | ${q.qualifier} | ${q.billingIdentifier} × ${q.quantity} |`);
  }
  const date = new Date().toISOString().slice(0, 10);
  const doc = [
    `# Ideogram prices — quotes of ${date}`,
    "",
    "Each row is the API's own `dry_run` quote of the smallest request the curated tool sends for that model (one image,",
    "default options, a 64×64 source image where one is needed). Your account's prices may differ; `ideogram_quote` asks",
    "for yours, per request.",
    "",
    "| tool | model | USD | credits | qualifier | billing identifier × quantity |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  await writeFile(new URL(`../docs/PRICES-${date}.md`, import.meta.url), doc);
});
