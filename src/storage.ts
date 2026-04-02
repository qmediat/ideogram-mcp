import { mkdir, writeFile, stat, lstat, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { getConfig } from "./config.js";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB — Ideogram API limit

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function generateFilename(extension = "png"): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString("hex");
  return `ideogram-${timestamp}-${random}.${extension}`;
}

export function ensureWithinDir(filePath: string, dir: string): void {
  const resolved = resolve(filePath);
  const resolvedDir = resolve(dir);
  const rel = relative(resolvedDir, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${filePath} escapes ${dir}`);
  }
}

export function getImageMeta(filePath: string): { extension: string; mimeType: string; filename: string } {
  const ext = extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`);
  }
  const mimeType = MIME_MAP[ext] ?? "application/octet-stream";
  const cleanExt = ext.replace(".", "");
  return { extension: cleanExt, mimeType, filename: `image.${cleanExt}` };
}

export async function validateFileSize(filePath: string): Promise<void> {
  const stats = await stat(filePath);
  if (stats.size > MAX_IMAGE_SIZE) {
    throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds 10MB limit`);
  }
  if (stats.size === 0) {
    throw new Error("File is empty");
  }
}

/**
 * Validates an input image path for tools that accept user-provided images.
 * Does NOT restrict to a specific directory (user may describe any of their images),
 * but validates: absolute path, file exists, allowed extension, size limit.
 */
export async function validateInputImage(rawPath: string): Promise<{
  resolvedPath: string;
  meta: { extension: string; mimeType: string; filename: string };
}> {
  const resolvedPath = resolve(rawPath);

  // Reject if the file itself is a symlink BEFORE resolving (prevents evil.png → target bypass)
  const lstats = await lstat(resolvedPath);
  if (lstats.isSymbolicLink()) {
    throw new Error(`Symlinks not allowed: ${rawPath}`);
  }

  // Resolve system-level symlinks (e.g. /tmp → /private/tmp on macOS) for actual reading
  const realPath = await realpath(resolvedPath);

  // Validate extension on the real target
  const meta = getImageMeta(realPath);

  // Validate existence and size
  await validateFileSize(realPath);

  return { resolvedPath: realPath, meta };
}

export async function saveImage(
  data: Buffer,
  extension = "png",
): Promise<string> {
  const config = getConfig();
  const outputDir = resolve(config.outputDir);

  await mkdir(outputDir, { recursive: true });

  const filename = generateFilename(extension);
  const filePath = join(outputDir, filename);

  ensureWithinDir(filePath, outputDir);

  await writeFile(filePath, data);
  return filePath;
}
