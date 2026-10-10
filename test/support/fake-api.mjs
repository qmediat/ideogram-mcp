// A fake Ideogram API on a loopback port (node:http): each request is recorded with its exact body bytes and answered
// by the test's handler. Also builds the client options and the fake clock the tests share. No test lives here.
import http from "node:http";

const budgetModule = await import("../../dist/budget.js");

/** Starts a server; `handler(req)` returns { status, headers?, json? | body? | stream? } or a function of the raw res. */
export async function startFakeApi(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      requests.push(record);
      const answer = await handler(record, requests.length);
      if (typeof answer === "function") return answer(res, req);
      const headers = { ...(answer.json !== undefined ? { "content-type": "application/json" } : {}), ...answer.headers };
      res.writeHead(answer.status ?? 200, headers);
      res.end(answer.json !== undefined ? JSON.stringify(answer.json) : (answer.body ?? ""));
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((done) => { server.closeAllConnections(); server.close(done); });
  return { base, requests, close, server };
}

/** Client options pointing at the fake server, with a fake clock and a call's budget on it (55 s): the client's retry
 * sleeps run on the budget's clock, so they are recorded (`sleeps`), return at once and advance the clock. */
export function testClientOptions(base, overrides = {}) {
  const clock = fakeClock();
  const { toolCallBudget } = budgetModule;
  return {
    sleeps: clock.sleeps,
    clock,
    budget: toolCallBudget(clock),
    options: {
      apiKey: "dummy-key-for-tests",
      baseUrl: base,
      downloadHosts: ["127.0.0.1"],
      allowHttpDownloads: true,
      maxRetries: 3,
      requestTimeoutMs: 10_000,
      maxDownloadBytes: 50 * 1024 * 1024,
      boundary: () => "test-boundary",
      ...overrides,
    },
  };
}

/** A clock that advances only when slept on. */
export function fakeClock() {
  const clock = { t: 0, sleeps: [], now: () => clock.t, sleep: async (ms) => { clock.sleeps.push(ms); clock.t += ms; } };
  return clock;
}

export const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** A tool context on the fake API: its client, a fresh output directory, a clock that does not wait, and the call's budget
 * on that clock. */
export async function testContext(base, outputDir) {
  const { IdeogramClient } = await import("../../dist/client.js");
  const { remoteFetcherFor } = await import("../../dist/tools/context.js");
  const { clock, options } = testClientOptions(base);
  const server = { client: new IdeogramClient(options), outputDir, clock };
  const budget = budgetModule.toolCallBudget(clock);
  return { ...server, budget, remote: remoteFetcherFor(server, budget) }; // the fake API is a loopback http server: remote inputs may come from it
}

/** A budget of `ms` real milliseconds on the system clock, for one request; `cancel` is the caller's signal. */
export function realBudget(ms, cancel) {
  return budgetModule.toolCallBudget(budgetModule.SYSTEM_CLOCK, cancel, ms);
}

/** A budget without a limit, for a test of one request that is not about time. */
export function openBudget() {
  return budgetModule.openBudget();
}

/** Finds a registered tool by name. */
export async function tool(name) {
  const { toolDefinitions } = await import("../../dist/server.js");
  const found = toolDefinitions().find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}
