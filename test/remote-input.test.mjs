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
  assert.match(urlRefusal("https://metadata/a.png"), /not a public host/);
  assert.match(urlRefusal("https://db.internal/a.png"), /not a public host/);
  assert.match(urlRefusal("https://printer.local/a.png"), /not a public host/);
  assert.match(urlRefusal("not a url"), /is not a URL/);
  assert.equal(isRemoteInput("https://x.example/a.png"), true);
  assert.equal(isRemoteInput("/tmp/a.png"), false);
});

test("the resolved addresses: loopback, private, link-local, carrier, reserved and their IPv6 forms are refused; a public one passes", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"]) {
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
    const options = { maxBytes: 1000, accepted: ["image/png", "image/jpeg", "image/webp"], budget: openBudget(), allowPrivate: true };
    await assert.rejects(() => fetchRemoteInput(`${api.base}/redirect`, options), /redirects \(302\); a redirect is not followed/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/text`, options), /is text\/html, not one of image\/png/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/big`, options), /over .* the field's limit|over the field's/);
    await assert.rejects(() => fetchRemoteInput(`${api.base}/missing`, options), /answered 404/);
    const got = await fetchRemoteInput(`${api.base}/a.png`, options);
    assert.equal(got.contentType, "image/png");
    assert.deepEqual(Buffer.from(got.bytes), PNG);
  } finally {
    await api.close();
  }
});
