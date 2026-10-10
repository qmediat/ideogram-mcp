/**
 * Verification of an Ideogram webhook (step 2 of docs/DESIGN-ideogram-v2.md): Ideogram signs the canonical message
 * `request_id\nuser_id\ntimestamp\nsha256_hex(body)` with an Ed25519 key and sends the signature in
 * `X-Ideogram-Webhook-Signature` (the key's id in `X-Ideogram-Webhook-Key-Id`); the public keys are the JWKS at
 * GET /v1/.well-known/jwks.json (public, cache up to 24 h, refresh when a signature fails). A helper for the
 * receiver — this server receives no webhook itself (a stdio process has no public URL). The JWKS is given, never
 * fetched here; the signature is accepted as base64, base64url or hex.
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

/** The id of the key the signature verifies against (the header's key first, then every other), or null. */
export function verifyWebhook(delivery: WebhookDelivery, jwks: WebhookJwks): string | null {
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
