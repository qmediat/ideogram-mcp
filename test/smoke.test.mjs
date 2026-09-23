// Smoke test: the built server starts over stdio, completes the MCP handshake and lists its seven tools.
// Runs with Node's built-in test runner (`npm test`), no extra dependency; the placeholder API key is never sent
// anywhere because `initialize` and `tools/list` do not call the Ideogram API.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const EXPECTED_TOOLS = [
  "ideogram_generate",
  "ideogram_describe",
  "ideogram_edit",
  "ideogram_remix",
  "ideogram_reframe",
  "ideogram_replace_background",
  "ideogram_upscale",
];

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, IDEOGRAM_API_KEY: "smoke-test-placeholder" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve !== undefined) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  return { child, request, notify };
}

test("the server completes the MCP handshake and lists the seven Ideogram tools", async () => {
  const { child, request, notify } = startServer();
  try {
    const init = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.0.0" },
    });
    assert.equal(init.error, undefined, JSON.stringify(init.error));
    assert.equal(typeof init.result.protocolVersion, "string");
    notify("notifications/initialized");

    const list = await request("tools/list", {});
    assert.equal(list.error, undefined, JSON.stringify(list.error));
    const names = list.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
    for (const tool of list.result.tools) {
      assert.equal(typeof tool.description, "string", `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} has an object input schema`);
    }
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("the server refuses to start without IDEOGRAM_API_KEY and says so on stderr", async () => {
  const env = { ...process.env };
  delete env.IDEOGRAM_API_KEY;
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, /IDEOGRAM_API_KEY is required/);
});
