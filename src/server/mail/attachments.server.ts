import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AttachmentBody } from "../../lib/mail/backend.ts";
import { lacksWritableLocalData } from "../../lib/runtime.server.ts";

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

async function readAttachmentColumn(id: string, path: string): Promise<Buffer | null> {
  try {
    const { getSql } = await import("../../lib/db.ts");
    const sql = await getSql();
    const rows = await sql.query<{ content_b64: string | null }>(
      `select content_b64 from mail_attachment
       where id = $1 and content_b64 is not null and content_b64 <> ''
       order by case when path = $2 then 0 else 1 end
       limit 1`,
      [id, path],
    );
    const encoded = rows[0]?.content_b64;
    if (!encoded) return null;
    const bytes = Buffer.from(encoded, "base64");
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/** Stored ingest bytes, then a file under data/ingest. Null means the bytes were never stored. */
export async function readStoredAttachment(file: {
  id: string;
  filename: string;
  mime: string;
  path: string;
}): Promise<AttachmentBody | null> {
  const fromDb = await readAttachmentColumn(file.id, file.path);
  if (fromDb) return bodyFromBytes(file.filename, file.mime, fromDb);
  if (lacksWritableLocalData()) return null;
  const bytes = await readIngestBytes(join(process.cwd(), "data", "ingest"), file.path);
  if (!bytes) return null;
  return bodyFromBytes(file.filename, file.mime, bytes);
}
