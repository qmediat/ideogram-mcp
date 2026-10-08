/**
 * The four request locations and their serialization, as pure functions (the bytes are what test/wire.test.mjs pins):
 *
 * - path: `{name}` segments, percent-encoded;
 * - query: scalars as `name=value`, arrays as repeated `name=value` pairs (OpenAPI form style, explode — the only
 *   array style the snapshot uses; the generator refuses any other);
 * - headers: as given;
 * - body: `application/json`, or `multipart/form-data` with a boundary the caller may fix: scalars as text parts,
 *   arrays of scalars as repeated text parts, objects, arrays of objects and the fields the specification encodes as
 *   JSON as `application/json` parts, then the files.
 */
import { randomBytes } from "node:crypto";
import type { BodyMedia } from "./spec/facts.js";
import type { BodyFields } from "./spec/overlay.js";

export type Scalar = string | number | boolean;
export type QueryValue = Scalar | readonly Scalar[];

export interface UploadPart {
  readonly field: string;
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface BodyInput {
  readonly media: BodyMedia;
  readonly fields: BodyFields;
  readonly files: readonly UploadPart[];
  /** The multipart fields the specification encodes as `application/json`. */
  readonly jsonParts: readonly string[];
}

export interface EncodedBody {
  readonly contentType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

const encoder = new TextEncoder();

/** The URL of a request: the path template filled in, then the query in the order given. */
export function buildUrl(
  base: string,
  template: string,
  path: Readonly<Record<string, Scalar>>,
  query: Readonly<Record<string, QueryValue>>,
): string {
  const filled = template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = path[name];
    if (value === undefined) throw new Error(`the path parameter ${name} is missing`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue; // an absent optional is not sent as "undefined"
    const values = Array.isArray(value) ? value : [value as Scalar];
    for (const item of values) search.append(name, String(item));
  }
  const qs = search.toString();
  return `${base}${filled}${qs ? `?${qs}` : ""}`;
}

export function encodeJson(fields: BodyFields): EncodedBody {
  return { contentType: "application/json", bytes: encoder.encode(JSON.stringify(fields)) };
}

export function newBoundary(): string {
  return `----ideogram-mcp-${randomBytes(12).toString("hex")}`;
}

/** The WHATWG escaping of a multipart name or filename: `"` and line breaks percent-encoded. */
function escapeHeaderValue(value: string): string {
  return value.replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22");
}

interface Part {
  readonly name: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly data: Uint8Array<ArrayBuffer>;
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function jsonPart(name: string, value: unknown): Part {
  return { name, contentType: "application/json", data: encoder.encode(JSON.stringify(value)) };
}

/** The parts one field becomes. */
function fieldParts(name: string, value: unknown, asJson: boolean): Part[] {
  if (value === undefined || value === null) return [];
  if (asJson) return [jsonPart(name, value)];
  if (isScalar(value)) return [{ name, data: encoder.encode(String(value)) }];
  if (Array.isArray(value) && value.every(isScalar)) {
    return value.map((item) => ({ name, data: encoder.encode(String(item)) }));
  }
  return [jsonPart(name, value)];
}

function partHeader(boundary: string, part: Part): string {
  const filename = part.filename === undefined ? "" : `; filename="${escapeHeaderValue(part.filename)}"`;
  const type = part.contentType === undefined ? "" : `Content-Type: ${part.contentType}\r\n`;
  return `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeaderValue(part.name)}"${filename}\r\n${type}\r\n`;
}

function concat(chunks: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export function encodeMultipart(input: BodyInput, boundary: string = newBoundary()): EncodedBody {
  const parts: Part[] = [];
  for (const [name, value] of Object.entries(input.fields)) {
    parts.push(...fieldParts(name, value, input.jsonParts.includes(name)));
  }
  for (const file of input.files) {
    parts.push({ name: file.field, filename: file.filename, contentType: file.contentType, data: file.bytes });
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (const part of parts) chunks.push(encoder.encode(partHeader(boundary, part)), part.data, encoder.encode("\r\n"));
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, bytes: concat(chunks) };
}

/** The body as the operation takes it; files force multipart (a JSON body cannot carry them). */
export function encodeBody(input: BodyInput, boundary?: string): EncodedBody {
  if (input.media === "json") {
    if (input.files.length > 0) throw new Error("files need a multipart body; the operation takes JSON only");
    return encodeJson(input.fields);
  }
  return encodeMultipart(input, boundary);
}
