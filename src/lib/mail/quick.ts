import { latestInbound, localPart } from "./gate.ts";
import {
  type Address,
  type Attachment,
  type Message,
  type Thread,
  parseAddressList,
  replyFields,
  withSignature,
} from "./model.ts";

export type QuickReply = { id: string; name: string; text: string; emoji: string };

export type QuickSend = {
  from: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
  attachments: Attachment[];
  replyToId: string | null;
  replyToMessageId: string | null;
  threadId: string | null;
  draftThreadId: string | null;
  mode: "reply" | "replyAll";
  displayName: string;
};

const AUTO = /^(?:no-?reply|noreply|notifications?|newsletter|mailer-daemon|postmaster)$/i;

export function defaultQuickReplies(): QuickReply[] {
  return [
    { id: "thanks", name: "Thanks", text: "Thanks for the note.", emoji: "" },
    { id: "got", name: "Got it", text: "Got it.", emoji: "" },
    { id: "soon", name: "Will reply", text: "I will reply in full soon.", emoji: "" },
  ];
}

export function quickRepliesOf(value: unknown): QuickReply[] {
  const source = Array.isArray(value) ? value : defaultQuickReplies();
  const out: QuickReply[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; name?: unknown; text?: unknown; emoji?: unknown };
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
    const text = typeof row.text === "string" ? row.text.trim().slice(0, 2000) : "";
    if (!name || !text) continue;
    let id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 64) : `qr_${out.length}`;
    if (seen.has(id)) id = `${id}_${out.length}`;
    seen.add(id);
    const emoji = typeof row.emoji === "string" ? [...row.emoji.trim()].slice(0, 4).join("") : "";
    out.push({ id, name, text, emoji });
    if (out.length >= 5) break;
  }
  return out;
}

export function chipsAllowed(thread: Thread): boolean {
  if (thread.draft) return false;
  if (thread.screen === "pending" || thread.screen === "blocked" || thread.review) return false;
  if (thread.messages.some((message) => message.delivery === "waiting")) return false;
  if (thread.category === "promotions") return false;
  const message = latestInbound(thread);
  if (!message || message.direction === "outbound") return false;
  if (AUTO.test(localPart(message.from.email))) return false;
  return true;
}

/** People other than the mailbox. More than one means a reply-all choice. */
export function otherRecipients(message: Message, mine: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const person of [message.from, ...message.to, ...message.cc]) {
    const email = person.email.trim().toLowerCase();
    if (!email.includes("@") || mine.has(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** One reply payload for the bot approval bridge. This does not send mail. */
export function buildQuickRequest(opts: {
  thread: Thread;
  reply: QuickReply;
  mode: "reply" | "replyAll";
  from: string;
  mine: Set<string>;
  signature: string;
  displayName: string;
}): QuickSend | null {
  if (!chipsAllowed(opts.thread)) return null;
  const message = latestInbound(opts.thread);
  if (!message) return null;
  const fields = replyFields(message, opts.mode, opts.mine);
  const lead = `${opts.reply.emoji ? `${opts.reply.emoji} ` : ""}${opts.reply.text.trim()}`;
  return {
    from: opts.from,
    to: parseAddressList(fields.to),
    cc: parseAddressList(fields.cc),
    bcc: [],
    subject: fields.subject,
    body: withSignature(`${lead}${fields.body}`, opts.signature),
    attachments: [],
    replyToId: message.id,
    replyToMessageId: message.messageId,
    threadId: opts.thread.id,
    draftThreadId: opts.thread.id,
    mode: opts.mode,
    displayName: opts.displayName,
  };
}
