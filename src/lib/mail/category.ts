import { applySenderRules, inboundSenders, senderRulesOf, type SenderRule } from "./bundles.ts";
import { emailDomain, localPart } from "./gate.ts";
import { automatedMail } from "./quick.ts";
import {
  CATEGORIES,
  accountOf,
  inFolder,
  mineSet,
  type AccountId,
  type Alias,
  type Category,
  type Message,
  type Thread,
} from "./model.ts";

/** Known social networks. Subdomains count. Lookalikes such as evilx.com do not. */
const SOCIAL_DOMAINS = new Set([
  "x.com",
  "twitter.com",
  "facebook.com",
  "facebookmail.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "reddit.com",
  "threads.net",
  "pinterest.com",
  "snapchat.com",
  "youtube.com",
  "discord.com",
  "bsky.app",
  "bsky.social",
  "mastodon.social",
]);

const MARKETING_LOCAL = /^(?:newsletters?|marketing|promos?|promotions|deals|offers|sales?)$/i;
const UPDATE_LOCAL = /^(?:no-?reply|notifications?|alerts?|automated|mailer-daemon|postmaster|bots?|daemons?)$/i;

function socialHost(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/\.+$/, "");
  if (!host || host.includes("@")) return false;
  if (SOCIAL_DOMAINS.has(host)) return true;
  for (const known of SOCIAL_DOMAINS) {
    if (host.endsWith(`.${known}`)) return true;
  }
  return false;
}

const ALERT_SUBJECT = /\balerts?\b/i;

/**
 * Social hosts win, then bulk mail (List-Unsubscribe or a marketing local-part),
 * then automated senders: bots, no-reply, and alert subjects. Everyone else stays in Primary.
 */
export function classifyMessage(message: Message): Category {
  if (socialHost(emailDomain(message.from.email))) return "social";
  const local = localPart(message.from.email);
  if ((message.listUnsubscribe ?? "").trim() || MARKETING_LOCAL.test(local)) return "promotions";
  if (automatedMail(message) || UPDATE_LOCAL.test(local) || ALERT_SUBJECT.test(message.subject ?? "")) return "updates";
  return "primary";
}

/** Latest inbound sender decides. A thread with no inbound mail uses its last message. */
export function classifyThread(thread: Thread): Category {
  const inbound = [...thread.messages].reverse().find((message) => message.direction !== "outbound");
  const message = inbound ?? thread.messages[thread.messages.length - 1];
  if (!message) return thread.category;
  return classifyMessage(message);
}

/** Sender rules win. Every other thread is classified from its sender. */
export function applyInboxCategories(threads: Thread[], rules: SenderRule[] | undefined): Thread[] {
  const ruled = applySenderRules(threads, rules);
  const kept = new Set(senderRulesOf(rules).map((rule) => rule.email));
  return ruled.map((thread) => {
    const latest = inboundSenders(thread).at(-1);
    if (latest && kept.has(latest)) return thread;
    const category = classifyThread(thread);
    return category === thread.category ? thread : { ...thread, category };
  });
}

/** Inbox conversations in a category, read and unread. Done and snoozed stay out. */
export function categoryInboxTotal(
  threads: Thread[],
  category: Category,
  now: number,
  aliases: Alias[],
  account: AccountId = "grokbot",
): number {
  const mine = mineSet(aliases);
  return threads.filter(
    (thread) => accountOf(thread) === account && thread.category === category && inFolder(thread, "inbox", now, mine),
  ).length;
}

/** Category tabs that actually have inbox mail. An empty Social, Updates, or Promos tab is omitted. */
export function visibleCategoryTabs(
  threads: Thread[],
  now: number,
  aliases: Alias[],
  account: AccountId = "grokbot",
): { id: Category; label: string }[] {
  return CATEGORIES.filter((tab) => categoryInboxTotal(threads, tab.id, now, aliases, account) > 0);
}

/** Badge copy for an unread count. Null when there is nothing unread, so it is not read as a total. */
export function unreadBadgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} unread`;
}
