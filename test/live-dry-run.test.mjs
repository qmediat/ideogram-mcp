// Prices from the live API, at no cost: every curated operation that offers dry_run is quoted (validated and priced,
// nothing generated, stored or billed) and the quotes are written to docs/PRICES-<date>.md as the price evidence.
// The live part runs only with IDEOGRAM_API_KEY set, against an account with a non-zero balance (a quote may check it).
// The offline part always runs: every curated quotable operation has a minimal request its tool accepts, or the
// reason it is skipped.
import assert from "node:assert/strict";
import { openBudget } from "./support/fake-api.mjs";
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

/** A valid 8-bit greyscale PNG (signature, IHDR, one IDAT, IEND), `fill(y)` the value of row y, so a dry run can validate
 * the image: 1024×1024 (GPT Image 2 needs ≥ 655 360 pixels, multiples of 16) — a flat image deflates to a few bytes. */
function greyPng(size = 1024, fill = () => 128) {
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
  const ihdr = Buffer.alloc(13); // width, height as 32-bit big-endian (a byte literal would truncate 1024 to 0), 8-bit greyscale
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  const rows = Buffer.concat(Array.from({ length: size }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.alloc(size, fill(y))])));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const image = join(dir, "grey.png");
await writeFile(image, greyPng());
const mask = join(dir, "mask.png"); // black (edit) on top, white (keep) below: a mask must hold both regions
await writeFile(mask, greyPng(1024, (y) => (y < 512 ? 0 : 255)));

/** Values for the fields a model requires; a required field not listed here makes the model skipped, with its name. */
const MINIMAL = {
  prompt: "a lighthouse at dawn, flat illustration",
  image,
  mask,
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
  if (source !== undefined && !(source in args) && spec.family !== "generate") args[source] = MINIMAL[source]; // generate is quoted as text-to-image
  if (spec.family === "inpaint" || spec.family === "remove_object") args.mask = mask;
  if (variant.fields.has("character_reference_images")) args.character_reference_images = MINIMAL.character_reference_images; // the API requires one; the schema does not say so
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
  const failures = [];
  for (const c of quotableCases()) {
    if (c.skip) {
      rows.push(`| ${c.spec.name} | ${c.variant.model} | — | — | — | skipped: ${c.skip} |`);
      continue;
    }
    const call = await prepare(c.spec, c.args);
    let outcome;
    try {
      outcome = await quote(client, call.req, openBudget());
    } catch (error) {
      failures.push(`${c.variant.op.id}: ${error instanceof Error ? error.message : String(error)}`);
      rows.push(`| ${c.spec.name} | ${c.variant.model} | — | — | — | FAILED: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)} |`);
      continue;
    }
    if (outcome.kind !== "quote") {
      failures.push(`${c.variant.op.id}: ${JSON.stringify(outcome).slice(0, 200)}`);
      rows.push(`| ${c.spec.name} | ${c.variant.model} | — | — | — | FAILED: ${outcome.kind} |`);
      continue;
    }
    const q = outcome.quote;
    rows.push(`| ${c.spec.name} | ${c.variant.model} | ${q.usd}${q.upperBoundUsd ? ` (≤ ${q.upperBoundUsd})` : ""} | ${q.credits} | ${q.qualifier} | ${q.billingIdentifier} × ${q.quantity} |`);
  }
  const date = new Date().toISOString().slice(0, 10);
  const doc = [
    `# Ideogram prices — quotes of ${date}`,
    "",
    "Each row is the API's own `dry_run` quote of the smallest request the curated tool sends for that model (one image,",
    "default options, a 1024×1024 grey source image where one is needed, generate quoted as text-to-image). Your account's",
    "prices may differ; `ideogram_quote` asks",
    "for yours, per request.",
    "",
    "| tool | model | USD | credits | qualifier | billing identifier × quantity |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  await writeFile(new URL(`../docs/PRICES-${date}.md`, import.meta.url), doc);
  assert.deepEqual(failures, [], `every row is in docs/PRICES-${date}.md; these failed:\n${failures.join("\n")}`);
});
