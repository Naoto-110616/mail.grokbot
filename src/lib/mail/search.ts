export type SavedSearch = { id: string; query: string };

export type DatePhrase = "today" | "yesterday" | "this week" | "last week" | "this month" | "last month";

export const SEARCH_SUGGESTIONS = [
  "from:",
  "to:",
  "subject:",
  "has:attachment",
  "in:inbox",
  "from:@",
  "to:+",
  "today",
  "yesterday",
  "this week",
  "last week",
  "this month",
  "last month",
] as const;

const PAIRS = new Set<DatePhrase>(["this week", "last week", "this month", "last month"]);

export function datePhraseAt(word: string, next?: string): { phrase: DatePhrase; span: 1 | 2 } | null {
  const pair = next ? `${word.toLowerCase()} ${next.toLowerCase()}` : "";
  if (PAIRS.has(pair as DatePhrase)) return { phrase: pair as DatePhrase, span: 2 };
  const one = word.toLowerCase();
  if (one === "today" || one === "yesterday") return { phrase: one, span: 1 };
  return null;
}

/** Date-only values start at UTC midnight. A full timestamp uses its own instant. */
export function parseIsoBound(value: string): number | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const at = Date.parse(`${text}T00:00:00.000Z`);
    return Number.isNaN(at) ? null : at;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const at = Date.parse(text);
    return Number.isNaN(at) ? null : at;
  }
  return null;
}

function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function startOfMonday(now: number): number {
  const date = new Date(startOfDay(now));
  const day = date.getDay();
  const delta = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - delta);
  return date.getTime();
}

function startOfMonth(now: number): number {
  const date = new Date(startOfDay(now));
  date.setDate(1);
  return date.getTime();
}

function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}

/** Local window [start, end). Weeks begin on Monday. */
export function phraseWindow(phrase: DatePhrase, now: number): { start: number; end: number } {
  const day = startOfDay(now);
  if (phrase === "today") return { start: day, end: addDays(day, 1) };
  if (phrase === "yesterday") return { start: addDays(day, -1), end: day };
  const week = startOfMonday(now);
  if (phrase === "this week") return { start: week, end: addDays(week, 7) };
  if (phrase === "last week") return { start: addDays(week, -7), end: week };
  const month = startOfMonth(now);
  if (phrase === "this month") return { start: month, end: addMonths(month, 1) };
  return { start: addMonths(month, -1), end: month };
}

export function savedSearchesOf(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return [];
  const out: SavedSearch[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; query?: unknown };
    const query = typeof row.query === "string" ? row.query.trim().slice(0, 200) : "";
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 64) : `sq_${out.length}`;
    out.push({ id, query });
    if (out.length >= 30) break;
  }
  return out;
}

export function recentSearchesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const query = item.trim().slice(0, 200);
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
    if (out.length >= 8) break;
  }
  return out;
}
