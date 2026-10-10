/**
 * Verification of an Ideogram webhook (step 2 of docs/DESIGN-ideogram-v2.md): Ideogram signs the canonical message
 * `request_id\nuser_id\ntimestamp\nsha256_hex(body)` with an Ed25519 key and sends the signature in
 * `X-Ideogram-Webhook-Signature` (the key's id in `X-Ideogram-Webhook-Key-Id`); the public keys are the JWKS at
 * GET /v1/.well-known/jwks.json (public, cache up to 24 h, refresh when a signature fails). A helper for the
 * receiver — this server receives no webhook itself (a stdio process has no public URL). The JWKS is given, never
 * fetched here; the signature is accepted as base64, base64url or hex. Where `request_id`, `user_id` and `timestamp`
 * travel is not stated by the specification (it names the two signature headers only): the receiver takes them from
 * the delivery as Ideogram's webhook documentation says and passes them in. A replay is refused by the timestamp:
 * one (RFC 3339, or epoch seconds — 13 digits read as milliseconds) farther than `maxAgeS` (300 s by default;
 * Infinity turns the check off) from `now` is refused; the signature alone would be valid forever. The key id in
 * the header is a hint for the order: every key of the JWKS is Ideogram's, so a signature any of them verifies is
 * Ideogram's (the rotation case the specification describes).
 */
import { createHash, createPublicKey, verify } from "node:crypto";

export interface WebhookJwk {
  readonly kty: string;
  readonly crv?: string;
  readonly kid?: string;
  /** The public key, base64url. */
  readonly x: string;
}

export interface WebhookJwks {
  readonly keys: readonly WebhookJwk[];
}

export const DEFAULT_MAX_AGE_S = 300;

export interface VerifyOptions {
  /** The most a delivery's timestamp may be from `now`, in seconds: 300 by default; Infinity turns the check off. */
  readonly maxAgeS?: number;
  /** Milliseconds since the epoch; Date.now() by default. */
  readonly now?: number;
}

export interface WebhookDelivery {
  /** The raw request body, exactly as received. */
  readonly body: string | Uint8Array;
  readonly requestId: string;
  readonly userId: string;
  readonly timestamp: string;
  /** The `X-Ideogram-Webhook-Signature` header. */
  readonly signature: string;
  /** The `X-Ideogram-Webhook-Key-Id` header, when sent: that key is tried first. */
  readonly keyId?: string;
}

/** The message Ideogram signs. */
export function canonicalMessage(delivery: Pick<WebhookDelivery, "body" | "requestId" | "userId" | "timestamp">): Buffer {
  const digest = createHash("sha256").update(delivery.body).digest("hex");
  return Buffer.from(`${delivery.requestId}\n${delivery.userId}\n${delivery.timestamp}\n${digest}`, "utf8");
}

function signatureBytes(text: string): Buffer[] {
  const trimmed = text.trim();
  const out: Buffer[] = [];
  if (/^[0-9a-f]{128}$/i.test(trimmed)) out.push(Buffer.from(trimmed, "hex"));
  for (const encoding of ["base64", "base64url"] as const) {
    const bytes = Buffer.from(trimmed, encoding);
    if (bytes.length === 64) out.push(bytes);
  }
  return out;
}

function ed25519Key(jwk: WebhookJwk): ReturnType<typeof createPublicKey> | null {
  if (jwk.kty !== "OKP" || (jwk.crv !== undefined && jwk.crv !== "Ed25519")) return null;
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
  } catch {
    return null;
  }
}

function timestampMs(text: string): number {
  if (/^\d{9,13}$/.test(text)) return Number(text) * (text.length <= 10 ? 1000 : 1);
  return Date.parse(text);
}

/** The id of the key the signature verifies against (the header's key first, then every other), or null: a missing
 * or malformed signature, a key set without an Ed25519 key, or a timestamp past `maxAgeS` is null, never a throw. */
export function verifyWebhook(delivery: WebhookDelivery, jwks: WebhookJwks, options: VerifyOptions = {}): string | null {
  if (typeof delivery.signature !== "string" || typeof delivery.requestId !== "string" || typeof delivery.userId !== "string" || typeof delivery.timestamp !== "string") return null;
  const maxAgeS = options.maxAgeS ?? DEFAULT_MAX_AGE_S;
  if (Number.isFinite(maxAgeS)) {
    const at = timestampMs(delivery.timestamp);
    if (!Number.isFinite(at) || Math.abs((options.now ?? Date.now()) - at) > maxAgeS * 1000) return null;
  }
  const message = canonicalMessage(delivery);
  const signatures = signatureBytes(delivery.signature);
  if (signatures.length === 0) return null;
  const ordered = [...jwks.keys].sort((a, b) => Number(b.kid === delivery.keyId) - Number(a.kid === delivery.keyId));
  for (const jwk of ordered) {
    const key = ed25519Key(jwk);
    if (key === null) continue;
    if (signatures.some((sig) => verify(null, message, key, sig))) return jwk.kid ?? "(no kid)";
  }
  return null;
}
