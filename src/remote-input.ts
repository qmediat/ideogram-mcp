/**
 * An image input given as an HTTPS URL, for a client that holds no files (ChatGPT, Claude Desktop): fetched into
 * memory under the field's own limit and sent as the upload the same local file would be. The URL comes from the
 * model, so this is a server-side request on the model's say-so and is bounded like one (docs/DESIGN-ideogram-v2.md
 * section 9b): HTTPS only, a public host only — no IP literal, no local name, no address of a private, loopback,
 * link-local, carrier, site-local, mapped, translated or reserved range after resolution —, no redirect followed, the
 * body a type the field takes, at most the field's limit, inside the call's budget, never empty. The connection goes to
 * the very address the lookup answered and was judged (node:https with that address as its lookup, the host name as
 * SNI and Host): a host that answers the lookup with a public address and a later one with a private address (DNS
 * rebinding) reaches nothing. A loopback test server is reached only with `loopback: true` (the client option
 * `loopbackRemoteInputs`), which relaxes the scheme, the IP-literal and the address checks and nothing else; the
 * server never sets it. The lookup runs under the call's budget as the fetch does: a resolver that stalls ends the
 * call, not the caller's patience (the lookup itself cannot be cancelled; its answer is dropped).
 */
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { CallBudget } from "./budget.js";

export interface RemoteBytes {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
}

export interface RemoteFetchOptions {
  readonly maxBytes: number;
  /** The media types the field takes (`image/png` …); any other answer is refused. */
  readonly accepted: readonly string[];
  readonly budget: CallBudget;
  /** A loopback test server over plain http; never set by the server. */
  readonly loopback?: boolean;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}

/** A fetcher bound to one call: the field's limit and types are the upload's, the budget the call's. */
export type RemoteFetcher = (url: string, maxBytes: number, accepted: readonly string[]) => Promise<RemoteBytes>;

export function isRemoteInput(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|home\.arpa|lan|corp|test|example|invalid)$/i;

/** The host name as judged: lower-case, without a trailing dot or IPv6 brackets. */
function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Why the URL itself may not be fetched, or null; the resolved addresses are judged apart. */
export function urlRefusal(text: string, loopback = false): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return `${text} is not a URL`;
  }
  if (url.username !== "" || url.password !== "") return `${text}: a URL with credentials is not fetched`;
  if (loopback) return url.protocol === "http:" || url.protocol === "https:" ? null : `${text}: not an http(s) URL`;
  if (url.protocol !== "https:") return `${text}: only https URLs are fetched`;
  const host = hostOf(url);
  if (isIP(host) !== 0) return `${text}: an IP address is not fetched; give a public host name`;
  if (LOCAL_NAME.test(host) || !host.includes(".")) return `${text}: ${host} is not a public host name`;
  return null;
}

/** Not globally reachable (IANA special-purpose registry): private, loopback, link-local, carrier NAT, the
 * protocol-assignment and documentation blocks, the benchmark block, 6to4 relay, multicast and reserved. */
function ipv4Private(a: number, b: number, c: number): boolean {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true; // benchmark, documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  return a >= 224; // multicast and reserved
}

/** The 32 bits an IPv6 address embeds (mapped ::ffff:a.b.c.d or ::ffff:xxxx:xxxx, translated 64:ff9b::, compatible ::a.b.c.d, 6to4 2002:), or null. */
function embeddedIpv4(groups: readonly number[], lower: string): string | null {
  const dotted = (hi: number, lo: number): string => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return dotted(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return dotted(groups[6], groups[7]); // NAT64 64:ff9b::/96
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return dotted(groups[6], groups[7]); // NAT64 local-use 64:ff9b:1::/48
  if (groups[0] === 0x2002) return dotted(groups[1], groups[2]);
  if (groups.slice(0, 6).every((g) => g === 0) && lower !== "::1" && lower !== "::") return dotted(groups[6], groups[7]);
  return null;
}

/** The eight 16-bit groups of an IPv6 address (a dotted IPv4 tail folded into the last two). */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/%.*$/, "");
  const tail = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail !== null) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined ? [] : rest === "" ? [] : rest.split(":");
  if (rest === undefined && left.length !== 8) return null;
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null;
}

function ipv6Private(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  const groups = ipv6Groups(lower);
  if (groups === null) return true;
  const embedded = embeddedIpv4(groups, lower);
  if (embedded !== null) return isPrivateAddress(embedded);
  const first = groups[0];
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // documentation 2001:db8::/32
  if (first === 0x0100 && groups.slice(1, 4).every((g) => g === 0)) return true; // discard-only 100::/64
  if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
  return (first & 0xff00) === 0xff00; // multicast
}

/** A loopback, private, link-local, carrier, site-local, embedded-private or reserved address: never fetched. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return ipv4Private(a, b, c);
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

const describe = (error: unknown): string => (error instanceof Error ? ((error as { cause?: Error }).cause?.message ?? error.message) : String(error));

/** The budget's end, when the fetch failed because of it; else the network error, named. */
function fetchError(url: string, budget: CallBudget, error: unknown): Error {
  if (budget.signal.aborted) {
    const why = budget.signal.reason instanceof Error && budget.signal.reason.name === "WaitEnded" ? "the wait ran out" : "the call's time ran out or the caller cancelled";
    return new Error(`${url}: not fetched, ${why}`);
  }
  return new Error(`${url}: network error while fetching it (${describe(error)})`);
}

/** The body read with a byte counter under the cap; the response destroyed the moment it goes over. */
function readCapped(response: IncomingMessage, cap: number, url: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > cap) {
        response.destroy();
        fail(new Error(`${url} is over ${(cap / 1_000_000).toFixed(1)} MB, the limit here`));
        return;
      }
      chunks.push(chunk);
    });
    // a connection that breaks mid-body (or the budget's abort, which destroys the response) lands on 'error' — named
    // with the URL like every other refusal; 'close' before completion is the guard under it (Node ≥ 22 emits 'error' first)
    response.on("error", (error: Error) => fail(new Error(`${url}: the body ended early (${error.message})`)));
    response.on("close", () => {
      if (!response.complete) fail(new Error(`${url}: the body ended before it was complete`));
    });
    response.on("end", () => {
      if (total === 0) {
        fail(new Error(`${url} answered an empty body`));
        return;
      }
      const out = new Uint8Array(new ArrayBuffer(total));
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      done(out);
    });
  });
}

function refuse(response: IncomingMessage, message: string): never {
  response.destroy();
  throw new Error(message);
}

/** One GET of the URL, the socket connected to one of the judged `addresses` (every one was judged; Node's happy
 * eyeballs picks among them when it asks for all, else the first) — the host name stays the SNI and the Host
 * header —, aborted by the budget's signal; the response head, its body not yet read. */
function requestHead(url: URL, addresses: readonly string[] | null, budget: CallBudget): Promise<IncomingMessage> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const judged = addresses === null ? null : addresses.map((address) => ({ address, family: isIP(address) }));
  const lookupPinned = judged === null ? undefined : (_host: string, options: { all?: boolean }, callback: (err: Error | null, result: unknown, family?: number) => void): void => {
    if (options.all === true) callback(null, judged);
    else callback(null, judged[0].address, judged[0].family);
  };
  return new Promise((done, fail) => {
    // agent: false — a fresh socket per fetch, never a pooled one that another lookup's judgement opened
    const req = request(url, { method: "GET", signal: budget.signal, servername: url.hostname, lookup: lookupPinned as never, agent: false }, done);
    req.on("error", fail);
    req.end();
  });
}

/** The promise, or the budget's end if it comes first. The work behind it goes on unobserved (a lookup cannot be
 * cancelled) and its later rejection is swallowed here: an orphaned rejection would end the process. */
function withinBudget<T>(work: Promise<T>, budget: CallBudget): Promise<T> {
  work.catch(() => undefined);
  if (budget.signal.aborted) return Promise.reject(new BudgetEndedHere());
  return new Promise<T>((done, fail) => {
    const onAbort = (): void => fail(new BudgetEndedHere());
    budget.signal.addEventListener("abort", onAbort, { once: true });
    work.then(done, fail).finally(() => budget.signal.removeEventListener("abort", onAbort));
  });
}

class BudgetEndedHere extends Error {
  constructor() {
    super("the budget ended");
  }
}

/** The host's addresses, judged (unless `judge` is off: the loopback test of the pinning itself): the addresses the
 * connection is pinned to. */
async function checkHost(url: string, options: RemoteFetchOptions, judge: boolean): Promise<readonly string[]> {
  const host = hostOf(new URL(url));
  let addresses: readonly string[];
  try {
    addresses = await withinBudget((options.resolve ?? resolveAll)(host), options.budget);
  } catch (error) {
    if (error instanceof BudgetEndedHere) throw fetchError(url, options.budget, error);
    throw new Error(`${url}: ${host} could not be resolved (${describe(error)})`);
  }
  const byAddress = judge ? addressRefusal(host, addresses) : addresses.length === 0 ? `${host} resolves to no address` : null;
  if (byAddress !== null) throw new Error(`${url}: ${byAddress}`);
  return addresses;
}

/** Fetches one input from a public HTTPS URL under the rules above; every refusal is a sentence naming the URL. In
 * loopback mode a given `resolve` still pins the connection (the test of the pinning itself). */
export async function fetchRemoteInput(url: string, options: RemoteFetchOptions): Promise<RemoteBytes> {
  const loopback = options.loopback === true;
  const refused = urlRefusal(url, loopback);
  if (refused !== null) throw new Error(refused);
  const pinned = loopback && options.resolve === undefined ? null : await checkHost(url, options, !loopback);
  let response: IncomingMessage;
  try {
    response = await requestHead(new URL(url), pinned, options.budget);
  } catch (error) {
    throw fetchError(url, options.budget, error);
  }
  const status = response.statusCode ?? 0;
  if (status >= 300 && status < 400) refuse(response, `${url} redirects (${status}); a redirect is not followed — give the final URL`);
  if (status < 200 || status >= 300) refuse(response, `${url} answered ${status} ${response.statusMessage ?? ""}`.trim());
  const contentType = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!options.accepted.includes(contentType)) refuse(response, `${url} is ${contentType || "(no content type)"}, not one of ${options.accepted.join(", ")}`);
  const declared = Number.parseInt(response.headers["content-length"] ?? "", 10);
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    refuse(response, `${url} is ${(declared / 1_000_000).toFixed(1)} MB by its Content-Length, over ${(options.maxBytes / 1_000_000).toFixed(1)} MB, the limit here`);
  }
  try {
    return { bytes: await readCapped(response, options.maxBytes, url), contentType };
  } catch (error) {
    if (options.budget.signal.aborted) throw fetchError(url, options.budget, error);
    throw error;
  }
}
