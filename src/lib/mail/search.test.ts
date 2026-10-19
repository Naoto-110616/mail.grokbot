import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  defaultAliases,
  defaultSettings,
  keepLocalSettings,
  matchesQuery,
  parseQuery,
  visibleThreads,
  type Message,
  type Thread,
} from "./model.ts";
import { phraseWindow, recentSearchesOf, savedSearchesOf, SEARCH_SUGGESTIONS } from "./search.ts";

const NOW = new Date(2026, 9, 18, 15, 0, 0, 0).getTime();
const LABELS = [{ id: "lab_1", name: "Ops", swatch: "teal" as const }];

function at(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
}

function message(partial: Partial<Message> & Pick<Message, "id" | "from" | "date">): Message {
  return {
    messageId: null,
    inReplyTo: null,
    references: [],
    deliveredTo: "you@example.test",
    account: "primary",
    to: [{ name: "You", email: "you@example.test" }],
    cc: [],
    bcc: [],
    subject: "Hello",
    body: "Hello",
    attachments: [],
    direction: "inbound",
    ...partial,
  };
}

function thread(partial: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    subject: partial.subject ?? "Hello",
    category: "primary",
    location: "inbox",
    labels: [],
    plusTag: null,
    starred: false,
    important: false,
    unread: true,
    muted: false,
    snoozeUntil: null,
    draft: null,
    messages: [
      message({
        id: `${partial.id}-m`,
        from: { name: "Ada", email: "ada@example.test" },
        date: at(2026, 10, 18, 9),
        body: "Hello",
      }),
    ],
    ...partial,
  };
}

function hit(query: string, row: Thread, now = NOW): boolean {
  return matchesQuery(row, parseQuery(query), LABELS, now);
}

describe("search operators", () => {
  it("treats repeated and comma-separated from values as or, and domains as exact", () => {
    const ada = thread({ id: "ada" });
    const bea = thread({
      id: "bea",
      messages: [message({ id: "bea-m", from: { name: "Bea", email: "bea@other.test" }, date: at(2026, 10, 18) })],
    });
    const named = thread({
      id: "named",
      messages: [message({ id: "named-m", from: { name: "example.test", email: "pat@elsewhere.test" }, date: at(2026, 10, 18) })],
    });
    assert.equal(hit("from:ada@example.test,bea@other.test", ada), true);
    assert.equal(hit("from:ada@example.test, bea@other.test", bea), true);
    assert.equal(hit("from:ada@example.test from:bea@other.test", ada), true);
    assert.equal(hit("from:@example.test", ada), true);
    assert.equal(hit("from:@example.test", bea), false);
    assert.equal(hit("from:@example.test", named), false);
    assert.equal(hit("from:@www.example.test", ada), false);
    const parsed = parseQuery("widget:blue");
    assert.deepEqual(parsed.text, ["widget:blue"]);
    assert.deepEqual(parsed.from, []);
  });

  it("matches alias tags, attachments, folders, and exact phrases", () => {
    const ops = thread({
      id: "ops",
      plusTag: "ops",
      subject: "Quarterly review",
      labels: ["lab_1"],
      messages: [
        message({
          id: "ops-m",
          from: { name: "Ada", email: "ada@example.test" },
          date: at(2026, 10, 18),
          deliveredTo: "you+ops@example.test",
          body: "The quarterly review is ready",
          attachments: [{ id: "file", filename: "notes.txt", mime: "text/plain", bytes: 4, path: "session/file" }],
        }),
      ],
    });
    const plain = thread({ id: "plain", subject: "Quarterly internal review", plusTag: null });
    assert.equal(hit("to:+ops", ops), true);
    assert.equal(hit("to:+ops", plain), false);
    assert.equal(hit("to:+ops", thread({
      id: "delivered",
      plusTag: null,
      messages: [message({
        id: "delivered-m",
        from: { name: "Ada", email: "ada@example.test" },
        date: at(2026, 10, 18),
        deliveredTo: "you+ops@example.test",
      })],
    })), true);
    assert.equal(hit("has:attachment", ops), true);
    assert.equal(hit("has:attachment", plain), false);
    assert.equal(hit("subject:quarterly subject:review", ops), true);
    assert.equal(hit('"quarterly review"', ops), true);
    assert.equal(hit('"quarterly review"', plain), false);
    assert.equal(hit('"this week"', ops), false);
    const rows = visibleThreads({
      threads: [ops, thread({ id: "gone", location: "trash" })],
      folder: "inbox",
      category: "all",
      query: "in:trash",
      now: NOW,
      aliases: defaultAliases(),
      labels: LABELS,
    });
    assert.deepEqual(rows.map((row) => row.id), ["gone"]);
  });

  it("filters local date phrases and exclusive ISO bounds", () => {
    assert.equal(new Date(NOW).getDay(), 0);
    const week = phraseWindow("this week", NOW);
    assert.equal(new Date(week.start).getDay(), 1);
    assert.equal(new Date(week.start).getDate(), 12);
    const monday = thread({ id: "mon", messages: [message({ id: "mon-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 12, 0) })] });
    const sundayBefore = thread({ id: "sun", messages: [message({ id: "sun-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 11, 23) })] });
    const nextMonday = thread({ id: "next", messages: [message({ id: "next-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 19, 0) })] });
    assert.equal(hit("this week", monday), true);
    assert.equal(hit("this week", sundayBefore), false);
    assert.equal(hit("this week", nextMonday), false);
    assert.equal(hit("last week", thread({ id: "last", messages: [message({ id: "last-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 5, 12) })] })), true);
    assert.equal(hit("last week", monday), false);
    assert.equal(hit("today", thread({ id: "today" })), true);
    assert.equal(hit("today", thread({ id: "y", messages: [message({ id: "y-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 17, 23) })] })), false);
    assert.equal(hit("yesterday", thread({ id: "y2", messages: [message({ id: "y2-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 17, 12) })] })), true);
    assert.equal(hit("this month", thread({ id: "oct", messages: [message({ id: "oct-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 1, 0) })] })), true);
    assert.equal(hit("this month", thread({ id: "sep", messages: [message({ id: "sep-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 9, 30, 23) })] })), false);
    assert.equal(hit("last month", thread({ id: "sep2", messages: [message({ id: "sep2-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 9, 15, 12) })] })), true);
    assert.equal(hit("last month", monday), false);
    const early = thread({
      id: "early",
      messages: [message({ id: "early-m", from: { name: "Ada", email: "ada@example.test" }, date: "2026-09-30T23:00:00.000Z" })],
    });
    const start = thread({
      id: "start",
      messages: [message({ id: "start-m", from: { name: "Ada", email: "ada@example.test" }, date: "2026-10-01T00:00:00.000Z" })],
    });
    const edge = thread({
      id: "edge",
      messages: [message({ id: "edge-m", from: { name: "Ada", email: "ada@example.test" }, date: "2026-10-18T00:00:00.000Z" })],
    });
    assert.equal(hit("after:2026-10-01 before:2026-10-18", early), false);
    assert.equal(hit("after:2026-10-01 before:2026-10-18", start), true);
    assert.equal(hit("after:2026-10-01 before:2026-10-18", edge), false);
    assert.equal(hit("after:2026-10-01T15:00:00Z", start), false);
    assert.equal(hit("after:2026-10-01T15:00:00Z", thread({
      id: "later",
      messages: [message({ id: "later-m", from: { name: "Ada", email: "ada@example.test" }, date: "2026-10-01T15:00:00.000Z" })],
    })), true);
    assert.equal(hit("meet today", thread({ id: "meet", messages: [message({ id: "meet-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 10, 18, 9), body: "meet at noon" })] })), true);
    assert.equal(hit("meet today", thread({ id: "oldmeet", messages: [message({ id: "oldmeet-m", from: { name: "Ada", email: "ada@example.test" }, date: at(2026, 9, 2), body: "meet at noon" })] })), false);
    assert.deepEqual(parseQuery("before:soon").text, ["before:soon"]);
  });

  it("saves searches with live counts and remembers eight recent ones", () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ id: `s${index}`, query: `q${index}` }));
    many.push({ id: "dup", query: "q0" });
    const saved = savedSearchesOf(many);
    assert.equal(saved.length, 30);
    assert.equal(saved.filter((item) => item.query.toLowerCase() === "q0").length, 1);
    assert.equal(recentSearchesOf(["  One  ", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]).length, 8);
    assert.equal(recentSearchesOf(["  One  ", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"])[0], "One");
    const kept = keepLocalSettings(
      { ...defaultSettings(), savedSearches: [{ id: "keep", query: "from:@example.test" }], recentSearches: ["today"] },
      defaultSettings(),
    );
    assert.equal(kept.savedSearches?.[0]?.query, "from:@example.test");
    assert.deepEqual(kept.recentSearches, ["today"]);
    const ada = thread({ id: "ada" });
    const bea = thread({
      id: "bea",
      messages: [message({ id: "bea-m", from: { name: "Bea", email: "bea@other.test" }, date: at(2026, 10, 18) })],
    });
    const trashed = thread({ id: "trash", location: "trash" });
    const count = visibleThreads({
      threads: [ada, bea, trashed],
      folder: "all",
      category: "all",
      query: "from:@example.test",
      now: NOW,
      aliases: defaultAliases(),
      labels: [],
    }).length;
    assert.equal(count, 1);
    assert.ok(SEARCH_SUGGESTIONS.includes("from:@"));
    assert.ok(SEARCH_SUGGESTIONS.includes("to:+"));
    const shell = readFileSync(new URL("../../components/mail/shell.tsx", import.meta.url), "utf8");
    const sidebar = readFileSync(new URL("../../components/mail/sidebar.tsx", import.meta.url), "utf8");
    assert.match(shell, /id="mail-search"[\s\S]*text-base/);
    assert.match(shell, /rememberSearch\(query\)/);
    assert.match(shell, /SEARCH_SUGGESTIONS/);
    assert.match(sidebar, /folder: "all"/);
    assert.match(sidebar, /category: "all"/);
  });
});
