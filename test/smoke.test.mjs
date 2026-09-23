// Smoke test: the built server starts over stdio, completes the MCP handshake and lists its seven tools.
// Runs with Node's built-in test runner (`npm test`, which builds first), no extra dependency. The placeholder
// API key is never sent anywhere because `initialize` and `tools/list` do not call the Ideogram API.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const REQUEST_TIMEOUT_MS = 10_000;
const EXPECTED_TOOLS = [
  "ideogram_generate",
  "ideogram_describe",
  "ideogram_edit",
  "ideogram_remix",
  "ideogram_reframe",
  "ideogram_replace_background",
  "ideogram_upscale",
];

/** Spawns the built server; every request either resolves with its response or rejects (timeout, child exit, error). */
function startServer(env) {
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
  // Registered before anything can happen, so an early exit is never missed by stop().
  const closed = once(child, "close");
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const failAll = (reason) => {
    for (const [id, { reject, timer }] of pending) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error(`${reason}; stderr: ${stderr.trim()}`));
    }
  };
  child.on("error", (error) => failAll(`server process error: ${error.message}`));
  child.on("exit", (code, signal) => failAll(`server exited early (code ${code}, signal ${signal})`));
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.trim() === "") return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failAll(`non-JSON line on stdout: ${line.slice(0, 200)}`);
      return;
    }
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    entry.resolve(message);
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no response to ${method} within ${REQUEST_TIMEOUT_MS} ms; stderr: ${stderr.trim()}`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  const stop = async () => {
    child.kill();
    await closed;
  };
  return { closed, request, notify, stop, stderr: () => stderr };
}

test("the server completes the MCP handshake, advertises the package version and lists the seven tools", async () => {
  const server = startServer({ ...process.env, IDEOGRAM_API_KEY: "smoke-test-placeholder" });
  try {
    const init = await server.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "0.0.0" },
    });
    assert.equal(init.error, undefined, JSON.stringify(init.error));
    assert.equal(typeof init.result.protocolVersion, "string");
    assert.equal(init.result.serverInfo.name, "ideogram");
    assert.equal(init.result.serverInfo.version, PACKAGE_VERSION, "serverInfo.version follows package.json");
    server.notify("notifications/initialized");

    const list = await server.request("tools/list", {});
    assert.equal(list.error, undefined, JSON.stringify(list.error));
    const names = list.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
    for (const tool of list.result.tools) {
      assert.equal(typeof tool.description, "string", `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} has an object input schema`);
    }
  } finally {
    await server.stop();
  }
});

test("the server refuses to start without IDEOGRAM_API_KEY and says so on stderr", async () => {
  const env = { ...process.env };
  delete env.IDEOGRAM_API_KEY;
  const server = startServer(env);
  // `close` fires after the stdio streams have ended, so stderr is complete when it resolves.
  const [code] = await server.closed;
  assert.equal(code, 1);
  assert.match(server.stderr(), /IDEOGRAM_API_KEY is required/);
});
