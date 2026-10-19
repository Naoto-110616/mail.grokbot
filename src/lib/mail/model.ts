import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { senderRulesOf, type SenderRule } from "./bundles.ts";
import { defaultGate, gateBookOf, type GateBook } from "./gate.ts";
import { defaultQuickReplies, quickRepliesOf, type QuickReply } from "./quick.ts";
import {
  type DatePhrase,
  datePhraseAt,
  parseIsoBound,
  phraseWindow,
  recentSearchesOf,
  savedSearchesOf,
  type SavedSearch,
} from "./search.ts";
import { outboxItemsForThreads, type OutboxItem } from "./outbox.ts";
import { defaultSwipePrefs, swipePrefsOf, type SwipePrefs } from "./swipe.ts";

/** Placeholder address until an ingest account or config.json sets one. */
export const DEMO_ADDRESS = "you@example.test";
export const DEMO_DOMAIN = "example.test";
export const PRIMARY = DEMO_ADDRESS;
export const DOMAIN = DEMO_DOMAIN;

export type Swatch = "teal" | "ink" | "brass" | "olive" | "rose";

export type Address = { name: string; email: string };

export type Category = "primary" | "social" | "updates" | "promotions";

export type Delivery = "waiting" | "sent" | "failed";

export type Attachment = {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  path: string;
};

export type Message = {
  id: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  deliveredTo: string | null;
  account: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
  date: string;
  attachments: Attachment[];
  delivery?: Delivery | null;
  clientSendId?: string | null;
  /** Bot grouping key. Null keeps header, then subject, grouping. */
  threadHint?: string | null;
  /** Null and inbound behave as inbound. Outbound is mail the owner sent. */
  direction?: "inbound" | "outbound" | null;
  /** Present when the message carried List-Unsubscribe. Quick replies stay hidden. */
  listUnsubscribe?: string | null;
  /** RFC 3834 Auto-Submitted. "no" is a person. Any other value is automated. */
  autoSubmitted?: string | null;
};

export type SeedMessage = Omit<Message, "messageId" | "inReplyTo" | "references" | "deliveredTo" | "account"> &
  Partial<Pick<Message, "messageId" | "inReplyTo" | "references" | "deliveredTo" | "account" | "delivery" | "clientSendId">>;

export type DraftMode = "new" | "reply" | "replyAll" | "forward";

export type Draft = {
  mode: DraftMode;
  replyToId: string | null;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  updatedAt: string;
  attachments: Attachment[];
};

export type Location = "inbox" | "archive" | "spam" | "trash" | "drafts";

export type Thread = {
  id: string;
  subject: string;
  category: Category;
  location: Location;
  labels: string[];
  plusTag: string | null;
  starred: boolean;
  important: boolean;
  unread: boolean;
  muted: boolean;
  snoozeUntil: string | null;
  /** Set when the person marks the thread done. Cleared when it returns. */
  doneAt?: string | null;
  /** Derived by the new-sender screen. Pending stays out of the inbox in before mode. */
  screen?: "pending" | "blocked" | null;
  /** Pending sender shown inside the open message. */
  review?: boolean;
  messages: Message[];
  draft: Draft | null;
  account?: "grokbot" | "gmail";
};

export type Label = { id: string; name: string; swatch: Swatch };

export type Filter = {
  id: string;
  fromIncludes: string;
  subjectIncludes: string;
  labelId: string | null;
  archive: boolean;
  star: boolean;
  markRead: boolean;
  enabled: boolean;
};

export type Alias = { email: string; tag: string | null; name: string };

export type ThemeName = "light" | "dim" | "lights-out" | "system";

export type Settings = {
  displayName: string;
  signature: string;
  density: "comfortable" | "cozy" | "compact";
  theme: ThemeName;
  glass: number;
  undoSeconds: number;
  pane: "right" | "none";
  defaultFrom: string;
  vacationOn: boolean;
  vacationText: string;
  /** Device-local. A server refresh must not replace this. */
  swipePrefs?: SwipePrefs;
  /** Future mail from these senders keeps the chosen category. Device-local. */
  senderRules?: SenderRule[];
  /** Who may reach the inbox. Device-local. */
  gate?: GateBook;
  /** Short replies the reader can turn into an approval card. Device-local. */
  quickReplies?: QuickReply[];
  /** Queries starred from the search pill. Device-local. */
  savedSearches?: SavedSearch[];
  /** Last queries confirmed with Enter. Device-local. */
  recentSearches?: string[];
};

export type SystemFolder =
  | "inbox"
  | "starred"
  | "snoozed"
  | "important"
  | "sent"
  | "drafts"
  | "spam"
  | "trash"
  | "all"
  | "done"
  | "blocked"
  | "outbox";

export type FolderId = SystemFolder | `label:${string}` | `plus:${string}`;

export type GmailChoice = "ask" | "on" | "off";
export type AccountId = "grokbot" | "gmail";

export type MailData = {
  threads: Thread[];
  labels: Label[];
  filters: Filter[];
  settings: Settings;
  aliases: Alias[];
  demoCursor: number;
  gmail: GmailChoice;
  hiddenThreadIds?: string[];
  /** Sends waiting on the bot, loaded from mail_outbound. */
  outbox?: OutboxItem[];
  /**
   * Client send ids and provider ids whose outbound rows should be deleted
   * on the next save. Cleared after that save. Not a mailbox preference.
   */
  dropOutboxIds?: string[];
};

export const SWATCHES: Swatch[] = ["teal", "ink", "brass", "olive", "rose"];

export const SWATCH_DOT: Record<Swatch, string> = {
  teal: "bg-accent",
  ink: "bg-ink",
  brass: "bg-brass",
  olive: "bg-olive",
  rose: "bg-rose",
};

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "primary", label: "Primary" },
  { id: "social", label: "Social" },
  { id: "updates", label: "Updates" },
  { id: "promotions", label: "Promos" },
];

export function uid(): string {
  return crypto.randomUUID();
}

export function accountOf(t: Thread): AccountId {
  return t.account ?? "grokbot";
}

export function resolveTheme(theme: string): "light" | "dim" | "lights-out" {
  if (theme === "dim") return "dim";
  if (theme === "lights-out" || theme === "dark") return "lights-out";
  if (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "lights-out";
  }
  return "light";
}

export function aliasAddress(tag: string | null, address = DEMO_ADDRESS): string {
  if (!tag) return address;
  const at = address.lastIndexOf("@");
  if (at < 0) return address;
  const local = address.slice(0, at).split("+")[0] || address.slice(0, at);
  return `${local}+${tag}@${address.slice(at + 1)}`;
}

export function addressLocal(address: string): string {
  const local = address.split("@")[0] ?? address;
  return local.split("+")[0] || local;
}

export function aliasesFor(address: string, displayName = "You"): Alias[] {
  const named: { tag: string; name: string }[] = [
    { tag: "ops", name: "Ops" },
    { tag: "github", name: "GitHub" },
    { tag: "books", name: "Books" },
    { tag: "x", name: "X" },
    { tag: "billing", name: "Billing" },
  ];
  return [
    { email: address, tag: null, name: displayName || "Primary" },
    ...named.map((item) => ({ email: aliasAddress(item.tag, address), tag: item.tag, name: item.name })),
  ];
}

export function defaultAliases(): Alias[] {
  return aliasesFor(DEMO_ADDRESS, "You");
}

export function signatureFor(displayName: string, address: string): string {
  const name = displayName.trim() || "You";
  return `${name}\n${address}`;
}

export function defaultSettings(): Settings {
  return {
    displayName: "You",
    signature: signatureFor("You", DEMO_ADDRESS),
    density: "comfortable",
    theme: "light",
    glass: 68,
    undoSeconds: 8,
    pane: "right",
    defaultFrom: DEMO_ADDRESS,
    vacationOn: false,
    vacationText: "I'm away from this mailbox.",
    swipePrefs: defaultSwipePrefs(),
    senderRules: [],
    gate: defaultGate(),
    quickReplies: defaultQuickReplies(),
    savedSearches: [],
    recentSearches: [],
  };
}

/** Browser-only prefs survive a server mailbox refresh. */
export function keepLocalSettings(current: Settings, incoming: Settings): Settings {
  return {
    ...incoming,
    density: current.density,
    theme: current.theme,
    glass: current.glass,
    pane: current.pane,
    undoSeconds: current.undoSeconds,
    vacationOn: current.vacationOn,
    vacationText: current.vacationText,
    swipePrefs: { ...defaultSwipePrefs(), ...current.swipePrefs },
    senderRules: senderRulesOf(current.senderRules),
    gate: gateBookOf(current.gate),
    quickReplies: quickRepliesOf(current.quickReplies),
    savedSearches: savedSearchesOf(current.savedSearches),
    recentSearches: recentSearchesOf(current.recentSearches),
  };
}

const DENSITIES = new Set<Settings["density"]>(["comfortable", "cozy", "compact"]);
const THEMES = new Set<ThemeName>(["light", "dim", "lights-out", "system"]);
const PANES = new Set<Settings["pane"]>(["right", "none"]);

/** A settings document from a text column, a driver object, or a double-encoded string. */
function storedDocument(value: unknown): Record<string, unknown> | null {
  let current = value;
  if (current instanceof Uint8Array) current = new TextDecoder().decode(current);
  for (let depth = 0; depth < 2 && typeof current === "string"; depth += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  return current as Record<string, unknown>;
}

/** One stored settings document. Null when the row is missing or not an object. */
export function settingsFromUnknown(value: unknown): Settings | null {
  const row = storedDocument(value);
  if (!row) return null;
  const base = defaultSettings();
  const density = DENSITIES.has(row.density as Settings["density"]) ? (row.density as Settings["density"]) : base.density;
  let theme = THEMES.has(row.theme as ThemeName) ? (row.theme as ThemeName) : base.theme;
  if (row.theme === "dark") theme = "lights-out";
  const pane = PANES.has(row.pane as Settings["pane"]) ? (row.pane as Settings["pane"]) : base.pane;
  const glass =
    typeof row.glass === "number" && Number.isFinite(row.glass) ? Math.min(100, Math.max(0, Math.round(row.glass))) : base.glass;
  const undoSeconds =
    typeof row.undoSeconds === "number" && Number.isFinite(row.undoSeconds) ? row.undoSeconds : base.undoSeconds;
  const swipe = row.swipePrefs && typeof row.swipePrefs === "object" ? (row.swipePrefs as Partial<SwipePrefs>) : null;
  return {
    displayName: typeof row.displayName === "string" ? row.displayName : base.displayName,
    signature: typeof row.signature === "string" ? row.signature : base.signature,
    density,
    theme,
    glass,
    undoSeconds,
    pane,
    defaultFrom: typeof row.defaultFrom === "string" && row.defaultFrom.includes("@") ? row.defaultFrom : base.defaultFrom,
    vacationOn: row.vacationOn === true,
    vacationText: typeof row.vacationText === "string" ? row.vacationText : base.vacationText,
    swipePrefs: swipePrefsOf(swipe),
    senderRules: senderRulesOf(row.senderRules),
    gate: gateBookOf(row.gate),
    quickReplies: quickRepliesOf(row.quickReplies),
    savedSearches: savedSearchesOf(row.savedSearches),
    recentSearches: recentSearchesOf(row.recentSearches),
  };
}

/**
 * Display settings saved on the server win key by key.
 * A missing document, or a missing key, keeps the localStorage copy.
 */
export function hydrateDisplaySettings(stored: unknown, local: Settings): Settings {
  const row = storedDocument(stored);
  if (!row) return local;
  const parsed = settingsFromUnknown(row);
  if (!parsed) return local;
  const themePresent = "theme" in row && (row.theme === "dark" || THEMES.has(row.theme as ThemeName));
  return {
    ...parsed,
    displayName: typeof row.displayName === "string" ? parsed.displayName : local.displayName,
    signature: typeof row.signature === "string" ? parsed.signature : local.signature,
    density: DENSITIES.has(row.density as Settings["density"]) ? parsed.density : local.density,
    theme: themePresent ? parsed.theme : local.theme,
    glass: typeof row.glass === "number" && Number.isFinite(row.glass) ? parsed.glass : local.glass,
    undoSeconds: typeof row.undoSeconds === "number" && Number.isFinite(row.undoSeconds) ? parsed.undoSeconds : local.undoSeconds,
    pane: PANES.has(row.pane as Settings["pane"]) ? parsed.pane : local.pane,
    defaultFrom: typeof row.defaultFrom === "string" && row.defaultFrom.includes("@") ? parsed.defaultFrom : local.defaultFrom,
    vacationOn: typeof row.vacationOn === "boolean" ? parsed.vacationOn : local.vacationOn,
    vacationText: typeof row.vacationText === "string" ? parsed.vacationText : local.vacationText,
    swipePrefs: row.swipePrefs && typeof row.swipePrefs === "object" ? parsed.swipePrefs : (local.swipePrefs ?? parsed.swipePrefs),
    senderRules: "senderRules" in row ? parsed.senderRules : local.senderRules,
    gate: "gate" in row ? parsed.gate : local.gate,
    quickReplies: "quickReplies" in row ? parsed.quickReplies : local.quickReplies,
    savedSearches: "savedSearches" in row ? parsed.savedSearches : local.savedSearches,
    recentSearches: "recentSearches" in row ? parsed.recentSearches : local.recentSearches,
  };
}

export function mineSet(aliases: Alias[]): Set<string> {
  return new Set(aliases.map((a) => a.email.toLowerCase()));
}

export function formatAddress(a: Address): string {
  if (!a.name || a.name.toLowerCase() === a.email.toLowerCase()) return a.email;
  return `${a.name} <${a.email}>`;
}

export function parseAddressList(raw: string): Address[] {
  return raw
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*)<([^>]+)>$/);
      if (m) {
        return {
          name: m[1].trim().replace(/^"|"$/g, "") || m[2].trim().split("@")[0],
          email: m[2].trim(),
        };
      }
      if (part.includes("@")) return { name: part.split("@")[0], email: part };
      return { name: part, email: part };
    });
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (isThisYear(d)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

export function formatFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "EEE, MMM d, yyyy, h:mm a");
}

export function activityIso(t: Thread): string {
  const times = [...t.messages.map((m) => m.date), t.draft?.updatedAt].filter(Boolean) as string[];
  return times.sort().at(-1) ?? new Date(0).toISOString();
}

export const WAITING_COPY = "Waiting for approval in Grok Bot";
export { QUEUED_TOAST, OUTBOX_WAITING } from "./outbox.ts";

/** Wake POST failed. New mail and forwards say "message"; only a reply says "reply". */
export function wakeMissNotice(mode: DraftMode): string {
  const noun = mode === "reply" || mode === "replyAll" ? "reply" : "message";
  return `Grok Bot did not wake. This ${noun} was not sent.`;
}

export function snippetOf(t: Thread): string {
  const last = [...t.messages].reverse()[0];
  if (last?.delivery === "waiting") return WAITING_COPY;
  const src = t.draft?.body || last?.body || "";
  return cleanSnippet(src);
}

/** One line of prose. Drops tracking URLs, quoted replies, and header lines. */
export function cleanSnippet(src: string): string {
  const kept: string[] = [];
  for (const line of src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || isSnippetNoise(trimmed)) continue;
    kept.push(trimmed);
  }
  return stripSnippetLinks(kept.join(" ")).replace(/\s+/g, " ").trim();
}

function isSnippetNoise(line: string): boolean {
  if (/^>+/.test(line)) return true;
  if (/^(?:from|to|cc|bcc|subject|date|sent)\s*:/i.test(line)) return true;
  if (line.length <= 240 && /^on\s+\S.+\bwrote:\s*$/i.test(line)) return true;
  if (/^(?:--|—|–)\s*$/.test(line)) return true;
  if (line.length <= 60 && /^sent from\b/i.test(line)) return true;
  return false;
}

function stripSnippetLinks(text: string): string {
  return text
    .replace(/\[([^\]\n]{0,200})\]\((?:https?:\/\/|www\.)[^)\s]+\)/gi, (_match, label: string) =>
      /:\/\/|\bwww\./i.test(label) ? " " : ` ${label} `,
    )
    .replace(/<https?:\/\/[^>\s]+>/gi, " ")
    .replace(/\(\s*(?:https?:\/\/|www\.)[^)\s]+\s*\)/gi, " ")
    .replace(/https?:\/\/[^\s<>\]]+/gi, " ")
    .replace(/\bwww\.[^\s<>\]]+/gi, " ");
}

export function listSender(t: Thread, mine: Set<string>): string {
  if (t.messages.length === 0) return "Draft";
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of t.messages) {
    if (mine.has(m.from.email.toLowerCase())) continue;
    const key = m.from.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(m.from.name.split(" ")[0] || m.from.email);
  }
  if (names.length === 0) {
    const to = t.messages[t.messages.length - 1]?.to ?? [];
    const label = to.map((a) => a.name.split(" ")[0] || a.email).join(", ");
    return label ? `To: ${label}` : "To: me";
  }
  if (names.length <= 2) return names.join(", ");
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

export function isSnoozed(t: Thread, now: number): boolean {
  return Boolean(t.snoozeUntil && Date.parse(t.snoozeUntil) > now);
}

/** Done is an explicit mark. Archive without doneAt stays out of the Done folder. */
export function isDone(t: Thread): boolean {
  return t.location === "archive" && Boolean(t.doneAt);
}

export function inFolder(t: Thread, folder: FolderId, now: number, mine: Set<string>): boolean {
  if (folder === "outbox") return false;
  const trash = t.location === "trash";
  const spam = t.location === "spam";
  if (folder === "trash") return trash;
  if (folder === "all") return !trash;
  if (folder === "spam") return spam && !trash;
  if (trash || spam) return false;
  if (folder === "blocked") return t.screen === "blocked";
  if (t.screen === "pending" || t.screen === "blocked") return false;
  if (folder === "drafts") return t.draft !== null || t.location === "drafts";
  if (folder === "snoozed") return isSnoozed(t, now);
  if (folder === "starred") return t.starred;
  if (folder === "important") return t.important;
  if (folder === "sent") {
    return t.messages.some((m) => m.direction === "outbound" || mine.has(m.from.email.toLowerCase()));
  }
  if (folder === "done") return isDone(t);
  if (folder.startsWith("label:")) return t.labels.includes(folder.slice(6));
  if (folder.startsWith("plus:")) return t.plusTag === folder.slice(5);
  if (t.location !== "inbox" || isSnoozed(t, now) || t.muted) return false;
  return true;
}

export type ParsedQuery = {
  text: string[];
  from: string[];
  to: string[];
  subject: string[];
  label?: string;
  plus?: string;
  filename?: string;
  is: string[];
  has: string[];
  in?: string;
  newerThanDays?: number;
  phrases: DatePhrase[];
  after: number[];
  before: number[];
};

const OPS = new Set([
  "from",
  "to",
  "subject",
  "label",
  "plus",
  "filename",
  "is",
  "has",
  "in",
  "newer_than",
  "after",
  "before",
]);

type QueryToken = { value: string; quoted: boolean };

function takeList(target: string[], value: string, index: number, tokens: QueryToken[]): number {
  let cursor = index;
  let current = value;
  while (true) {
    for (const part of current.split(",")) {
      const item = part.trim().toLowerCase();
      if (item) target.push(item);
    }
    if (!current.trim().endsWith(",")) return cursor;
    const follow = tokens[cursor + 1];
    if (!follow || follow.quoted || follow.value.includes(":")) return cursor;
    cursor += 1;
    current = follow.value;
  }
}

export function parseQuery(raw: string): ParsedQuery {
  const q: ParsedQuery = { text: [], from: [], to: [], subject: [], is: [], has: [], phrases: [], after: [], before: [] };
  const tokens: QueryToken[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const quoted = match[1] != null;
    const value = (match[1] ?? match[2] ?? "").trim();
    if (value) tokens.push({ value, quoted });
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (!token.quoted) {
      const follow = tokens[index + 1];
      const phrase = datePhraseAt(token.value, follow && !follow.quoted ? follow.value : undefined);
      if (phrase) {
        q.phrases.push(phrase.phrase);
        index += phrase.span - 1;
        continue;
      }
      const colon = token.value.indexOf(":");
      if (colon > 0) {
        const key = token.value.slice(0, colon).toLowerCase();
        const val = token.value.slice(colon + 1);
        if (OPS.has(key) && val) {
          if (key === "is") q.is.push(val.toLowerCase());
          else if (key === "has") q.has.push(val.toLowerCase());
          else if (key === "newer_than") {
            const days = Number.parseInt(val, 10);
            if (!Number.isNaN(days)) q.newerThanDays = days;
          } else if (key === "from") index = takeList(q.from, val, index, tokens);
          else if (key === "to") index = takeList(q.to, val, index, tokens);
          else if (key === "subject") q.subject.push(val.toLowerCase());
          else if (key === "label") q.label = val.toLowerCase();
          else if (key === "plus") q.plus = val.toLowerCase().replace(/^\+/, "");
          else if (key === "filename") q.filename = val.toLowerCase();
          else if (key === "in") q.in = val.toLowerCase();
          else if (key === "after" || key === "before") {
            const bound = parseIsoBound(val);
            if (bound == null) q.text.push(token.value.toLowerCase());
            else if (key === "after") q.after.push(bound);
            else q.before.push(bound);
          }
          continue;
        }
      }
    }
    q.text.push(token.value.toLowerCase());
  }
  return q;
}

function haystack(t: Thread, labels: Label[]): string {
  const labelNames = t.labels
    .map((id) => labels.find((l) => l.id === id)?.name ?? "")
    .join(" ");
  const parts = [t.subject, t.plusTag ?? "", labelNames];
  for (const m of t.messages) {
    parts.push(m.from.name, m.from.email, m.subject, m.body);
    for (const a of [...m.to, ...m.cc, ...m.bcc]) parts.push(a.name, a.email);
    for (const f of m.attachments) parts.push(f.filename, previewForPath(f.path));
  }
  if (t.draft) parts.push(t.draft.subject, t.draft.body, t.draft.to, t.draft.cc);
  return parts.join("\n").toLowerCase();
}

function fromHit(message: Message, term: string): boolean {
  const email = message.from.email.toLowerCase();
  if (term.startsWith("@")) {
    const at = email.lastIndexOf("@");
    return at >= 0 && email.slice(at + 1) === term.slice(1);
  }
  return `${message.from.name} ${email}`.toLowerCase().includes(term);
}

function toHit(thread: Thread, term: string): boolean {
  if (term.startsWith("+")) {
    const tag = term.slice(1);
    if ((thread.plusTag ?? "").toLowerCase() === tag) return true;
    const needle = `+${tag}@`;
    return thread.messages.some((message) => {
      if ((message.deliveredTo ?? "").toLowerCase().includes(needle)) return true;
      return [...message.to, ...message.cc, ...message.bcc].some((address) => address.email.toLowerCase().includes(needle));
    });
  }
  return thread.messages.some((message) =>
    message.to.some((address) => `${address.name} ${address.email}`.toLowerCase().includes(term)),
  );
}

export function matchesQuery(t: Thread, q: ParsedQuery, labels: Label[], now: number): boolean {
  if (q.from.length && !q.from.some((term) => t.messages.some((message) => fromHit(message, term)))) return false;
  if (q.to.length && !q.to.some((term) => toHit(t, term))) return false;
  if (q.subject.length && q.subject.some((part) => !t.subject.toLowerCase().includes(part))) return false;
  if (q.plus && (t.plusTag ?? "") !== q.plus) return false;
  if (q.label) {
    const hit = t.labels.some((id) => {
      const name = labels.find((l) => l.id === id)?.name.toLowerCase() ?? "";
      return id.toLowerCase().includes(q.label!) || name.includes(q.label!);
    });
    if (!hit) return false;
  }
  if (q.filename) {
    const hit = t.messages.some((m) => m.attachments.some((a) => a.filename.toLowerCase().includes(q.filename!)));
    if (!hit) return false;
  }
  if (q.has.includes("attachment") && !t.messages.some((m) => m.attachments.length > 0)) return false;
  if (q.is.includes("unread") && !t.unread) return false;
  if (q.is.includes("read") && t.unread) return false;
  if (q.is.includes("starred") && !t.starred) return false;
  if (q.is.includes("important") && !t.important) return false;
  if (q.is.includes("muted") && !t.muted) return false;
  if (q.is.includes("snoozed") && !isSnoozed(t, now)) return false;
  if (q.is.includes("draft") && !t.draft) return false;
  if (q.newerThanDays != null) {
    const age = now - Date.parse(activityIso(t));
    if (age > q.newerThanDays * 86_400_000) return false;
  }
  if (q.phrases.length || q.after.length || q.before.length) {
    let start = Number.NEGATIVE_INFINITY;
    let end = Number.POSITIVE_INFINITY;
    for (const phrase of q.phrases) {
      const window = phraseWindow(phrase, now);
      start = Math.max(start, window.start);
      end = Math.min(end, window.end);
    }
    for (const after of q.after) start = Math.max(start, after);
    for (const before of q.before) end = Math.min(end, before);
    const at = Date.parse(activityIso(t));
    if (!(at >= start && at < end)) return false;
  }
  if (q.text.length) {
    const hay = haystack(t, labels);
    if (!q.text.every((tok) => hay.includes(tok))) return false;
  }
  return true;
}

const IN_MAP: Record<string, FolderId> = {
  inbox: "inbox",
  starred: "starred",
  snoozed: "snoozed",
  important: "important",
  sent: "sent",
  drafts: "drafts",
  spam: "spam",
  trash: "trash",
  all: "all",
  done: "done",
  blocked: "blocked",
};

export function visibleThreads(opts: {
  threads: Thread[];
  folder: FolderId;
  category: Category | "all";
  query: string;
  now: number;
  aliases: Alias[];
  labels: Label[];
  account?: AccountId;
  /** Mix threads marked done back into the inbox. */
  showDone?: boolean;
}): Thread[] {
  const mine = mineSet(opts.aliases);
  const account = opts.account ?? "grokbot";
  const parsed = parseQuery(opts.query);
  const forced = parsed.in ? IN_MAP[parsed.in] : undefined;
  const anywhere = parsed.in === "anywhere" || parsed.in === "anywhere";
  return opts.threads
    .filter((t) => {
      if (accountOf(t) !== account) return false;
      if (anywhere) {
        if (t.location === "trash" || t.location === "spam") return false;
      } else if (forced) {
        if (!inFolder(t, forced, opts.now, mine)) return false;
      } else if (!inFolder(t, opts.folder, opts.now, mine)) {
        const mix = Boolean(opts.showDone && opts.folder === "inbox" && isDone(t) && !isSnoozed(t, opts.now));
        if (!mix) return false;
      }
      const folderForTabs = forced ?? (anywhere ? "all" : opts.folder);
      if (!parsed.in && folderForTabs === "inbox" && opts.category !== "all" && t.category !== opts.category) {
        return false;
      }
      return matchesQuery(t, parsed, opts.labels, opts.now);
    })
    .sort((a, b) => {
      if ((forced ?? opts.folder) === "snoozed") {
        return Date.parse(a.snoozeUntil ?? "") - Date.parse(b.snoozeUntil ?? "");
      }
      return Date.parse(activityIso(b)) - Date.parse(activityIso(a));
    });
}

export function unreadIn(threads: Thread[], folder: FolderId, now: number, aliases: Alias[], account: AccountId = "grokbot"): number {
  const mine = mineSet(aliases);
  return threads.filter((t) => accountOf(t) === account && t.unread && inFolder(t, folder, now, mine)).length;
}

export function categoryCount(
  threads: Thread[],
  category: Category,
  now: number,
  aliases: Alias[],
  account: AccountId = "grokbot",
): number {
  const mine = mineSet(aliases);
  return threads.filter(
    (t) => accountOf(t) === account && t.unread && t.category === category && inFolder(t, "inbox", now, mine),
  ).length;
}

export type ActKind =
  | "archive"
  | "trash"
  | "spam"
  | "inbox"
  | "star"
  | "starOn"
  | "starOff"
  | "important"
  | "read"
  | "unread"
  | "mute";

export function applyAct(t: Thread, kind: ActKind, now = Date.now()): Thread {
  switch (kind) {
    case "archive":
      if (t.location === "trash" || t.location === "spam" || t.location === "drafts") return t;
      return { ...t, location: "archive", snoozeUntil: null, doneAt: new Date(now).toISOString() };
    case "trash":
      return { ...t, location: "trash", snoozeUntil: null, doneAt: null };
    case "spam":
      return { ...t, location: "spam", snoozeUntil: null, doneAt: null };
    case "inbox":
      return { ...t, location: "inbox", snoozeUntil: null, muted: false, doneAt: null };
    case "star":
      return { ...t, starred: !t.starred };
    case "starOn":
      return t.starred ? t : { ...t, starred: true };
    case "starOff":
      return t.starred ? { ...t, starred: false } : t;
    case "important":
      return { ...t, important: !t.important };
    case "read":
      return { ...t, unread: false };
    case "unread":
      return { ...t, unread: true };
    case "mute":
      return { ...t, muted: !t.muted };
    default:
      return t;
  }
}

export function applyFilters(thread: Thread, filters: Filter[]): Thread {
  let t = thread;
  const froms = t.messages.map((m) => `${m.from.name} ${m.from.email}`).join(" ").toLowerCase();
  const subject = t.subject.toLowerCase();
  for (const f of filters) {
    if (!f.enabled) continue;
    if (f.fromIncludes && !froms.includes(f.fromIncludes.toLowerCase())) continue;
    if (f.subjectIncludes && !subject.includes(f.subjectIncludes.toLowerCase())) continue;
    if (f.labelId && !t.labels.includes(f.labelId)) t = { ...t, labels: [...t.labels, f.labelId] };
    if (f.star) t = { ...t, starred: true };
    if (f.markRead) t = { ...t, unread: false };
    if (f.archive && t.location === "inbox") {
      t = { ...t, location: "archive", snoozeUntil: null, doneAt: t.doneAt ?? new Date().toISOString() };
    }
  }
  return t;
}

export function reSubject(subject: string, prefix: "Re" | "Fwd"): string {
  if (new RegExp(`^${prefix}:\\s*`, "i").test(subject)) return subject;
  return `${prefix}: ${subject}`;
}

export function quoteMessage(message: Message): string {
  const when = formatFull(message.date);
  const quoted = message.body
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `On ${when}, ${message.from.name} wrote:\n${quoted}`;
}

function uniqueAddresses(list: Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of list) {
    const k = a.email.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function replyFields(message: Message, mode: "reply" | "replyAll" | "forward", mine: Set<string>) {
  if (mode === "forward") {
    const header = [
      "---------- Forwarded message ----------",
      `From: ${formatAddress(message.from)}`,
      `Date: ${formatFull(message.date)}`,
      `Subject: ${message.subject}`,
      `To: ${message.to.map(formatAddress).join(", ")}`,
      "",
      message.body,
    ].join("\n");
    return { to: "", cc: "", subject: reSubject(message.subject, "Fwd"), body: `\n\n${header}` };
  }
  const subject = reSubject(message.subject, "Re");
  const quoted = `\n\n${quoteMessage(message)}`;
  if (mode === "reply") {
    const toMine = mine.has(message.from.email.toLowerCase());
    const to = toMine ? message.to.map(formatAddress).join(", ") : formatAddress(message.from);
    return { to, cc: "", subject, body: quoted };
  }
  const tos = uniqueAddresses(
    [message.from, ...message.to].filter((a) => !mine.has(a.email.toLowerCase())),
  );
  const ccs = uniqueAddresses(message.cc.filter((a) => !mine.has(a.email.toLowerCase())));
  const to = (tos.length ? tos : message.to).map(formatAddress).join(", ");
  return { to, cc: ccs.map(formatAddress).join(", "), subject, body: quoted };
}

export function withSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return body;
  if (body.includes(sig)) return body;
  return `${body.replace(/\s*$/, "")}\n\n--\n${sig}`;
}

const SIGNATURE_MARK = /^(?:--|—|–)\s*$/;

/** Body text that is not a trailing signature or a lone `--` line. */
export function bodyBeyondSignature(body: string, signature: string): string {
  const sigLines = signature.trim()
    ? signature.replace(/\r\n/g, "\n").trim().split("\n").map((line) => line.trim())
    : [];
  let lines = body.replace(/\r\n/g, "\n").split("\n");
  const trimEnd = () => {
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  };
  for (let guard = 0; guard < 6; guard += 1) {
    trimEnd();
    if (lines.length === 0) break;
    const last = lines[lines.length - 1]?.trim() ?? "";
    if (SIGNATURE_MARK.test(last)) {
      lines.pop();
      continue;
    }
    if (sigLines.length > 0 && lines.length >= sigLines.length) {
      const start = lines.length - sigLines.length;
      const match = sigLines.every((line, index) => lines[start + index]?.trim() === line);
      if (match) {
        lines = lines.slice(0, start);
        continue;
      }
    }
    break;
  }
  const rest = lines.join("\n").trim();
  if (SIGNATURE_MARK.test(rest)) return "";
  return rest;
}

/**
 * A blank compose, or one whose body is only the signature, is not a draft.
 * A recipient, subject, or attachment still counts, so an in-progress letter is kept.
 */
export function shouldPersistDraft(
  fields: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    attachments?: readonly unknown[];
  },
  signature: string,
): boolean {
  if (bodyBeyondSignature(fields.body ?? "", signature).trim() !== "") return true;
  if ((fields.attachments?.length ?? 0) > 0) return true;
  if ((fields.to ?? "").trim() || (fields.cc ?? "").trim() || (fields.bcc ?? "").trim() || (fields.subject ?? "").trim()) {
    return true;
  }
  return false;
}

export function savedDraftThreadId(
  threads: readonly Thread[],
  draft: Pick<Draft, "updatedAt" | "body">,
  threadId: string | null,
): string | null {
  if (threadId && threads.some((thread) => thread.id === threadId)) return threadId;
  const match = threads.find((thread) => thread.draft?.updatedAt === draft.updatedAt && thread.draft.body === draft.body);
  return match?.id ?? null;
}

/** Drop a draft-only thread. A thread that already has mail keeps the messages and loses the draft. */
export function clearDraftThread(data: MailData, threadId: string): MailData {
  return {
    ...data,
    threads: data.threads.flatMap((thread) => {
      if (thread.id !== threadId) return [thread];
      if (thread.messages.length === 0) return [];
      return [{ ...thread, draft: null }];
    }),
  };
}

export function hideThreadIds(data: MailData, ids: readonly string[]): MailData {
  const hidden = new Set(ids);
  const drop = new Set(data.dropOutboxIds ?? []);
  for (const thread of data.threads) {
    if (!hidden.has(thread.id)) continue;
    for (const message of thread.messages) {
      if (message.clientSendId) drop.add(message.clientSendId);
      if (message.messageId) drop.add(message.messageId);
      if (message.id.startsWith("msg_") && message.id.length > 4) drop.add(message.id.slice(4));
    }
  }
  const threads = data.threads.filter((thread) => !hidden.has(thread.id));
  return {
    ...data,
    threads,
    hiddenThreadIds: [...new Set([...(data.hiddenThreadIds ?? []), ...ids])],
    outbox: outboxItemsForThreads(data.outbox ?? [], threads),
    dropOutboxIds: [...drop],
  };
}

export function snoozePresets(now = Date.now()): { id: string; label: string; hint: string; at: number }[] {
  const later = new Date(now);
  later.setHours(18, 0, 0, 0);
  if (later.getTime() < now + 3_600_000) later.setDate(later.getDate() + 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const monday = new Date(now);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? 1 : day === 1 ? 7 : 8 - day));
  monday.setHours(8, 0, 0, 0);
  return [
    { id: "1h", label: "One hour", hint: format(new Date(now + 3_600_000), "h:mm a"), at: now + 3_600_000 },
    { id: "later", label: "Later today", hint: format(later, "EEE h:mm a"), at: later.getTime() },
    { id: "tom", label: "Tomorrow morning", hint: format(tomorrow, "EEE h:mm a"), at: tomorrow.getTime() },
    { id: "mon", label: "Next Monday", hint: format(monday, "MMM d"), at: monday.getTime() },
    { id: "week", label: "One week", hint: format(new Date(now + 7 * 86_400_000), "MMM d"), at: now + 7 * 86_400_000 },
  ];
}

export function recentContacts(threads: Thread[], mine: Set<string>): Address[] {
  const map = new Map<string, Address>();
  for (const t of threads) {
    for (const m of t.messages) {
      for (const a of [m.from, ...m.to, ...m.cc]) {
        const k = a.email.toLowerCase();
        if (mine.has(k) || map.has(k)) continue;
        map.set(k, a);
      }
    }
  }
  return [...map.values()].slice(0, 8);
}

export function folderLabel(folder: FolderId, labels: Label[]): string {
  const names: Record<SystemFolder, string> = {
    inbox: "Inbox",
    starred: "Starred",
    snoozed: "Snoozed",
    important: "Important",
    sent: "Sent",
    drafts: "Drafts",
    spam: "Spam",
    trash: "Trash",
    all: "All mail",
    done: "Done",
    blocked: "Blocked",
    outbox: "Outbox",
  };
  if (folder.startsWith("label:")) {
    return labels.find((l) => l.id === folder.slice(6))?.name ?? "Label";
  }
  if (folder.startsWith("plus:")) return `+${folder.slice(5)}`;
  return names[folder as SystemFolder] ?? "Mail";
}

const sessionBlobs = new Map<string, string>();

export function rememberBlob(path: string, text: string) {
  if (path) sessionBlobs.set(path, text);
}

export function previewForPath(path: string): string {
  return sessionBlobs.get(path) ?? "";
}

/** Decoded cap for optional ingest attachment `content` (base64). 1 MiB. */
export const ATTACHMENT_CONTENT_MAX_BYTES = 1_048_576;

/**
 * Base64 `content` on an ingest attachment, or null when it is missing,
 * empty, not base64, or larger than ATTACHMENT_CONTENT_MAX_BYTES.
 * The caller still stores the file's metadata.
 */
export function attachmentContentBase64(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as { content?: unknown }).content;
  if (typeof raw !== "string") return null;
  const compact = raw.replace(/\s/g, "");
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    return null;
  }
  if (binary.length === 0 || binary.length > ATTACHMENT_CONTENT_MAX_BYTES) return null;
  let encoded = "";
  try {
    encoded = btoa(binary);
  } catch {
    return null;
  }
  if (encoded !== compact) return null;
  return compact;
}

/** Bytes for a download. Base64 is decoded; text is used when there is no binary payload. */
export function attachmentBlobParts(body: { text: string; base64?: string | null }): BlobPart[] {
  const encoded = body.base64?.replace(/\s/g, "") ?? "";
  if (!encoded) return [body.text];
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return [bytes];
  } catch {
    return [body.text];
  }
}

export function sealMessages(messages: SeedMessage[], plusTag: string | null): Message[] {
  const ids = messages.map((m) => m.messageId ?? `<${m.id}@${DEMO_DOMAIN}>`);
  return messages.map((m, index) => {
    const prior = ids.slice(0, index);
    const deliveredTo = m.deliveredTo ?? (plusTag ? aliasAddress(plusTag) : m.to[0]?.email ?? DEMO_ADDRESS);
    return {
      delivery: null,
      clientSendId: null,
      ...m,
      cc: m.cc ?? [],
      bcc: m.bcc ?? [],
      attachments: m.attachments ?? [],
      messageId: ids[index] ?? null,
      inReplyTo: m.inReplyTo === undefined ? (index > 0 ? prior[index - 1] ?? null : null) : m.inReplyTo,
      references: m.references ?? prior,
      deliveredTo,
      account: m.account ?? "primary",
    };
  });
}

function coerceAttachment(file: Attachment & { text?: string }): Attachment {
  const path = file.path || `session/${file.id}`;
  if (typeof file.text === "string") rememberBlob(path, file.text);
  return { id: file.id, filename: file.filename, mime: file.mime, bytes: file.bytes, path };
}

export function normalizeMailData(data: MailData): MailData {
  return {
    ...data,
    threads: data.threads.map((thread) => ({
      ...thread,
      messages: sealMessages(
        thread.messages.map((message) => {
          const legacy = message as Message & { attachments: (Attachment & { text?: string })[] };
          return {
            ...message,
            attachments: (legacy.attachments ?? []).map((file) => coerceAttachment(file)),
          };
        }),
        thread.plusTag,
      ),
    })),
  };
}

export function emptyMailbox(): MailData {
  return {
    threads: [],
    labels: [],
    filters: [],
    settings: defaultSettings(),
    aliases: defaultAliases(),
    demoCursor: 0,
    gmail: "off",
  };
}

export function snapshotOf(data: MailData): MailData {
  return structuredClone(data);
}

