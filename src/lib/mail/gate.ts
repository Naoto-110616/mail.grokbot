import { mineSet, type Alias, type Thread } from "./model.ts";

export type GateMode = "before" | "inside" | "off";
export type GateStatus = "pending" | "accepted" | "blocked";
export type GateBook = {
  mode: GateMode;
  senders: Record<string, "accepted" | "blocked">;
  domains: string[];
};

const SYSTEM = new Set(["grokbot", "mailer-daemon", "postmaster"]);

export function defaultGate(): GateBook {
  return { mode: "off", senders: {}, domains: [] };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  const key = normalizeEmail(email);
  const at = key.lastIndexOf("@");
  return at >= 0 ? key.slice(at + 1) : "";
}

export function localPart(email: string): string {
  return (normalizeEmail(email).split("@")[0] ?? "").split("+")[0] ?? "";
}

export function isSystemSender(email: string): boolean {
  return SYSTEM.has(localPart(email));
}

export function gateBookOf(value: unknown): GateBook {
  if (!value || typeof value !== "object") return defaultGate();
  const row = value as { mode?: unknown; senders?: unknown; domains?: unknown };
  const mode: GateMode = row.mode === "inside" || row.mode === "off" || row.mode === "before" ? row.mode : "off";
  const senders: GateBook["senders"] = {};
  if (row.senders && typeof row.senders === "object" && !Array.isArray(row.senders)) {
    for (const [email, status] of Object.entries(row.senders as Record<string, unknown>)) {
      const key = normalizeEmail(email);
      if (!key.includes("@")) continue;
      if (status !== "accepted" && status !== "blocked") continue;
      senders[key] = status;
      if (Object.keys(senders).length >= 2000) break;
    }
  }
  const domains: string[] = [];
  if (Array.isArray(row.domains)) {
    for (const domain of row.domains) {
      if (typeof domain !== "string") continue;
      const key = domain.trim().toLowerCase().replace(/^@/, "");
      if (!key || key.includes("@") || key.includes(" ") || domains.includes(key)) continue;
      domains.push(key);
      if (domains.length >= 500) break;
    }
  }
  return { mode, senders, domains };
}

export function latestInbound(thread: Thread): Thread["messages"][number] | null {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message && message.direction !== "outbound") return message;
  }
  return thread.messages.at(-1) ?? null;
}

export function senderEmail(thread: Thread): string {
  return normalizeEmail(latestInbound(thread)?.from.email ?? "");
}

export function userStarted(thread: Thread, mine: Set<string>): boolean {
  return thread.messages.some((message) => message.direction === "outbound" || mine.has(normalizeEmail(message.from.email)));
}

export function resolveStatus(email: string, book: GateBook): GateStatus {
  const key = normalizeEmail(email);
  const explicit = book.senders[key];
  if (explicit === "accepted") return "accepted";
  if (explicit === "blocked") return "blocked";
  if (key.includes("@") && book.domains.includes(emailDomain(key))) return "blocked";
  if (isSystemSender(key)) return "accepted";
  if (book.mode === "off") return "accepted";
  return "pending";
}

export function skipsScreening(thread: Thread, mine: Set<string>): boolean {
  if (userStarted(thread, mine)) return true;
  const email = senderEmail(thread);
  if (!email) return true;
  if (mine.has(email) || isSystemSender(email)) return true;
  return false;
}

export function shouldNotify(status: GateStatus): boolean {
  return status === "accepted";
}

export function shouldNotifyThread(thread: Thread): boolean {
  if (thread.screen === "pending" || thread.screen === "blocked" || thread.review) return false;
  return true;
}

export function decideSenders(book: GateBook, emails: string[], status: "accepted" | "blocked"): GateBook {
  const current = gateBookOf(book);
  const senders = { ...current.senders };
  for (const email of emails) {
    const key = normalizeEmail(email);
    if (!key.includes("@")) continue;
    senders[key] = status;
    if (Object.keys(senders).length >= 2000) break;
  }
  return { ...current, senders };
}

/** Senders already stored when screening is turned on are trusted. Later strangers are not. */
export function acceptStoredSenders(book: GateBook, threads: Thread[]): GateBook {
  const current = gateBookOf(book);
  const known = new Set(Object.keys(current.senders));
  const emails: string[] = [];
  for (const thread of threads) {
    if (!thread || !Array.isArray(thread.messages)) continue;
    for (const message of thread.messages) {
      const key = normalizeEmail(message?.from?.email ?? "");
      if (!key.includes("@") || known.has(key)) continue;
      known.add(key);
      emails.push(key);
      if (known.size >= 2000) return decideSenders(current, emails, "accepted");
    }
  }
  return decideSenders(current, emails, "accepted");
}

/**
 * The first screened build saved `before` with an empty book. That was the default, not a choice.
 * A book someone actually used keeps its mode and trusts senders already in the mailbox.
 */
export function migrateSavedGate(book: GateBook | undefined, threads: Thread[]): GateBook {
  const gate = gateBookOf(book);
  if (gate.mode === "off") return gate;
  const untouched = Object.keys(gate.senders).length === 0 && gate.domains.length === 0;
  if (gate.mode === "before" && untouched) return { ...gate, mode: "off" };
  return acceptStoredSenders(gate, threads);
}

export function blockDomain(book: GateBook, domain: string): GateBook {
  const current = gateBookOf(book);
  const key = domain.trim().toLowerCase().replace(/^@/, "");
  if (!key || key.includes("@") || current.domains.includes(key)) return current;
  return { ...current, domains: [...current.domains, key] };
}

function seedAccepted(threads: Thread[], book: GateBook, mine: Set<string>): GateBook {
  const senders = { ...book.senders };
  let changed = false;
  for (const thread of threads) {
    for (const message of thread.messages) {
      const outbound = message.direction === "outbound" || mine.has(normalizeEmail(message.from.email));
      if (!outbound) continue;
      for (const person of [...message.to, ...message.cc, ...message.bcc]) {
        const key = normalizeEmail(person.email);
        if (!key.includes("@") || senders[key] || mine.has(key)) continue;
        senders[key] = "accepted";
        changed = true;
        if (Object.keys(senders).length >= 2000) return { ...book, senders };
      }
    }
  }
  return changed ? { ...book, senders } : book;
}

export function applyGate(threads: Thread[], book: GateBook | undefined, aliases: Alias[]): { threads: Thread[]; book: GateBook } {
  const mine = mineSet(aliases);
  const seeded = seedAccepted(threads, gateBookOf(book), mine);
  const next = threads.map((thread) => {
    const email = senderEmail(thread);
    const explicit = email ? seeded.senders[email] : undefined;
    const status: GateStatus = explicit === "blocked" ? "blocked" : explicit === "accepted" || skipsScreening(thread, mine) ? "accepted" : resolveStatus(email, seeded);
    const screen: "pending" | "blocked" | null = status === "blocked" ? "blocked" : status === "pending" && seeded.mode === "before" ? "pending" : null;
    const review = status === "pending" && seeded.mode === "inside";
    if ((thread.screen ?? null) === screen && thread.review === review) return thread;
    return { ...thread, screen, review };
  });
  return { threads: next, book: seeded };
}

export type SenderCard = {
  email: string;
  name: string;
  plusTag: string | null;
  subject: string;
  preview: string;
  threadIds: string[];
};

export function pendingCards(threads: Thread[]): SenderCard[] {
  const groups = new Map<string, SenderCard>();
  for (const thread of threads) {
    if (thread.screen !== "pending") continue;
    const message = latestInbound(thread);
    const email = normalizeEmail(message?.from.email ?? "");
    if (!email.includes("@")) continue;
    const existing = groups.get(email);
    if (existing) {
      existing.threadIds.push(thread.id);
      continue;
    }
    groups.set(email, {
      email,
      name: message?.from.name?.trim() || email,
      plusTag: thread.plusTag,
      subject: thread.subject || "(no subject)",
      preview: (message?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 90),
      threadIds: [thread.id],
    });
  }
  return [...groups.values()];
}
