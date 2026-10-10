/**
 * An image input given as an HTTPS URL, for a client that holds no files (ChatGPT, Claude Desktop): fetched into
 * memory under the field's own limit and sent as the upload the same local file would be. The URL comes from the
 * model, so this is a server-side request on the model's say-so and is bounded like one (docs/DESIGN-ideogram-v2.md
 * section 9b): HTTPS only, a public host only — no IP literal, no local name, no address of a private, loopback,
 * link-local or carrier range after resolution —, no redirect followed, the body an image type the field takes, at
 * most the field's limit, inside the call's budget. What stays: a host that answers the lookup with a public address
 * and the connection with a private one (DNS rebinding) is not caught; a public host is reachable by anyone anyway.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CallBudget } from "./budget.js";

export interface RemoteBytes {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
}

export interface RemoteFetchOptions {
  readonly maxBytes: number;
  /** The media types the field takes, by extension (`image/png` …); any other answer is refused. */
  readonly accepted: readonly string[];
  readonly budget: CallBudget;
  /** A loopback test server; never set by the server. */
  readonly allowPrivate?: boolean;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}

/** A fetcher bound to one call: the field's limit and types are the upload's, the budget the call's. */
export type RemoteFetcher = (url: string, maxBytes: number, accepted: readonly string[]) => Promise<RemoteBytes>;

export function isRemoteInput(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|home\.arpa|lan|corp|test|example|invalid)$/i;

/** Why the URL itself may not be fetched, or null; the resolved addresses are judged apart. */
export function urlRefusal(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return `${text} is not a URL`;
  }
  if (url.protocol !== "https:") return `${text}: only https URLs are fetched`;
  if (url.username !== "" || url.password !== "") return `${text}: a URL with credentials is not fetched`;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return `${text}: an IP address is not fetched; give a public host name`;
  if (LOCAL_NAME.test(host) || !host.includes(".")) return `${text}: ${host} is not a public host name`;
  return null;
}

function ipv4Private(a: number, b: number): boolean {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return a >= 224; // multicast and reserved
}

function ipv6Private(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped !== null) return isPrivateAddress(mapped[1]);
  if (lower === "::1" || lower === "::") return true;
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
}

/** A loopback, private, link-local, carrier or reserved address: never fetched. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number);
    return ipv4Private(a, b);
  }
  return kind === 6 ? ipv6Private(address) : true;
}

export async function resolveAll(host: string): Promise<readonly string[]> {
  const found = await lookup(host, { all: true });
  return found.map((entry) => entry.address);
}

/** Why the host's addresses may not be fetched, or null. */
export function addressRefusal(host: string, addresses: readonly string[]): string | null {
  if (addresses.length === 0) return `${host} resolves to no address`;
  const bad = addresses.find(isPrivateAddress);
  return bad === undefined ? null : `${host} resolves to ${bad}, which is not a public address`;
}

async function readCapped(response: Response, cap: number, url: string): Promise<Uint8Array<ArrayBuffer>> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    total += chunk.value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new Error(`${url} is over ${(cap / 1_000_000).toFixed(1)} MB, the field's limit`);
    }
    chunks.push(chunk.value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Fetches one image from a public HTTPS URL under the rules above; every refusal is a sentence naming the URL. */
export async function fetchRemoteInput(url: string, options: RemoteFetchOptions): Promise<RemoteBytes> {
  const refused = options.allowPrivate === true ? null : urlRefusal(url);
  if (refused !== null) throw new Error(refused);
  const host = new URL(url).hostname;
  if (options.allowPrivate !== true) {
    const addresses = await (options.resolve ?? resolveAll)(host).catch(() => [] as readonly string[]);
    const byAddress = addressRefusal(host, addresses);
    if (byAddress !== null) throw new Error(byAddress);
  }
  const response = await fetch(url, { method: "GET", redirect: "manual", signal: options.budget.signal });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error(`${url} redirects (${response.status}); a redirect is not followed — give the final URL`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  }
  const contentType = (response.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!options.accepted.includes(contentType)) {
    await response.body?.cancel();
    throw new Error(`${url} is ${contentType || "(no content type)"}, not one of ${options.accepted.join(", ")}`);
  }
  const declared = Number.parseInt(response.headers.get("Content-Length") ?? "", 10);
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body?.cancel();
    throw new Error(`${url} is ${(declared / 1_000_000).toFixed(1)} MB, over the field's ${(options.maxBytes / 1_000_000).toFixed(1)} MB`);
  }
  return { bytes: await readCapped(response, options.maxBytes, url), contentType };
}
