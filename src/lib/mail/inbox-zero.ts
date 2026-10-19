import {
  type AccountId,
  type Alias,
  type Category,
  type FolderId,
  type Thread,
  accountOf,
  inFolder,
  isSnoozed,
  mineSet,
} from "./model.ts";

export type InboxPicture =
  | { kind: "fresh"; address: string }
  | { kind: "clear"; handled: number; snoozeAt: string | null }
  | { kind: "messages" };

export function handledToday(threads: Thread[], now: number, account: AccountId): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  return threads.filter((thread) => {
    if (accountOf(thread) !== account || !thread.doneAt) return false;
    const at = Date.parse(thread.doneAt);
    return !Number.isNaN(at) && at >= from && at <= now;
  }).length;
}

export function nextSnoozeAt(threads: Thread[], now: number, account: AccountId): string | null {
  let best: number | null = null;
  for (const thread of threads) {
    if (accountOf(thread) !== account || !isSnoozed(thread, now) || !thread.snoozeUntil) continue;
    const at = Date.parse(thread.snoozeUntil);
    if (Number.isNaN(at)) continue;
    if (best === null || at < best) best = at;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** What the inbox card should show when the visible list may be empty. */
export function pictureInbox(opts: {
  threads: Thread[];
  folder: FolderId;
  category: Category | "all";
  query: string;
  now: number;
  aliases: Alias[];
  account: AccountId;
  address: string;
  visible: Thread[];
}): InboxPicture {
  if (opts.query || opts.folder !== "inbox") return { kind: "messages" };
  const mine = opts.threads.filter((thread) => accountOf(thread) === opts.account);
  if (mine.length === 0) return { kind: "fresh", address: opts.address };
  if (opts.visible.length > 0) return { kind: "messages" };
  const addresses = mineSet(opts.aliases);
  if (mine.some((thread) => inFolder(thread, "inbox", opts.now, addresses))) return { kind: "messages" };
  return {
    kind: "clear",
    handled: handledToday(opts.threads, opts.now, opts.account),
    snoozeAt: nextSnoozeAt(opts.threads, opts.now, opts.account),
  };
}
