import { readFile } from "node:fs/promises";
import { validateInputImage } from "./storage.js";

export async function loadImageBlob(rawPath: string): Promise<{ blob: Blob; filename: string }> {
  const { resolvedPath, meta } = await validateInputImage(rawPath);
  const buffer = await readFile(resolvedPath);
  const blob = new Blob([new Uint8Array(buffer)], { type: meta.mimeType });
  return { blob, filename: meta.filename };
}
