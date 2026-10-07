// The schema budget of the shipped release (docs/DESIGN-ideogram-v2.md section 5): tools/list as a client receives it,
// over a real MCP session, is at most 64 KB, and the per-model exactness that costs those bytes is really there.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const { createServer } = await import("../dist/server.js");
const { documentedModelsOf } = await import("../dist/registry.js");
const { IdeogramClient, defaultClientOptions } = await import("../dist/client.js");

const BUDGET_BYTES = 64 * 1024;

async function listTools() {
  const ctx = { client: new IdeogramClient(defaultClientOptions("unused")), outputDir: "/tmp/unused", clock: { now: () => 0, sleep: async () => {} } };
  const server = createServer(ctx);
  const client = new Client({ name: "budget-test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    return await client.listTools();
  } finally {
    await client.close();
  }
}

test("the serialized tools/list is within the 64 KB budget", async () => {
  const listed = await listTools();
  const bytes = Buffer.byteLength(JSON.stringify(listed));
  assert.ok(bytes <= BUDGET_BYTES, `tools/list is ${bytes} bytes, over ${BUDGET_BYTES}`);
  console.log(`tools/list: ${listed.tools.length} tools, ${bytes} bytes`);
});

test("each family tool advertises one exact variant per documented model, and the variants agree with the registry", async () => {
  const { tools } = await listTools();
  const families = { ideogram_generate: "generate", ideogram_inpaint: "inpaint", ideogram_remix: "remix", ideogram_upscale: "upscale" };
  for (const [name, family] of Object.entries(families)) {
    const schema = tools.find((t) => t.name === name).inputSchema;
    const models = schema.oneOf.map((variant) => variant.properties.model.const);
    assert.deepEqual(models, [...documentedModelsOf(family)], name);
    assert.deepEqual(schema.properties.model.enum, models, `${name} lists the same models at the top`);
  }
  const generate = tools.find((t) => t.name === "ideogram_generate").inputSchema;
  const variant = (model) => generate.oneOf.find((v) => v.properties.model.const === model);
  assert.ok("quality" in variant("ideogram-4-5").properties && !("rendering_speed" in variant("ideogram-4-5").properties));
  assert.ok("rendering_speed" in variant("ideogram-3").properties && !("quality" in variant("ideogram-3").properties));
  assert.equal(variant("ideogram-3").required?.includes("model") ?? false, false, "the default model's variant does not require model");
});
