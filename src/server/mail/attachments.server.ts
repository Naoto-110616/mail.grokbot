import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { AttachmentBody } from "../../lib/mail/backend.ts";

export function resolveInside(root: string, relPath: string): string | null {
  if (!relPath || relPath.includes("\0") || isAbsolute(relPath)) return null;
  const base = resolve(root);
  const target = resolve(base, relPath);
  const fromRoot = relative(base, target);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
  return target;
}

export function isTextual(mime: string): boolean {
  const value = mime.toLowerCase();
  return value.startsWith("text/") || value === "application/json" || value === "application/xml" || value.endsWith("+xml");
}

export function bodyFromBytes(filename: string, mime: string, bytes: Buffer): AttachmentBody {
  if (isTextual(mime) || mime === "") {
    return { filename, mime: mime || "text/plain", text: bytes.toString("utf8"), base64: null };
  }
  return { filename, mime, text: "", base64: bytes.toString("base64") };
}

export async function readIngestBytes(root: string, relPath: string): Promise<Buffer | null> {
  const target = resolveInside(root, relPath);
  if (!target) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}
