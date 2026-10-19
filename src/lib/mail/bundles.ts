import { type Category, type Thread } from "./model.ts";

export type SenderRule = { email: string; category: Category };

const CATEGORY_IDS = new Set<string>(["primary", "social", "updates", "promotions"]);

export function normalizeSender(email: string): string {
  return email.trim().toLowerCase();
}

export function senderRulesOf(rules: unknown): SenderRule[] {
  if (!Array.isArray(rules)) return [];
  const seen = new Set<string>();
  const out: SenderRule[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const row = rule as { email?: unknown; category?: unknown };
    if (typeof row.email !== "string" || typeof row.category !== "string") continue;
    const email = normalizeSender(row.email);
    if (!email.includes("@") || seen.has(email) || !CATEGORY_IDS.has(row.category)) continue;
    seen.add(email);
    out.push({ email, category: row.category as Category });
    if (out.length >= 500) break;
  }
  return out;
}

export function upsertSenderRule(rules: SenderRule[] | undefined, email: string, category: Category): SenderRule[] {
  const key = normalizeSender(email);
  const next = senderRulesOf(rules).filter((rule) => rule.email !== key);
  if (key.includes("@")) next.push({ email: key, category });
  return next;
}

/** Inbound addresses, oldest first. The last one is who this thread is from now. */
export function inboundSenders(thread: Thread): string[] {
  const out: string[] = [];
  for (const message of thread.messages) {
    if (message.direction === "outbound") continue;
    const email = normalizeSender(message.from.email);
    if (!email.includes("@") || out.includes(email)) continue;
    out.push(email);
  }
  return out;
}

export function applySenderRules(threads: Thread[], rules: SenderRule[] | undefined): Thread[] {
  const book = senderRulesOf(rules);
  if (!book.length) return threads;
  const map = new Map(book.map((rule) => [rule.email, rule.category]));
  return threads.map((thread) => {
    const latest = inboundSenders(thread).at(-1);
    if (!latest) return thread;
    const category = map.get(latest);
    if (!category || category === thread.category) return thread;
    return { ...thread, category };
  });
}
