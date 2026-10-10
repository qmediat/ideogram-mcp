// A remote image input (an https URL in a file field): the guard that keeps the fetch to public hosts — the URL's own
// shape, then the resolved addresses — and the fetch itself against a loopback server (allowed only in a test):
// a redirect refused, a wrong type refused, a body over the field's limit cut, a good answer returned with its type.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeApi, openBudget, PNG } from "./support/fake-api.mjs";

const { urlRefusal, addressRefusal, isPrivateAddress, fetchRemoteInput, isRemoteInput } = await import("../dist/remote-input.js");

test("the URL itself: https only, no credentials, no IP literal, no local or single-label name", () => {
  assert.equal(urlRefusal("https://cdn.example.com/a.png"), null);
  assert.match(urlRefusal("http://cdn.example.com/a.png"), /only https/);
  assert.match(urlRefusal("ftp://cdn.example.com/a.png"), /only https/);
  assert.match(urlRefusal("https://user:pw@cdn.example.com/a.png"), /credentials/);
  assert.match(urlRefusal("https://127.0.0.1/a.png"), /IP address/);
  assert.match(urlRefusal("https://[::1]/a.png"), /IP address/);
  assert.match(urlRefusal("https://169.254.169.254/latest/meta-data"), /IP address/);
  assert.match(urlRefusal("https://localhost/a.png"), /not a public host/);
  assert.match(urlRefusal("https://localhost./a.png"), /not a public host/, "a trailing dot does not hide a local name");
  assert.match(urlRefusal("https://LOCALHOST/a.png"), /not a public host/);
  assert.match(urlRefusal("https://metadata/a.png"), /not a public host/);
  assert.match(urlRefusal("https://db.internal/a.png"), /not a public host/);
  assert.match(urlRefusal("https://printer.local/a.png"), /not a public host/);
  assert.match(urlRefusal("not a url"), /is not a URL/);
  assert.equal(isRemoteInput("https://x.example/a.png"), true);
  assert.equal(isRemoteInput("/tmp/a.png"), false);
});

test("the resolved addresses: loopback, private, link-local, carrier, reserved and their IPv6 forms are refused; a public one passes", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.1", "198.51.100.1", "203.0.113.1", "192.88.99.1", "240.0.0.1", "::1", "fc00::1", "fd12::1", "fe80::1", "fec0::1", "2001:db8::1", "100::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "64:ff9b:1::a00:1", "64:ff9b:1:ffff::c0a8:1", "2002:7f00:1::1", "2002:c0a8:101::1", "::7f00:1", "::10.0.0.1", "ff02::1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "172.32.0.1", "100.128.0.1", "192.0.1.1", "192.1.2.1", "198.20.0.1", "198.51.101.1", "203.0.114.1", "2606:2800:220:1:248:1893:25c8:1946", "2001:db9::1", "101::1", "::ffff:93.184.216.34", "64:ff9b::5db8:d822", "64:ff9b:1::5db8:d822", "2002:5db8:d822::1"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.equal(addressRefusal("cdn.example.com", ["93.184.216.34"]), null);
  assert.match(addressRefusal("cdn.example.com", ["93.184.216.34", "10.0.0.5"]), /resolves to 10\.0\.0\.5, which is not a public address/);
  assert.match(addressRefusal("cdn.example.com", []), /resolves to no address/);
});

test("the fetch: a host that resolves to a private address is refused before any request; a public one is fetched", async () => {
  const api = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  try {
    const options = { maxBytes: 1000, accepted: ["image/png"], budget: openBudget(), resolve: async () => ["10.0.0.5"] };
    await assert.rejects(() => fetchRemoteInput("https://cdn.example.com/a.png", options), /not a public address/);
    assert.equal(api.requests.length, 0);
  } finally {
    await api.close();
  }
});

test("the fetch against a loopback server (test only): redirect refused, wrong type refused, over the limit cut, a good answer returned", async () => {
  const api = await startFakeApi((req) => {
    if (req.url === "/redirect") return { status: 302, headers: { location: "https://elsewhere.example/x.png" } };
    if (req.url === "/text") return { status: 200, headers: { "content-type": "text/html" }, body: "<html>" };
    if (req.url === "/big") return { status: 200, headers: { "content-type": "image/png" }, body: Buffer.alloc(5000, 1) };
    if (req.url === "/missing") return { status: 404 };
    return { status: 200, headers: { "content-type": "image/png; charset=binary" }, body: PNG };
  });
  try {
    const options = { maxBytes: 1000, accepted: ["image/png", "image/jpeg", "image/webp"], budget: openBudget(), loopback: true };
    await assert.rejects(() => fetchRemoteInput(`${api.base}/redirect`, options), /redirects \(302\); a redirect is not followed/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/text`, options), /is text\/html, not one of image\/png/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/big`, options), /is over 0\.0 MB, the limit here/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/missing`, options), /answered 404/);
    const got = await fetchRemoteInput(`${api.base}/a.png`, options);
    assert.equal(got.contentType, "image/png");
    assert.deepEqual(Buffer.from(got.bytes), PNG);
  } finally {
    await api.close();
  }
});

test("a lookup that fails is named with its cause, never read as 'no address'", async () => {
  const options = { maxBytes: 1000, accepted: ["image/png"], budget: openBudget(), resolve: async () => { throw new Error("ENOTFOUND"); } };
  await assert.rejects(() => fetchRemoteInput("https://cdn.example.com/a.png", options), /cdn\.example\.com could not be resolved \(ENOTFOUND\)/);
});

test("a 204 or an empty body is refused, a declared length over the limit is refused before the body is read, and a cancelled call is said as such", async () => {
  const api = await startFakeApi((req) => {
    if (req.url === "/nobody") return { status: 204, headers: { "content-type": "image/png" } };
    if (req.url === "/empty") return { status: 200, headers: { "content-type": "image/png" }, body: "" };
    if (req.url === "/declared") return (res) => { res.writeHead(200, { "content-type": "image/png", "content-length": "5000" }); res.end(Buffer.alloc(5000, 1)); };
    return { status: 200, headers: { "content-type": "image/png" }, body: PNG };
  });
  try {
    const options = { maxBytes: 1000, accepted: ["image/png"], budget: openBudget(), loopback: true };
    await assert.rejects(() => fetchRemoteInput(`${api.base}/nobody`, options), /answered without a body|answered an empty body/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/empty`, options), /answered an empty body/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/declared`, options), /by its Content-Length, over 0\.0 MB/);
    const cancel = new AbortController();
    cancel.abort(new Error("the caller gave up"));
    const { toolCallBudget, SYSTEM_CLOCK } = await import("../dist/budget.js");
    const cancelled = { ...options, budget: toolCallBudget(SYSTEM_CLOCK, cancel.signal) };
    await assert.rejects(() => fetchRemoteInput(`${api.base}/a.png`, cancelled), /not fetched, the call's time ran out or the caller cancelled/);
  } finally {
    await api.close();
  }
});

test("the production wiring: a context built from the default client options fetches public https only (an http loopback URL and an IP literal are refused before any request)", async () => {
  const { remoteFetcherFor } = await import("../dist/tools/context.js");
  const { IdeogramClient, defaultClientOptions } = await import("../dist/client.js");
  const api = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  try {
    const server = { client: new IdeogramClient(defaultClientOptions("unused")), outputDir: "/tmp/unused", clock: { now: () => 0, sleep: async () => {} } };
    const remote = remoteFetcherFor(server, openBudget());
    await assert.rejects(() => remote(`${api.base}/a.png`, 1000, ["image/png"]), /only https URLs are fetched/);
    await assert.rejects(() => remote("https://127.0.0.1/a.png", 1000, ["image/png"]), /an IP address is not fetched/);
    await assert.rejects(() => remote("https://localhost/a.png", 1000, ["image/png"]), /not a public host name/);
    assert.equal(api.requests.length, 0, "nothing reached the server");
    assert.equal(defaultClientOptions("unused").loopbackRemoteInputs, false, "the loopback switch is off by default");
    assert.equal(defaultClientOptions("unused").allowHttpDownloads, false);
  } finally {
    await api.close();
  }
});

test("the lookup runs under the call's budget: a resolver that never answers ends with the budget, and the budget's end is said", async () => {
  const cancel = new AbortController();
  const { toolCallBudget, SYSTEM_CLOCK } = await import("../dist/budget.js");
  const budget = toolCallBudget(SYSTEM_CLOCK, cancel.signal);
  const options = { maxBytes: 1000, accepted: ["image/png"], budget, resolve: () => new Promise(() => {}) };
  const pending = fetchRemoteInput("https://cdn.example.com/a.png", options);
  setTimeout(() => cancel.abort(new Error("the caller gave up")), 20);
  await assert.rejects(() => pending, /not fetched, the call's time ran out or the caller cancelled/);
});

test("the connection is pinned to the address the lookup answered: the name is never resolved again (a rebinding reaches nothing) and stays the Host header", async () => {
  const api = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  try {
    const port = new URL(api.base).port;
    const options = { maxBytes: 1000, accepted: ["image/png"], budget: openBudget(), loopback: true, resolve: async () => ["127.0.0.1"] };
    const got = await fetchRemoteInput(`http://pinned.example:${port}/a.png`, options); // pinned.example resolves nowhere: only the pinned address can answer
    assert.deepEqual(Buffer.from(got.bytes), PNG);
    assert.equal(api.requests[0].headers.host, `pinned.example:${port}`, "the Host header is the name, the socket the judged address");
    const { toolCallBudget, SYSTEM_CLOCK } = await import("../dist/budget.js");
    const rebound = { ...options, resolve: async () => ["192.0.2.1"], budget: toolCallBudget(SYSTEM_CLOCK, undefined, 1500) }; // the judged address is where the socket goes: here a documentation address nothing answers from
    await assert.rejects(() => fetchRemoteInput(`http://pinned.example:${port}/a.png`, rebound), /network error|not fetched/);
    assert.equal(api.requests.length, 1, "the loopback server was not reached by the second fetch");
  } finally {
    await api.close();
  }
});

test("every judged address is handed to the socket: an unreachable first address falls through to a reachable one; a lookup that rejects after the budget ended is swallowed, never an unhandled rejection", async () => {
  const api = await startFakeApi(() => ({ status: 200, headers: { "content-type": "image/png" }, body: PNG }));
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const port = new URL(api.base).port;
    const options = { maxBytes: 1000, accepted: ["image/png"], budget: openBudget(), loopback: true, resolve: async () => ["192.0.2.1", "127.0.0.1"] };
    const got = await fetchRemoteInput(`http://pinned.example:${port}/a.png`, options);
    assert.deepEqual(Buffer.from(got.bytes), PNG, "served by the second judged address");
    const cancel = new AbortController();
    cancel.abort(new Error("gone"));
    const { toolCallBudget, SYSTEM_CLOCK } = await import("../dist/budget.js");
    let rejectLookup;
    const late = { maxBytes: 1000, accepted: ["image/png"], budget: toolCallBudget(SYSTEM_CLOCK, cancel.signal), resolve: () => new Promise((_, fail) => { rejectLookup = fail; }) };
    await assert.rejects(() => fetchRemoteInput("https://cdn.example.com/a.png", late), /not fetched/);
    rejectLookup(new Error("ENOTFOUND, late"));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled, [], "the late rejection is swallowed");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await api.close();
  }
});

test("the budget's end mid-body ends the read, and a connection that breaks mid-body is a refusal naming the URL", async () => {
  const api = await startFakeApi((req) => (res) => {
    res.writeHead(200, { "content-type": "image/png", ...(req.url === "/cut.png" ? { "content-length": "1000" } : {}) });
    res.write(PNG.subarray(0, 8));
    if (req.url === "/cut.png") res.socket.destroy(); // the server drops the connection mid-body
    /* else: never ends */
  });
  try {
    const { toolCallBudget, SYSTEM_CLOCK } = await import("../dist/budget.js");
    const options = { maxBytes: 1000, accepted: ["image/png"], budget: toolCallBudget(SYSTEM_CLOCK, undefined, 400), loopback: true };
    const t0 = Date.now();
    await assert.rejects(() => fetchRemoteInput(`${api.base}/held.png`, options), /not fetched, the call's time ran out|ended before it was complete/);
    assert.ok(Date.now() - t0 < 5000, "ended with the budget, not with the server");
    await assert.rejects(() => fetchRemoteInput(`${api.base}/cut.png`, { ...options, budget: openBudget() }), new RegExp(`^Error: ${api.base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cut\\.png: (the body ended (early|before it was complete)|network error while fetching it)`)); // the URL is named whichever event Node raises first
  } finally {
    await api.close();
  }
});
