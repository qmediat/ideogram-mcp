// The webhook helper: the canonical message as the API states it, a signature verified against the JWKS (the header's
// key first, a rotated key still accepted), the encodings accepted, a tampered body or a foreign key refused.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { test } from "node:test";

const { verifyWebhook, canonicalMessage } = await import("../dist/webhooks.js");

function keyPair(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  return { privateKey, jwk: { kty: "OKP", crv: "Ed25519", kid, alg: "EdDSA", use: "sig", x: jwk.x } };
}

const delivery = { body: '{"generation_id":"g1","status":"completed"}', requestId: "req_1", userId: "user_1", timestamp: "2026-10-10T20:00:00Z" };
const fresh = { now: Date.parse(delivery.timestamp) + 1000 }; // the replay window is on by default: the tests say when "now" is

test("the canonical message is request_id, user_id, timestamp and the hex sha256 of the body, newline-separated", () => {
  const digest = createHash("sha256").update(delivery.body).digest("hex");
  assert.equal(canonicalMessage(delivery).toString("utf8"), `req_1\nuser_1\n2026-10-10T20:00:00Z\n${digest}`);
});

test("a signature verifies against the named key, a rotated key still verifies, base64 / base64url / hex are all accepted", () => {
  const current = keyPair("v2");
  const old = keyPair("v1");
  const jwks = { keys: [current.jwk, old.jwk] };
  const sig = sign(null, canonicalMessage(delivery), current.privateKey);
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("base64"), keyId: "v2" }, jwks, fresh), "v2");
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("base64url") }, jwks, fresh), "v2");
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("hex") }, jwks, fresh), "v2");
  const oldSig = sign(null, canonicalMessage(delivery), old.privateKey);
  assert.equal(verifyWebhook({ ...delivery, signature: oldSig.toString("base64"), keyId: "v2" }, jwks, fresh), "v1", "a key recently rotated out still verifies");
});

test("a replay is refused only when the receiver sets maxAgeS; a header the receiver did not get is null, not a throw; an unknown key id still verifies against the set", () => {
  const ours = keyPair("v1");
  const good = sign(null, canonicalMessage(delivery), ours.privateKey).toString("base64");
  const jwks = { keys: [ours.jwk] };
  const at = Date.parse(delivery.timestamp);
  assert.equal(verifyWebhook({ ...delivery, signature: good }, jwks, { maxAgeS: 300, now: at + 200_000 }), "v1");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, jwks, { maxAgeS: 300, now: at + 400_000 }), null, "older than maxAgeS");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, jwks, { maxAgeS: 300, now: at - 400_000 }), null, "from the future as well");
  assert.equal(verifyWebhook({ ...delivery, timestamp: String(Math.floor(at / 1000)), signature: sign(null, canonicalMessage({ ...delivery, timestamp: String(Math.floor(at / 1000)) }), ours.privateKey).toString("base64") }, jwks, { maxAgeS: 300, now: at + 1000 }), "v1", "epoch seconds are read too");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, jwks, { now: at + 400_000 }), null, "by default (300 s) a delivery older than that is a replay");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, jwks, { maxAgeS: Number.NaN, now: at + 400_000 }), null, "NaN is the default window, not none");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, { keys: undefined }, fresh), null, "a document without keys verifies nothing");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, {}, fresh), null);
  assert.equal(verifyWebhook({ ...delivery, signature: good }, jwks, { maxAgeS: Infinity }), "v1", "Infinity turns the window off");
  assert.equal(verifyWebhook({ ...delivery, signature: undefined }, jwks, fresh), null);
  assert.equal(verifyWebhook({ ...delivery, signature: ["a", "b"] }, jwks, fresh), null, "a repeated header");
  assert.equal(verifyWebhook({ ...delivery, requestId: undefined, signature: good }, jwks, fresh), null, "a missing part of the message");
  assert.equal(verifyWebhook({ ...delivery, signature: good, keyId: ["v1", "v1"] }, jwks, fresh), "v1", "a repeated key id is ignored as a hint");
  assert.equal(canonicalMessage({ ...delivery, userId: ["a", "b"] }), null);
  assert.equal(verifyWebhook({ ...delivery, signature: good, keyId: "unknown" }, jwks, fresh), "v1");
});

test("a tampered body, a foreign key, a key that is not Ed25519 and a malformed signature are refused", () => {
  const ours = keyPair("v1");
  const theirs = keyPair("x");
  const sig = sign(null, canonicalMessage(delivery), theirs.privateKey);
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("base64") }, { keys: [ours.jwk] }, fresh), null);
  const good = sign(null, canonicalMessage(delivery), ours.privateKey).toString("base64");
  assert.equal(verifyWebhook({ ...delivery, body: delivery.body + " ", signature: good }, { keys: [ours.jwk] }, fresh), null);
  assert.equal(verifyWebhook({ ...delivery, signature: "not-a-signature" }, { keys: [ours.jwk] }, fresh), null);
  assert.equal(verifyWebhook({ ...delivery, signature: good }, { keys: [{ kty: "RSA", x: ours.jwk.x }] }, fresh), null, "a non-OKP key is skipped");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, { keys: [{ kty: "OKP", crv: "Ed25519", x: "not base64url!!" }] }, fresh), null, "an unreadable key is skipped");
});
