#!/usr/bin/env node
/**
 * Turn a raw message or JSON into the ingest API shape.
 * Paths come from argv or GBM_INGEST_FILE. No tokens are read or written.
 * A custom ingest id paired with a bot inbox id is merged into the ids map
 * (GBM_IDS_MAP, or ~/.config/grokbot-mail/ids.json). msg_<n> needs no map entry.
 *
 *   node bot/convert-ingest.mjs message.eml > items.json
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ATTACHMENT_MAX_BYTES, clipHtml, decodeBase64 } from "./ingest-shape.mjs";
import { canonicalInboxId, idsMapPath, inboxIdFromIngestId, mergeIdsMap } from "./reply-id.mjs";

const PASSTHROUGH = new Set(["account", "thread", "send-result"]);

function stringOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function stableId(basis) {
  return `msg_${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

/**
 * Ingest id for a message. A known bot inbox id n becomes msg_<n>, unless the
 * source already has a custom id (not a bare integer and not msg_<n>).
 * botId is set when the source names one, so the caller can write a fallback map.
 */
export function assignMessageId(row, basis) {
  const named = canonicalInboxId(row?.inboxId) ?? canonicalInboxId(row?.botMessageId);
  const explicit = stringOf(row?.id);
  const numericId = canonicalInboxId(row?.id);
  const prefixedId = inboxIdFromIngestId(explicit);
  const custom = Boolean(explicit) && numericId === null && prefixedId === null;
  const botId = named ?? numericId ?? prefixedId;
  let id;
  if (named && custom) id = explicit;
  else if (botId) id = `msg_${botId}`;
  else id = explicit || stableId(basis);
  return { id, botId: botId ?? null };
}

/** Map entry for a custom ingest id. msg_<n> needs none. */
export function fallbackIdEntry(row, item) {
  if (!item || item.kind !== "message" || !row || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }
  const named = canonicalInboxId(row.inboxId) ?? canonicalInboxId(row.botMessageId);
  if (!named || item.id === `msg_${named}`) return null;
  return [item.id, named];
}

export function headersFrom(value) {
  if (typeof value === "string") return headerLines(value);
  if (Array.isArray(value)) {
    const pairs = [];
    for (const item of value) {
      if (typeof item === "string") {
        pairs.push(...headerLines(item));
        continue;
      }
      if (Array.isArray(item)) {
        const name = stringOf(item[0]);
        const text = stringOf(typeof item[1] === "string" ? item[1] : "");
        if (name && text) pairs.push({ name, value: text });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const name = stringOf(item.name ?? item.key);
      const text = stringOf(item.value ?? item.text);
      if (name && text) pairs.push({ name, value: text });
    }
    return pairs;
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .map(([name, entry]) => ({ name, value: stringOf(typeof entry === "string" ? entry : "") }))
    .filter((pair) => pair.name && pair.value);
}

function headerLines(value) {
  const unfolded = value
    .replace(/\r\n[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const pairs = [];
  for (const line of unfolded.split("\n")) {
    const split = line.indexOf(":");
    if (split <= 0) continue;
    const name = line.slice(0, split).trim();
    const text = line.slice(split + 1).trim();
    if (name && text) pairs.push({ name, value: text });
  }
  return pairs;
}

function headerValue(pairs, name) {
  const want = name.toLowerCase();
  return pairs.find((pair) => pair.name.toLowerCase() === want)?.value ?? "";
}

function addressFromText(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.*)<([^>]+)>$/);
  if (match) {
    const email = match[2].trim();
    if (!email.includes("@")) return null;
    const name = match[1].trim().replace(/^"|"$/g, "") || email.split("@")[0];
    return { name, email };
  }
  if (!trimmed.includes("@") || trimmed.includes(" ")) return null;
  return { name: trimmed.split("@")[0] || trimmed, email: trimmed };
}

function asAddress(value) {
  if (typeof value === "string") return addressFromText(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const email = stringOf(value.email);
  if (!email.includes("@")) return null;
  return { name: stringOf(value.name) || email.split("@")[0] || email, email };
}

function addressList(value) {
  if (Array.isArray(value)) return value.map(asAddress).filter((item) => item !== null);
  if (typeof value === "string")
    return value
      .split(",")
      .map(addressFromText)
      .filter((item) => item !== null);
  return [];
}

function isoDate(value) {
  const text = stringOf(value);
  if (!text) return new Date(0).toISOString();
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return text;
  return new Date(ms).toISOString();
}

export function normalizeAttachment(file, contentById = {}) {
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const filename = stringOf(file.filename) || "attachment";
  const id = stringOf(file.id) || `att_${filename}`;
  let content = typeof file.content === "string" ? file.content : undefined;
  if (
    Object.prototype.hasOwnProperty.call(contentById, id) &&
    typeof contentById[id] === "string"
  ) {
    content = contentById[id];
  }
  const out = {
    id,
    filename,
    mime: stringOf(file.mime) || "application/octet-stream",
    bytes: typeof file.bytes === "number" && Number.isFinite(file.bytes) ? file.bytes : 0,
    path: typeof file.path === "string" ? file.path : "",
  };
  if (typeof content === "string") {
    const decoded = decodeBase64(content);
    if (decoded && decoded.length <= ATTACHMENT_MAX_BYTES) {
      out.content = decoded.toString("base64");
      if (!out.bytes) out.bytes = decoded.length;
    }
  }
  return out;
}

export function normalizeMessage(row, contentById = {}) {
  const from = asAddress(row.from);
  if (!from) return null;
  const headers = headersFrom(row.headers);
  const messageId = stringOf(row.messageId) || headerValue(headers, "message-id");
  const body = typeof row.body === "string" ? row.body : stringOf(row.text);
  const basis = messageId || `${from.email}\n${stringOf(row.subject)}\n${body}`;
  const { id } = assignMessageId(row, basis);
  const attachments = Array.isArray(row.attachments)
    ? row.attachments
        .map((file) => normalizeAttachment(file, contentById))
        .filter((item) => item !== null)
    : [];
  const item = {
    kind: "message",
    id,
    from,
    to: addressList(row.to),
    cc: addressList(row.cc),
    bcc: addressList(row.bcc),
    subject: stringOf(row.subject),
    body,
    date: isoDate(row.date),
  };
  const deliveredTo =
    stringOf(row.deliveredTo) ||
    headerValue(headers, "delivered-to") ||
    headerValue(headers, "x-original-to");
  if (deliveredTo) item.deliveredTo = deliveredTo;
  const account = stringOf(row.account);
  if (account) item.account = account;
  if (messageId) item.messageId = messageId;
  const inReplyTo = stringOf(row.inReplyTo);
  if (inReplyTo) item.inReplyTo = inReplyTo;
  if (Array.isArray(row.references))
    item.references = row.references.filter((entry) => typeof entry === "string");
  const html = clipHtml(row.html);
  if (html) item.html = html;
  if (headers.length > 0) item.headers = headers;
  if (row.direction === "inbound" || row.direction === "outbound") item.direction = row.direction;
  if (typeof row.unread === "boolean") item.unread = row.unread;
  if (stringOf(row.threadHint)) item.threadHint = stringOf(row.threadHint);
  if (attachments.length > 0) item.attachments = attachments;
  return item;
}

function splitHeaders(raw) {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const splitAt = text.indexOf("\n\n");
  if (splitAt < 0) return { headerText: text, body: "" };
  return { headerText: text.slice(0, splitAt), body: text.slice(splitAt + 2) };
}

function contentTypeOf(value) {
  const [type, ...rest] = (value || "text/plain").split(";");
  const params = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const text = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (key) params[key] = text;
  }
  return { type: (type || "").trim().toLowerCase(), params };
}

function decodePart(body, encoding) {
  const enc = encoding.trim().toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/\s/g, ""), "base64");
  if (enc === "quoted-printable") {
    const cleaned = body.replace(/=\n/g, "");
    const bytes = [];
    for (let i = 0; i < cleaned.length; i += 1) {
      if (cleaned[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
        bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
        i += 2;
        continue;
      }
      bytes.push(cleaned.charCodeAt(i) & 0xff);
    }
    return Buffer.from(bytes);
  }
  return Buffer.from(body, "utf8");
}

function filenameOf(disposition, params) {
  const star = disposition.match(/filename\*=(?:UTF-8|utf-8)''([^;\s]+)/);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const quoted = disposition.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = disposition.match(/filename=([^;\s]+)/i);
  if (plain?.[1]) return plain[1];
  return params.name || "attachment";
}

function splitMultipart(body, boundary) {
  const parts = [];
  for (const chunk of body.split(`--${boundary}`)) {
    let piece = chunk.replace(/\n$/, "");
    if (piece.startsWith("--")) continue;
    if (piece.startsWith("\n")) piece = piece.slice(1);
    if (!piece.trim()) continue;
    parts.push(piece);
  }
  return parts;
}

export function messageFromMime(raw, contentById = {}) {
  const { headerText, body } = splitHeaders(raw);
  const headers = headerLines(headerText);
  const top = contentTypeOf(headerValue(headers, "content-type"));
  let text = "";
  let html = "";
  const attachments = [];
  if (top.type.startsWith("multipart/") && top.params.boundary) {
    let index = 0;
    for (const part of splitMultipart(body, top.params.boundary)) {
      const parsed = splitHeaders(part);
      const partHeaders = headerLines(parsed.headerText);
      const partType = contentTypeOf(headerValue(partHeaders, "content-type") || "text/plain");
      const bytes = decodePart(parsed.body, headerValue(partHeaders, "content-transfer-encoding"));
      if (partType.type === "text/plain" && !text) text = bytes.toString("utf8").trim();
      else if (partType.type === "text/html" && !html) html = bytes.toString("utf8").trim();
      else if (!partType.type.startsWith("multipart/")) {
        index += 1;
        const file = normalizeAttachment(
          {
            id: `att_${index}`,
            filename: filenameOf(headerValue(partHeaders, "content-disposition"), partType.params),
            mime: partType.type || "application/octet-stream",
            bytes: bytes.length,
            path: "",
            content: bytes.toString("base64"),
          },
          contentById,
        );
        if (file) attachments.push(file);
      }
    }
  } else {
    const bytes = decodePart(body, headerValue(headers, "content-transfer-encoding"));
    const decoded = bytes.toString("utf8").trim();
    if (top.type === "text/html") html = decoded;
    else text = decoded;
  }
  const built = normalizeMessage(
    {
      from: headerValue(headers, "from"),
      to: headerValue(headers, "to"),
      cc: headerValue(headers, "cc"),
      subject: headerValue(headers, "subject"),
      body: text,
      html,
      date: headerValue(headers, "date"),
      messageId: headerValue(headers, "message-id"),
      headers,
      attachments,
    },
    contentById,
  );
  if (!built) {
    const error = new Error("invalid");
    error.code = "invalid";
    throw error;
  }
  return built;
}

function contentMapOf(value, base) {
  const extra = { ...base };
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.contentById &&
    typeof value.contentById === "object"
  ) {
    for (const [id, content] of Object.entries(value.contentById)) {
      if (typeof content === "string") extra[id] = content;
    }
  }
  return extra;
}

function normalizeItem(row, contentById) {
  if (typeof row === "string") return messageFromMime(row, contentById);
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (typeof row.raw === "string") {
    const built = messageFromMime(row.raw, contentById);
    const delivered = stringOf(row.deliveredTo);
    if (delivered) built.deliveredTo = delivered;
    const account = stringOf(row.account);
    if (account) built.account = account;
    if (row.id !== undefined || row.inboxId !== undefined || row.botMessageId !== undefined) {
      built.id = assignMessageId(row, built.id).id;
    }
    return built;
  }
  const kind = stringOf(row.kind).toLowerCase();
  if (PASSTHROUGH.has(kind)) return { ...row, kind };
  if (kind === "attachment") {
    const file = normalizeAttachment(row, contentById);
    if (!file) return null;
    const item = { kind: "attachment", ...file };
    const messageId = stringOf(row.messageId);
    if (messageId) item.messageId = messageId;
    return item;
  }
  if (kind === "message" || row.from)
    return normalizeMessage({ ...row, kind: "message" }, contentById);
  return null;
}

export function convertInput(text, contentById = {}) {
  const trimmed = String(text)
    .replace(/^\uFEFF/, "")
    .trim();
  if (!trimmed) {
    const error = new Error("invalid");
    error.code = "invalid";
    throw error;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return { items: [messageFromMime(trimmed, contentById)], ids: {} };
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const error = new Error("invalid");
    error.code = "invalid";
    throw error;
  }
  const extra = contentMapOf(parsed, contentById);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : [parsed];
  const items = [];
  const ids = {};
  for (const row of rows) {
    const item = normalizeItem(row, extra);
    if (!item) continue;
    items.push(item);
    const entry = fallbackIdEntry(row, item);
    if (entry) ids[entry[0]] = entry[1];
  }
  if (items.length === 0) {
    const error = new Error("invalid");
    error.code = "invalid";
    throw error;
  }
  return { items, ids };
}

function takeArgs(argv) {
  let contentFile = "";
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--content-file") {
      contentFile = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }
  return { contentFile, file: positional[0] ?? "" };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

function usage() {
  console.error("Usage: node bot/convert-ingest.mjs <file>");
  console.error("Reads GBM_INGEST_FILE when no path is given. Prints ingest JSON to stdout.");
  console.error(
    "A custom id with a bot inbox id is merged into GBM_IDS_MAP, or ~/.config/grokbot-mail/ids.json.",
  );
}

async function main() {
  const args = takeArgs(process.argv.slice(2));
  const file = args.file || String(process.env.GBM_INGEST_FILE ?? "").trim();
  if (!file) {
    usage();
    process.exit(2);
  }
  let text = "";
  let contentById = {};
  try {
    text = await readFile(file, "utf8");
    if (args.contentFile) {
      const raw = readFileSync(args.contentFile, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("invalid");
      contentById = parsed;
    }
  } catch {
    console.error("invalid");
    process.exit(1);
  }
  let converted;
  try {
    converted = convertInput(text, contentById);
  } catch {
    console.error("invalid");
    process.exit(1);
  }
  if (Object.keys(converted.ids).length > 0) {
    try {
      await mergeIdsMap(idsMapPath(process.env), converted.ids);
    } catch {
      console.error("map");
      process.exit(1);
    }
  }
  process.stdout.write(`${JSON.stringify({ items: converted.items })}\n`);
}

if (isDirectRun()) {
  main();
}
