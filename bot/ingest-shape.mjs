/** Limits copied from the app ingest API. Do not put tokens in this file. */

export const HTML_MAX_BYTES = 1_048_576;
export const ATTACHMENT_MAX_BYTES = 1_048_576;
export const REQUEST_MAX_BYTES = 5 * 1024 * 1024;

export function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

/** Standard base64 that round-trips. Null when it is empty or not base64. */
export function decodeBase64(raw) {
  if (typeof raw !== "string") return null;
  const compact = raw.replace(/\s/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== compact) return null;
  return bytes;
}

/** HTML kept on a message. Over the cap, the plain body stays and html is omitted. */
export function clipHtml(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (utf8Bytes(value) > HTML_MAX_BYTES) return undefined;
  return value;
}
