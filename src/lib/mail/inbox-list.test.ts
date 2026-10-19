import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { threadsFromMessages } from "../../server/mail/ingest.server.ts";
import { applyGate, defaultGate } from "./gate.ts";
import { defaultAliases, inFolder, isDone, mineSet, visibleThreads, type Category, type Message } from "./model.ts";

const NOW = Date.parse("2026-10-18T18:00:00.000Z");
const CATEGORY_CYCLE: Category[] = ["primary", "social", "updates", "promotions"];

describe("inbox list", () => {
  it("shows every legacy thread in the inbox, newest first", () => {
    const messages: Message[] = Array.from({ length: 68 }, (_, index) => ({
      id: `msg_${index}`,
      messageId: null,
      inReplyTo: null,
      references: [],
      deliveredTo: null,
      account: "primary",
      from: { name: "Sender", email: `sender${index % 17}@example.test` },
      to: [{ name: "You", email: "you@example.test" }],
      cc: [],
      bcc: [],
      subject: `Note ${index}`,
      body: "Hello",
      date: new Date(NOW - index * 60_000).toISOString(),
      attachments: [],
      threadHint: null,
      direction: null,
    }));
    const threaded = threadsFromMessages(messages, new Map(), "you@example.test").map((thread, index) => ({
      ...thread,
      category: CATEGORY_CYCLE[index % CATEGORY_CYCLE.length] ?? "primary",
      unread: index % 3 !== 0,
    }));
    const gated = applyGate(threaded, defaultGate(), defaultAliases());
    assert.equal(gated.book.mode, "off");
    assert.equal(gated.threads.every((thread) => (thread.screen ?? null) === null && !thread.doneAt && !isDone(thread)), true);
    const opts = {
      threads: gated.threads,
      folder: "inbox" as const,
      query: "",
      now: NOW,
      aliases: defaultAliases(),
      labels: [],
      account: "grokbot" as const,
      showDone: false,
    };
    const inbox = visibleThreads({ ...opts, category: "all" });
    assert.equal(inbox.length, 68);
    assert.deepEqual(
      inbox.map((thread) => thread.id),
      Array.from({ length: 68 }, (_, index) => `thr_msg_${index}`),
    );
    const covered = new Set<string>();
    for (const category of CATEGORY_CYCLE) {
      const tab = visibleThreads({ ...opts, category });
      assert.deepEqual(
        tab.map((thread) => thread.id),
        inbox.filter((thread) => thread.category === category).map((thread) => thread.id),
      );
      for (const thread of tab) covered.add(thread.id);
    }
    assert.equal(covered.size, 68);
    const sample = gated.threads[0];
    assert.ok(sample);
    const mine = mineSet(defaultAliases());
    assert.equal(inFolder({ ...sample, location: "spam" }, "all", NOW, mine), true);
    assert.equal(inFolder({ ...sample, location: "trash" }, "all", NOW, mine), false);
    const list = readFileSync(new URL("../../components/mail/thread-list.tsx", import.meta.url), "utf8");
    assert.equal(list.includes("primaryFeed"), false);
    assert.equal(list.includes("seenOpen"), false);
    assert.equal(list.includes(">Seen<"), false);
    assert.equal(list.includes("rows.map("), true);
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    assert.equal(store.includes('folder: "inbox",\n        category: "all"'), true);
  });
});
