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

test("the canonical message is request_id, user_id, timestamp and the hex sha256 of the body, newline-separated", () => {
  const digest = createHash("sha256").update(delivery.body).digest("hex");
  assert.equal(canonicalMessage(delivery).toString("utf8"), `req_1\nuser_1\n2026-10-10T20:00:00Z\n${digest}`);
});

test("a signature verifies against the named key, a rotated key still verifies, base64 / base64url / hex are all accepted", () => {
  const current = keyPair("v2");
  const old = keyPair("v1");
  const jwks = { keys: [current.jwk, old.jwk] };
  const sig = sign(null, canonicalMessage(delivery), current.privateKey);
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("base64"), keyId: "v2" }, jwks), "v2");
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("base64url") }, jwks), "v2");
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("hex") }, jwks), "v2");
  const oldSig = sign(null, canonicalMessage(delivery), old.privateKey);
  assert.equal(verifyWebhook({ ...delivery, signature: oldSig.toString("base64"), keyId: "v2" }, jwks), "v1", "a key recently rotated out still verifies");
});

test("a tampered body, a foreign key, a key that is not Ed25519 and a malformed signature are refused", () => {
  const ours = keyPair("v1");
  const theirs = keyPair("x");
  const sig = sign(null, canonicalMessage(delivery), theirs.privateKey);
  assert.equal(verifyWebhook({ ...delivery, signature: sig.toString("base64") }, { keys: [ours.jwk] }), null);
  const good = sign(null, canonicalMessage(delivery), ours.privateKey).toString("base64");
  assert.equal(verifyWebhook({ ...delivery, body: delivery.body + " ", signature: good }, { keys: [ours.jwk] }), null);
  assert.equal(verifyWebhook({ ...delivery, signature: "not-a-signature" }, { keys: [ours.jwk] }), null);
  assert.equal(verifyWebhook({ ...delivery, signature: good }, { keys: [{ kty: "RSA", x: ours.jwk.x }] }), null, "a non-OKP key is skipped");
  assert.equal(verifyWebhook({ ...delivery, signature: good }, { keys: [{ kty: "OKP", crv: "Ed25519", x: "not base64url!!" }] }), null, "an unreadable key is skipped");
});
