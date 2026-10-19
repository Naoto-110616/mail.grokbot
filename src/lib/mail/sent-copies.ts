import type { Message } from "./model.ts";

/**
 * One sent email can reach the mailbox twice: the app's own copy of a send
 * (it carries the clientSendId and the id `msg_<providerMessageId>`), and the
 * bot inbox's copy of that same outgoing message posted back through
 * POST /api/ingest. These helpers find the pair and fold it into one message.
 */

/** A sent copy and the app's row must be this close in time to match without an id. */
export const SENT_COPY_WINDOW_MS = 15 * 60 * 1000;

export type SentCopyCandidate = Pick<Message, "id" | "messageId" | "from" | "to" | "subject" | "date"> &
  Partial<Pick<Message, "clientSendId" | "direction">>;

function key(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return trimmed || null;
}

function withoutSentPrefix(id: string): string {
  return id.startsWith("msg_") ? id.slice(4) : id;
}

/** True for the app's own record of a send. */
export function isAppSentCopy(message: Pick<Message, "clientSendId">): boolean {
  return typeof message.clientSendId === "string" && message.clientSendId.trim() !== "";
}

/** Ids that name the provider message behind an app send: `msg_<id>` and the stored message id. */
export function appSentKeys(message: Pick<Message, "id" | "messageId">): string[] {
  const keys = [key(withoutSentPrefix(message.id)), key(message.messageId)];
  return [...new Set(keys.filter((item): item is string => item !== null))];
}

/** Ids a copy from the bot inbox may carry for that same provider message. */
export function copyKeys(message: Pick<Message, "id" | "messageId">): string[] {
  const keys = [key(message.id), key(withoutSentPrefix(message.id)), key(message.messageId)];
  return [...new Set(keys.filter((item): item is string => item !== null))];
}

function emailOf(value: { email?: string } | null | undefined): string {
  return (value?.email ?? "").trim().toLowerCase();
}

function recipientsOf(list: readonly { email?: string }[] | null | undefined): string {
  return [...new Set((list ?? []).map(emailOf).filter(Boolean))].sort().join(",");
}

function subjectOf(subject: string | null | undefined): string {
  return (subject ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function timeOf(date: string | null | undefined): number | null {
  const ms = Date.parse(date ?? "");
  return Number.isNaN(ms) ? null : ms;
}

/** How far apart two copies are in time, or null when they cannot be the same send. */
export function fuzzySentDistance(app: SentCopyCandidate, copy: SentCopyCandidate): number | null {
  if (copy.direction === "inbound") return null;
  const from = emailOf(app.from);
  if (!from || from !== emailOf(copy.from)) return null;
  if (recipientsOf(app.to) !== recipientsOf(copy.to)) return null;
  if (subjectOf(app.subject) !== subjectOf(copy.subject)) return null;
  // An app row that already took a real Message-ID belongs to that message only.
  const appId = key(app.messageId);
  const copyId = key(copy.messageId);
  if (appId && appId.includes("@") && copyId && appId !== copyId) return null;
  const a = timeOf(app.date);
  const b = timeOf(copy.date);
  if (a === null || b === null) return null;
  const distance = Math.abs(a - b);
  return distance <= SENT_COPY_WINDOW_MS ? distance : null;
}

/** Whether `copy` can be folded into the app's row at all. */
function mayPair(app: SentCopyCandidate, copy: SentCopyCandidate): boolean {
  if (app.id === copy.id) return false;
  if (!isAppSentCopy(app)) return false;
  if (isAppSentCopy(copy) && copy.clientSendId !== app.clientSendId) return false;
  return true;
}

/** "id" when an id names the same provider message, "fuzzy" for a from+to+subject+time match. */
export function sentCopyMatch(app: SentCopyCandidate, copy: SentCopyCandidate): "id" | "fuzzy" | null {
  if (!mayPair(app, copy)) return null;
  if (isAppSentCopy(copy) && copy.clientSendId === app.clientSendId) return "id";
  const wanted = new Set(appSentKeys(app));
  if (copyKeys(copy).some((item) => wanted.has(item))) return "id";
  return fuzzySentDistance(app, copy) === null ? null : "fuzzy";
}

/** The best copy for one app row: an id match first, then the closest fuzzy match. */
export function bestSentCopy<T extends SentCopyCandidate>(app: SentCopyCandidate, copies: readonly T[]): T | null {
  let fuzzy: { item: T; distance: number } | null = null;
  for (const copy of copies) {
    const match = sentCopyMatch(app, copy);
    if (match === "id") return copy;
    if (match !== "fuzzy") continue;
    const distance = fuzzySentDistance(app, copy) ?? Number.POSITIVE_INFINITY;
    if (!fuzzy || distance < fuzzy.distance) fuzzy = { item: copy, distance };
  }
  return fuzzy?.item ?? null;
}

/**
 * One message for the pair. The inbox copy brings the real headers and content.
 * The app row keeps its id, its clientSendId, and its thread hint so Outbox
 * links and thread placement stay put.
 */
export function mergeSentCopy(app: Message, copy: Message): Message {
  return {
    ...copy,
    id: app.id,
    messageId: copy.messageId ?? app.messageId,
    inReplyTo: copy.inReplyTo ?? app.inReplyTo,
    references: copy.references.length > 0 ? copy.references : app.references,
    from: copy.from?.email ? copy.from : app.from,
    to: copy.to.length > 0 ? copy.to : app.to,
    cc: copy.cc.length > 0 ? copy.cc : app.cc,
    bcc: copy.bcc.length > 0 ? copy.bcc : app.bcc,
    subject: copy.subject || app.subject,
    body: copy.body || app.body,
    html: copy.html ?? app.html ?? null,
    date: copy.date || app.date,
    attachments: copy.attachments.length > 0 ? copy.attachments : app.attachments,
    delivery: app.delivery ?? copy.delivery ?? null,
    clientSendId: app.clientSendId,
    threadHint: app.threadHint ?? copy.threadHint ?? null,
    direction: "outbound",
    deliveredTo: copy.deliveredTo ?? app.deliveredTo,
  };
}

/**
 * Fold every app send with its copy from the bot inbox. `merged` maps each
 * dropped message id to the id that now carries it. Each copy pairs with one
 * send; id matches win over fuzzy ones, and a fuzzy pair goes to the closest send.
 */
export function dedupeSentCopies<T extends Message>(messages: readonly T[]): { messages: T[]; merged: Map<string, string> } {
  const merged = new Map<string, string>();
  const apps = messages.filter(isAppSentCopy);
  if (apps.length === 0) return { messages: [...messages], merged };
  const taken = new Set<string>();
  const pairs = new Map<string, T>();

  // Id matches first.
  for (const app of apps) {
    if (taken.has(app.id)) continue;
    for (const copy of messages) {
      if (taken.has(copy.id) || pairs.has(copy.id)) continue;
      if (sentCopyMatch(app, copy) !== "id") continue;
      pairs.set(app.id, copy);
      taken.add(copy.id);
      taken.add(app.id);
      break;
    }
  }

  // Then the closest from+to+subject+time pairs.
  const fuzzy: { app: T; copy: T; distance: number }[] = [];
  for (const app of apps) {
    if (taken.has(app.id)) continue;
    for (const copy of messages) {
      if (taken.has(copy.id) || isAppSentCopy(copy)) continue;
      if (sentCopyMatch(app, copy) !== "fuzzy") continue;
      fuzzy.push({ app, copy, distance: fuzzySentDistance(app, copy) ?? Number.POSITIVE_INFINITY });
    }
  }
  fuzzy.sort((a, b) => a.distance - b.distance);
  for (const pair of fuzzy) {
    if (taken.has(pair.app.id) || taken.has(pair.copy.id)) continue;
    pairs.set(pair.app.id, pair.copy);
    taken.add(pair.app.id);
    taken.add(pair.copy.id);
  }

  if (pairs.size === 0) return { messages: [...messages], merged };
  const dropped = new Set<string>();
  for (const [appId, copy] of pairs) {
    dropped.add(copy.id);
    merged.set(copy.id, appId);
  }
  const out: T[] = [];
  for (const message of messages) {
    if (dropped.has(message.id)) continue;
    const copy = pairs.get(message.id);
    out.push(copy ? (mergeSentCopy(message, copy) as T) : message);
  }
  return { messages: out, merged };
}
