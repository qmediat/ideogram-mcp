/**
 * Local files for an operation's file fields, checked against that operation's limits before any is read: the field
 * must be one of the operation's file fields, a single-file field takes one file, an array field at most its
 * `maxItems`, each file at most its field's limit (src/spec/overlay.ts), all of them together at most the request cap
 * when the specification states one. A symlink is refused (its target could be any file on the machine). A file is
 * sent as `<field>.<ext>`: the local file name never leaves the machine. An `https://` path is a remote input: fetched
 * by the call's RemoteFetcher (src/remote-input.ts: public hosts only) under the same limit and types, after every
 * local file passed its checks.
 */
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileLimitsOf, FONT_FILE_FIELDS, mbText, requestLimitOf } from "./spec/overlay.js";
import type { FileLimit } from "./spec/overlay.js";
import type { Operation } from "./spec/operations.js";
import { isRemoteInput } from "./remote-input.js";
import type { RemoteFetcher } from "./remote-input.js";
import type { UploadPart } from "./wire.js";

/** One local file for one file field. */
export interface FileRef {
  readonly field: string;
  readonly path: string;
}

/** The media types an image upload is sent as, by extension: the three every image field of the specification names
 * ("JPEG, PNG, and WebP are supported"); another type would be refused by the API after the upload. */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** The media types a font upload is sent as (the formats the specification names for a font field). */
export const FONT_TYPES: Readonly<Record<string, string>> = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** The types a field's files may have: fonts for a font field, images for every other. */
export function uploadTypesFor(field: string): Readonly<Record<string, string>> {
  return FONT_FILE_FIELDS.has(field) ? FONT_TYPES : UPLOAD_TYPES;
}

interface CheckedFile {
  readonly ref: FileRef;
  readonly realPath: string;
  readonly bytes: number;
  readonly contentType: string;
}

const mb = mbText;

async function checkFile(ref: FileRef, limit: FileLimit): Promise<CheckedFile> {
  const resolved = resolve(ref.path);
  if ((await lstat(resolved)).isSymbolicLink()) throw new Error(`${ref.field}: symlinks are not uploaded (${ref.path})`);
  const realPath = await realpath(resolved);
  const types = uploadTypesFor(ref.field);
  const contentType = types[extname(realPath).toLowerCase()];
  if (contentType === undefined) {
    throw new Error(`${ref.field}: unsupported file type ${extname(realPath) || "(none)"}; one of ${Object.keys(types).join(", ")}`);
  }
  const bytes = (await stat(realPath)).size;
  if (bytes === 0) throw new Error(`${ref.field}: ${ref.path} is empty`);
  if (bytes > limit.maxBytes) {
    const source = limit.stated ? "the limit Ideogram states for this field" : "this server's limit for a field Ideogram states none for";
    throw new Error(`${ref.field}: ${ref.path} is ${mb(bytes)}, over ${mb(limit.maxBytes)} (${source})`);
  }
  return { ref, realPath, bytes, contentType };
}

function checkCounts(op: Operation, files: readonly FileRef[], limits: ReadonlyMap<string, FileLimit>): void {
  for (const [field, limit] of limits) {
    const count = files.filter((f) => f.field === field).length;
    if (!limit.array && count > 1) throw new Error(`${field} takes one file, ${count} were given`);
    if (limit.maxItems !== null && count > limit.maxItems) throw new Error(`${field} takes at most ${limit.maxItems} files, ${count} were given`);
  }
  const unknown = files.find((f) => !limits.has(f.field));
  if (unknown !== undefined) {
    const fields = [...limits.keys()].join(", ") || "none";
    throw new Error(`${unknown.field} is not a file field of ${op.id} (its file fields: ${fields})`);
  }
}

function extensionFor(types: Readonly<Record<string, string>>, contentType: string): string {
  return Object.entries(types).find(([, type]) => type === contentType)?.[0] ?? "";
}

/** A remote input as the upload part it becomes: fetched under the field's limit and the room the request cap leaves,
 * accepted only as a type the field takes. */
async function fetchRemote(ref: FileRef, limit: FileLimit, room: number, remote: RemoteFetcher | undefined): Promise<UploadPart> {
  if (remote === undefined) throw new Error(`${ref.field}: a URL input needs a running call (not available here): ${ref.path}`);
  const types = uploadTypesFor(ref.field);
  const accepted = [...new Set(Object.values(types))];
  const got = await remote(ref.path, Math.min(limit.maxBytes, room), accepted).catch((error: unknown) => {
    throw new Error(`${ref.field}: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { field: ref.field, filename: `${ref.field}${extensionFor(types, got.contentType)}`, contentType: got.contentType, bytes: got.bytes };
}

function checkRequestCap(op: Operation, total: number): void {
  const cap = requestLimitOf(op);
  if (total <= cap.maxBytes) return;
  const source = cap.stated ? "the limit Ideogram states for this request" : "this server's cap for a request Ideogram states no limit for";
  throw new Error(`the files together are ${mb(total)}; ${op.id} takes a request under ${mb(cap.maxBytes)} (${source})`);
}

/** A checked local file read whole; a file that grew since its check is refused by the bytes actually read. */
async function readLocal(f: CheckedFile, limit: FileLimit): Promise<UploadPart> {
  const bytes = new Uint8Array(await readFile(f.realPath));
  if (bytes.byteLength > limit.maxBytes) throw new Error(`${f.ref.field}: ${f.ref.path} grew to ${mb(bytes.byteLength)} while it was read, over ${mb(limit.maxBytes)}`);
  return { field: f.ref.field, filename: `${f.ref.field}${extname(f.realPath).toLowerCase()}`, contentType: f.contentType, bytes };
}

/** Checks every local file against the operation's limits, reads them (before any fetch, so nothing changes under
 * a download), then fetches the remote inputs one after another, each under the room the request cap still leaves (a
 * body over it is cut as it arrives, never held whole); nothing is read or fetched when any local check fails. The
 * parts keep the caller's order. */
export async function loadUploads(op: Operation, files: readonly FileRef[], remote?: RemoteFetcher): Promise<UploadPart[]> {
  const limits = new Map(fileLimitsOf(op).map((l) => [l.field, l]));
  checkCounts(op, files, limits);
  const local = files.filter((f) => !isRemoteInput(f.path));
  const checked = new Map(await Promise.all(local.map(async (f) => [f, await checkFile(f, limits.get(f.field) as FileLimit)] as const)));
  checkRequestCap(op, [...checked.values()].reduce((sum, f) => sum + f.bytes, 0));
  const read = new Map(await Promise.all([...checked].map(async ([f, own]) => [f, await readLocal(own, limits.get(f.field) as FileLimit)] as const)));
  let total = [...read.values()].reduce((sum, p) => sum + p.bytes.byteLength, 0);
  checkRequestCap(op, total);
  const cap = requestLimitOf(op).maxBytes;
  const parts: UploadPart[] = [];
  for (const f of files) {
    const own = read.get(f);
    if (own !== undefined) {
      parts.push(own);
      continue;
    }
    if (cap - total <= 0) checkRequestCap(op, total + 1); // the local files already fill the request: said as the cap, not as a 0.0 MB limit
    const part = await fetchRemote(f, limits.get(f.field) as FileLimit, cap - total, remote);
    total += part.bytes.byteLength;
    parts.push(part);
  }
  return parts;
}
