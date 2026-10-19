import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { classifyThread } from "../../lib/mail/category.ts";
import { attachmentContentBase64, type Address, type Alias, type Attachment, type Message, type Thread } from "../../lib/mail/model.ts";
import { groupByHeaders, normalizeMessageId, threadPlusTag } from "../../lib/mail/threading.ts";

export type IngestIdentity = {
  address: string;
  displayName: string;
  aliases: Alias[];
};

export type SendResult = {
  clientSendId: string;
  status: string;
  replyToMessageId: string | null;
  sentMessageId: string | null;
  error: string | null;
};

export type IngestLoad = {
  identity: IngestIdentity | null;
  threads: Thread[];
  messages: Message[];
  sendResults: SendResult[];
};

const emptyLoad = (): IngestLoad => ({ identity: null, threads: [], messages: [], sendResults: [] });

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asAddress(value: unknown): Address | null {
  if (typeof value === "string") {
    const email = value.trim();
    if (!email.includes("@")) return null;
    const named = email.match(/^(.*)<([^>]+)>$/);
    if (named) {
      const addr = named[2]?.trim() ?? "";
      if (!addr.includes("@")) return null;
      return { name: named[1]?.trim().replace(/^"|"$/g, "") || addr.split("@")[0] || addr, email: addr };
    }
    return { name: email.split("@")[0] || email, email };
  }
  const row = asRecord(value);
  if (!row) return null;
  const email = asString(row.email);
  if (!email.includes("@")) return null;
  return { name: asString(row.name) || email.split("@")[0] || email, email };
}

function asAddressList(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  return value.map(asAddress).filter((item): item is Address => item !== null);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

function clipSignal(value: string, max: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function headerText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(headerText).filter(Boolean).join(", ");
  const row = asRecord(value);
  if (!row) return "";
  return headerText(row.value ?? row.text ?? row.val);
}

/** Mail providers send `headers` as a list of `{ name, value }`, not only as an object. */
function headerPairs(value: unknown): { name: string; value: string }[] {
  if (typeof value === "string") {
    const unfolded = value.replace(/\r\n[ \t]+/g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const pairs: { name: string; value: string }[] = [];
    for (const line of unfolded.split("\n")) {
      const split = line.indexOf(":");
      if (split <= 0) continue;
      const name = line.slice(0, split).trim();
      const text = line.slice(split + 1).trim();
      if (name && text) pairs.push({ name, value: text });
    }
    return pairs;
  }
  if (Array.isArray(value)) {
    const pairs: { name: string; value: string }[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        pairs.push(...headerPairs(item));
        continue;
      }
      if (Array.isArray(item)) {
        const name = headerText(item[0]);
        const text = headerText(item[1]);
        if (name && text) pairs.push({ name, value: text });
        continue;
      }
      const row = asRecord(item);
      if (!row) continue;
      const name = headerText(row.name ?? row.key ?? row.header ?? row.field);
      const text = headerText(row.value ?? row.text ?? row.val);
      if (name && text) pairs.push({ name, value: text });
    }
    return pairs;
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record)
    .map(([name, entry]) => ({ name, value: headerText(entry) }))
    .filter((pair) => pair.name && pair.value);
}

function normalizeHeaderName(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function findHeader(pairs: { name: string; value: string }[], want: string): string {
  return pairs.find((pair) => normalizeHeaderName(pair.name) === want)?.value ?? "";
}

/**
 * List-Unsubscribe and Auto-Submitted from an ingest item or a stored from_json object.
 * A headers list used to be dropped: `asRecord` rejects arrays, so routing never saw them.
 */
export function readMailSignals(value: unknown): { listUnsubscribe: string | null; autoSubmitted: string | null } {
  const row = asRecord(value);
  if (!row) return { listUnsubscribe: null, autoSubmitted: null };
  const own = headerPairs(
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== "headers" && key !== "from" && key !== "to" && key !== "cc" && key !== "bcc")),
  );
  const nested = headerPairs(row.headers);
  const list =
    findHeader(own, "list-unsubscribe") ||
    findHeader(nested, "list-unsubscribe") ||
    findHeader(own, "list-unsubscribe-post") ||
    findHeader(nested, "list-unsubscribe-post");
  const auto = findHeader(own, "auto-submitted") || findHeader(nested, "auto-submitted");
  return { listUnsubscribe: clipSignal(list, 2000), autoSubmitted: clipSignal(auto, 80) };
}

/** Address JSON plus the two automation signals, so a reload can still hide quick replies. */
export function fromJsonWithSignals(message: Message): string {
  const payload: Record<string, string> = { name: message.from.name, email: message.from.email };
  if (message.listUnsubscribe) payload.listUnsubscribe = message.listUnsubscribe;
  if (message.autoSubmitted) payload.autoSubmitted = message.autoSubmitted;
  return JSON.stringify(payload);
}

function asAttachment(value: unknown): Attachment | null {
  const row = asRecord(value);
  if (!row) return null;
  const filename = asString(row.filename);
  if (!filename) return null;
  const id = asString(row.id) || `att_${filename}`;
  const bytes = typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : 0;
  return {
    id,
    filename,
    mime: asString(row.mime) || "application/octet-stream",
    bytes,
    path: asString(row.path),
  };
}

export function deliveryForStatus(status: string): "waiting" | "sent" | "failed" {
  const value = status.trim().toLowerCase();
  if (value === "pending" || value === "waiting" || value === "queued" || value === "awaiting_approval") return "waiting";
  if (value === "failed" || value === "rejected" || value === "error" || value === "declined" || value === "cancelled") {
    return "failed";
  }
  return "sent";
}

export function applySendResults(messages: Message[], results: SendResult[]): Message[] {
  const byClient = new Map(results.map((result) => [result.clientSendId, result]));
  return messages.map((message) => {
    const clientSendId = message.clientSendId;
    if (!clientSendId) return message;
    const result = byClient.get(clientSendId);
    if (!result) return message;
    const delivery = deliveryForStatus(result.status);
    const messageId = delivery === "sent" && result.sentMessageId ? result.sentMessageId : message.messageId;
    return { ...message, delivery, messageId };
  });
}

export function threadIdFromMessage(message: { messageId: string | null; id: string }): string {
  const raw = normalizeMessageId(message.messageId) ?? message.id;
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
  return `thr_${slug || "mail"}`;
}

/**
 * A stored direction wins. A missing direction is inbound unless `from` is the
 * account address, in which case the message is outbound.
 */
export function messageDirection(message: Pick<Message, "direction" | "from">, accountAddress?: string | null): "inbound" | "outbound" {
  if (message.direction === "outbound") return "outbound";
  if (message.direction === "inbound") return "inbound";
  const account = accountAddress?.trim().toLowerCase() ?? "";
  const from = message.from?.email?.trim().toLowerCase() ?? "";
  if (account && from === account) return "outbound";
  return "inbound";
}

function presentMessage(message: Message, accountAddress?: string | null): Message {
  if (message.direction === "inbound" || message.direction === "outbound") return message;
  if (messageDirection(message, accountAddress) !== "outbound") return message;
  return { ...message, direction: "outbound" };
}

export function threadsFromMessages(messages: Message[], unread = new Map<string, boolean>(), accountAddress?: string | null): Thread[] {
  const threads: Thread[] = [];
  for (const group of groupByHeaders(messages)) {
    const root = group[0];
    if (!root) continue;
    const shown = group.map((message) => presentMessage(message, accountAddress));
    const built: Thread = {
      id: threadIdFromMessage(root),
      subject: root.subject || "(no subject)",
      category: "primary",
      labels: [],
      plusTag: threadPlusTag(group),
      starred: false,
      important: false,
      unread: group.some((message) => unread.get(message.id) !== false),
      // A thread that is only outbound mail is not inbox mail. Sent still matches it.
      location: shown.every((message) => messageDirection(message, accountAddress) === "outbound") ? "archive" : "inbox",
      muted: false,
      snoozeUntil: null,
      messages: shown,
      draft: null,
      account: "grokbot",
    };
    threads.push({ ...built, category: classifyThread(built) });
  }
  threads.sort((a, b) => {
    const aDate = Date.parse(a.messages[a.messages.length - 1]?.date ?? "") || 0;
    const bDate = Date.parse(b.messages[b.messages.length - 1]?.date ?? "") || 0;
    return bDate - aDate;
  });
  return threads;
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    // Skip a file we cannot read. Do not log its contents.
    return null;
  }
}

async function insideRoot(rootReal: string, target: string): Promise<string | null> {
  try {
    const real = await realpath(target);
    const fromRoot = relative(rootReal, real);
    if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
    return real;
  } catch {
    return null;
  }
}

async function collectJson(dir: string, root: string, rootReal: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (dir === root && entry.name === "fixtures") continue;
    const full = join(dir, entry.name);
    const real = await insideRoot(rootReal, full);
    if (!real) continue;
    if (entry.isDirectory()) {
      files.push(...(await collectJson(real, root, rootReal)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(real);
    }
  }
  return files;
}

function parseIdentity(row: Record<string, unknown>): IngestIdentity | null {
  const address = asString(row.address);
  if (!address.includes("@")) return null;
  const displayName = asString(row.displayName) || address.split("@")[0] || "You";
  const aliases: Alias[] = [];
  if (Array.isArray(row.aliases)) {
    for (const item of row.aliases) {
      const alias = asRecord(item);
      if (!alias) continue;
      const email = asString(alias.email);
      if (!email.includes("@")) continue;
      const tag = asString(alias.tag);
      aliases.push({
        email,
        tag: tag || null,
        name: asString(alias.name) || (tag ? tag : displayName),
      });
    }
  }
  return { address, displayName, aliases };
}

/** Only the two known directions are stored. Anything else behaves as inbound. */
export function parseDirection(value: unknown): "inbound" | "outbound" | null {
  if (typeof value !== "string") return null;
  const direction = value.trim().toLowerCase();
  if (direction === "inbound" || direction === "outbound") return direction;
  return null;
}

/** Show outbound mail as sent by the mailbox owner. Stored `from` is unchanged. */
export function withOutboundOwner(message: Message, owner: Address): Message {
  if (message.direction !== "outbound") return message;
  if (!owner.email.includes("@")) return message;
  return {
    ...message,
    from: { name: owner.name || owner.email.split("@")[0] || owner.email, email: owner.email },
  };
}

/** UTF-8 bytes of ingest `html` kept in mail_message.html_body. The 5MB request cap is separate. */
export const HTML_BODY_MAX_BYTES = 1_048_576;

/**
 * Ingest `html` stored on the message. Blank values, non-strings, and values
 * over HTML_BODY_MAX_BYTES are omitted so an update can keep the previous body.
 */
export function parseHtmlBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.trim()) return null;
  if (new TextEncoder().encode(value).length > HTML_BODY_MAX_BYTES) return null;
  return value;
}

/** Empty and overlong hints are dropped so they cannot collapse unrelated mail. */
export function parseThreadHint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return null;
  return trimmed;
}

function attachmentContentMap(value: unknown): Map<string, string> {
  const found = new Map<string, string>();
  if (!Array.isArray(value)) return found;
  for (const item of value) {
    const file = asAttachment(item);
    const content = attachmentContentBase64(item);
    if (!file || !content) continue;
    found.set(file.id, content);
  }
  return found;
}

function parseMessage(row: Record<string, unknown>, fallbackId: string): { message: Message; unread: boolean; attachmentContent: Map<string, string> } | null {
  const from = asAddress(row.from);
  if (!from) return null;
  const id = asString(row.id) || fallbackId;
  const attachments = Array.isArray(row.attachments) ? row.attachments.map(asAttachment).filter((item): item is Attachment => item !== null) : [];
  const attachmentContent = attachmentContentMap(row.attachments);
  const signals = readMailSignals(row);
  const message: Message = {
    id,
    messageId: asString(row.messageId) || null,
    inReplyTo: asString(row.inReplyTo) || null,
    references: asStringList(row.references),
    deliveredTo: asString(row.deliveredTo) || null,
    account: asString(row.account) || "primary",
    from,
    to: asAddressList(row.to),
    cc: asAddressList(row.cc),
    bcc: asAddressList(row.bcc),
    subject: asString(row.subject),
    body: typeof row.body === "string" ? row.body : asString(row.text),
    html: parseHtmlBody(row.html),
    date: asString(row.date) || new Date(0).toISOString(),
    attachments,
    delivery: null,
    clientSendId: asString(row.clientSendId) || null,
    threadHint: parseThreadHint(row.threadHint),
    direction: parseDirection(row.direction),
  };
  if (signals.listUnsubscribe) message.listUnsubscribe = signals.listUnsubscribe;
  if (signals.autoSubmitted) message.autoSubmitted = signals.autoSubmitted;
  const unread = row.unread === undefined ? true : Boolean(row.unread);
  return { message, unread, attachmentContent };
}

/** A path the API will not store. Empty is metadata with no file. */
export function attachmentPathUnsafe(path: string): boolean {
  if (!path) return false;
  if (path.includes("\0")) return true;
  if (path.split(/[/\\]/).includes("..")) return true;
  if (isAbsolute(path)) return true;
  if (/^[A-Za-z]:/.test(path) || path.startsWith("\\\\")) return true;
  return false;
}

export function mergeLooseAttachment(messages: Message[], attachment: Attachment, messageId: string | null): void {
  const normalized = normalizeMessageId(messageId);
  const message = messages.find(
    (item) =>
      item.id === attachment.id ||
      (messageId !== null && item.id === messageId) ||
      (normalized !== null && normalizeMessageId(item.messageId) === normalized),
  );
  if (!message) return;
  const existing = message.attachments.find((item) => item.id === attachment.id);
  if (existing) {
    existing.filename = attachment.filename || existing.filename;
    existing.mime = attachment.mime || existing.mime;
    existing.bytes = attachment.bytes || existing.bytes;
    existing.path = attachment.path || existing.path;
    return;
  }
  message.attachments.push(attachment);
}

export type ClassifiedIngest =
  | { ok: true; kind: "account"; identity: IngestIdentity }
  | { ok: true; kind: "thread" }
  | { ok: true; kind: "message"; message: Message; unread: boolean; attachmentContent: Map<string, string> }
  | { ok: true; kind: "attachment"; attachment: Attachment; messageId: string | null; contentB64: string | null }
  | { ok: true; kind: "send-result"; result: SendResult }
  | { ok: false };

/** Classify one ingest item. Unknown and invalid items are skips. */
export function classifyIngestItem(value: unknown): ClassifiedIngest {
  const row = asRecord(value);
  if (!row) return { ok: false };
  const kind = asString(row.kind).toLowerCase();
  if (kind === "account") {
    const identity = parseIdentity(row);
    return identity ? { ok: true, kind: "account", identity } : { ok: false };
  }
  if (kind === "thread") return { ok: true, kind: "thread" };
  if (kind === "message") {
    const id = asString(row.id);
    const messageId = asString(row.messageId);
    if (!id && !messageId) return { ok: false };
    const built = parseMessage(row, id || messageId);
    if (!built?.message.id) return { ok: false };
    return { ok: true, kind: "message", message: built.message, unread: built.unread, attachmentContent: built.attachmentContent };
  }
  if (kind === "attachment") {
    const attachment = asAttachment(row);
    if (!attachment) return { ok: false };
    return {
      ok: true,
      kind: "attachment",
      attachment,
      messageId: asString(row.messageId) || null,
      contentB64: attachmentContentBase64(row),
    };
  }
  if (kind === "send-result") {
    const result = parseSendResult(row);
    return result ? { ok: true, kind: "send-result", result } : { ok: false };
  }
  return { ok: false };
}

function parseSendResult(row: Record<string, unknown>): SendResult | null {
  const clientSendId = asString(row.clientSendId);
  if (!clientSendId) return null;
  return {
    clientSendId,
    status: asString(row.status) || "pending",
    replyToMessageId: asString(row.replyToMessageId) || null,
    sentMessageId: asString(row.sentMessageId) || null,
    error: asString(row.error) || null,
  };
}

/**
 * Read JSON the bot wrote under `dir`. A directory named `fixtures` that is a
 * direct child of `dir` is skipped, so sample mail is not mixed into a live
 * mailbox. Point `dir` at the fixtures folder itself to load the samples.
 * Thread files are hints only and never decide membership.
 */
export async function loadIngest(dir: string): Promise<IngestLoad> {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return emptyLoad();
  } catch {
    return emptyLoad();
  }
  let rootReal = resolve(dir);
  try {
    rootReal = await realpath(dir);
  } catch {
    return emptyLoad();
  }
  const files = await collectJson(rootReal, rootReal, rootReal);
  let identity: IngestIdentity | null = null;
  const messages: Message[] = [];
  const unread = new Map<string, boolean>();
  const looseAttachments: { messageId: string | null; id: string; attachment: Attachment }[] = [];
  const sendResults: SendResult[] = [];

  for (const file of files) {
    const parsed = asRecord(await readJson(file));
    if (!parsed) continue;
    const kind = asString(parsed.kind).toLowerCase();
    if (kind === "account") {
      identity ??= parseIdentity(parsed);
      continue;
    }
    if (kind === "thread") continue;
    if (kind === "message") {
      const built = parseMessage(parsed, `msg_${messages.length + 1}`);
      if (!built) continue;
      messages.push(built.message);
      unread.set(built.message.id, built.unread);
      continue;
    }
    if (kind === "attachment") {
      const attachment = asAttachment(parsed);
      if (!attachment) continue;
      looseAttachments.push({
        messageId: asString(parsed.messageId) || null,
        id: attachment.id,
        attachment,
      });
      continue;
    }
    if (kind === "send-result") {
      const result = parseSendResult(parsed);
      if (result) sendResults.push(result);
    }
  }

  for (const extra of looseAttachments) {
    mergeLooseAttachment(messages, extra.attachment, extra.messageId);
  }

  const withResults = applySendResults(messages, sendResults);
  return {
    identity,
    messages: withResults,
    sendResults,
    threads: threadsFromMessages(withResults, unread, identity?.address),
  };
}
