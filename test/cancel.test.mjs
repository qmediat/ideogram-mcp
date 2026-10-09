// The caller's cancellation reaches the tool: when an MCP client times a call out it sends notifications/cancelled, the
// SDK aborts the handler's signal, and this server's call budget carries that signal into every request of the call — so
// a poll in flight is aborted at once (nothing of a call outlives its caller) instead of running to the 55 s limit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startFakeApi, testClientOptions, fakeClock } from "./support/fake-api.mjs";

const { createServer } = await import("../dist/server.js");
const { IdeogramClient } = await import("../dist/client.js");

test("a client that gives up at 300 ms aborts the poll in flight: the API request is closed within a second, not at 55 s", async () => {
  let closedAt = null;
  const api = await startFakeApi(() => (res) => { res.on("close", () => { closedAt = Date.now(); }); }); // never answers; closed by the abort
  const server = createServer({ client: new IdeogramClient(testClientOptions(api.base).options), outputDir: "/tmp/unused", clock: fakeClock() });
  const client = new Client({ name: "cancel-test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    const started = Date.now();
    await assert.rejects(() => client.callTool({ name: "ideogram_generation", arguments: { generation_id: "g", wait_s: 0 } }, undefined, { timeout: 300 }), /timed out|-32001/i);
    await new Promise((done) => setTimeout(done, 500));
    assert.equal(api.requests.length, 1, "one poll was in flight");
    assert.ok(closedAt !== null, "the server's HTTP request to the API was aborted after the client gave up");
    assert.ok(closedAt - started < 2_000, `${closedAt - started} ms: the abort followed the client's cancel, not the server's limit`);
  } finally {
    await client.close();
    await api.close();
  }
});
