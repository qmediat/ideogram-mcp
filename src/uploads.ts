/**
 * Local files for an operation's file fields, checked against that operation's limits before any is read: the field
 * must be one of the operation's file fields, a single-file field takes one file, an array field at most its
 * `maxItems`, each file at most its field's limit (src/spec/overlay.ts), all of them together at most the request cap
 * when the specification states one. A symlink is refused (its target could be any file on the machine). A file is
 * sent as `<field>.<ext>`: the local file name never leaves the machine.
 */
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileLimitsOf, MIB, requestLimitOf } from "./spec/overlay.js";
import type { FileLimit } from "./spec/overlay.js";
import type { Operation } from "./spec/operations.js";
import type { UploadPart } from "./wire.js";

/** One local file for one file field. */
export interface FileRef {
  readonly field: string;
  readonly path: string;
}

/** The media types an upload is sent as, by extension. */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};

interface CheckedFile {
  readonly ref: FileRef;
  readonly realPath: string;
  readonly bytes: number;
  readonly contentType: string;
}

const mb = (bytes: number): string => `${(bytes / MIB).toFixed(1)} MB`;

async function checkFile(ref: FileRef, limit: FileLimit): Promise<CheckedFile> {
  const resolved = resolve(ref.path);
  if ((await lstat(resolved)).isSymbolicLink()) throw new Error(`${ref.field}: symlinks are not uploaded (${ref.path})`);
  const realPath = await realpath(resolved);
  const contentType = UPLOAD_TYPES[extname(realPath).toLowerCase()];
  if (contentType === undefined) {
    throw new Error(`${ref.field}: unsupported file type ${extname(realPath) || "(none)"}; one of ${Object.keys(UPLOAD_TYPES).join(", ")}`);
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

/** Checks every file against the operation's limits, then reads them; nothing is read when any check fails. */
export async function loadUploads(op: Operation, files: readonly FileRef[]): Promise<UploadPart[]> {
  const limits = new Map(fileLimitsOf(op).map((l) => [l.field, l]));
  checkCounts(op, files, limits);
  const checked = await Promise.all(files.map((f) => checkFile(f, limits.get(f.field) as FileLimit)));
  const total = checked.reduce((sum, f) => sum + f.bytes, 0);
  const cap = requestLimitOf(op);
  if (cap !== null && total > cap) throw new Error(`the files together are ${mb(total)}; ${op.id} takes a request under ${mb(cap)}`);
  return Promise.all(
    checked.map(async (f) => ({
      field: f.ref.field,
      filename: `${f.ref.field}${extname(f.realPath).toLowerCase()}`,
      contentType: f.contentType,
      bytes: new Uint8Array(await readFile(f.realPath)),
    })),
  );
}
