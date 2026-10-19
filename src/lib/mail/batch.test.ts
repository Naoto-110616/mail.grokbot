import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { needsBulkConfirm, readKind, starKind } from "./batch.ts";
import { applyAct, emptyMailbox, snapshotOf, type Thread } from "./model.ts";

const NOW = Date.parse("2026-10-18T15:00:00.000Z");

function thread(id: string, partial: Partial<Thread> = {}): Thread {
  return {
    id,
    subject: id,
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
      {
        id: `${id}-m`,
        messageId: null,
        inReplyTo: null,
        references: [],
        deliveredTo: "you@example.test",
        account: "primary",
        from: { name: "Ada", email: "ada@example.test" },
        to: [{ name: "You", email: "you@example.test" }],
        cc: [],
        bcc: [],
        subject: id,
        body: "Hello",
        date: "2026-10-18T12:00:00.000Z",
        attachments: [],
        direction: "inbound",
      },
    ],
    ...partial,
  };
}

function roundTrip(count: number) {
  const threads = Array.from({ length: count }, (_, index) => thread(`t${index}`));
  const before = snapshotOf({ ...emptyMailbox(), threads });
  const acted = {
    ...before,
    threads: before.threads.map((item) => applyAct(item, "archive", NOW)),
  };
  assert.equal(acted.threads.every((item) => item.location === "archive" && item.doneAt), true);
  const restored = snapshotOf(before);
  assert.equal(restored.threads.length, count);
  assert.equal(restored.threads.every((item) => item.location === "inbox" && !item.doneAt), true);
  assert.notEqual(acted, restored);
}

describe("batch select", () => {
  it("confirms only above 500 and round-trips done for 1, 50, and 500", () => {
    assert.equal(needsBulkConfirm(500), false);
    assert.equal(needsBulkConfirm(501), true);
    roundTrip(1);
    roundTrip(50);
    roundTrip(500);
  });

  it("sets star and read to the minority state, and star sticks", () => {
    const tie = [thread("a", { starred: true }), thread("b", { starred: true }), thread("c"), thread("d")];
    assert.equal(starKind(tie), "starOff");
    const once = tie.map((item) => applyAct(item, "starOff"));
    assert.equal(once.every((item) => item.starred === false), true);
    assert.equal(once.map((item) => applyAct(item, "starOff")).every((item) => item.starred === false), true);
    assert.equal(starKind([thread("only")]), "starOn");
    assert.equal(starKind([thread("only", { starred: true })]), "starOff");
    assert.equal(applyAct(thread("on"), "starOn").starred, true);
    assert.equal(applyAct(thread("on", { starred: true }), "starOn").starred, true);
    const mostlyUnread = [thread("a"), thread("b"), thread("c", { unread: false })];
    assert.equal(readKind(mostlyUnread), "read");
    const mostlyRead = [thread("a", { unread: false }), thread("b", { unread: false }), thread("c")];
    assert.equal(readKind(mostlyRead), "unread");
    assert.equal(readKind([thread("one")]), "read");
    assert.equal(readKind([thread("one", { unread: false })]), "unread");
  });

  it("keeps select-all from toggling and asks before a large done", () => {
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../../components/mail/shell.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("../../components/mail/thread-list.tsx", import.meta.url), "utf8");
    assert.match(store, /selectAll:\s*\(ids\)\s*=>\s*set\(\{\s*checked:\s*\[\.\.\.new Set\(ids\)\]/);
    assert.match(store, /needsBulkConfirm\(chosen\.length\)/);
    assert.match(store, /starOn/);
    const typing = shell.indexOf("if (isTyping(e.target)) return;");
    const select = shell.indexOf("s.selectAll(s.listedIds)");
    assert.ok(typing > 0 && select > typing);
    assert.match(shell, /aria-label=\{checked\.length > 0 \? "Batch" : "Primary"\}/);
    assert.match(shell, /conversations done\?/);
    assert.match(list, /hidden items-center lg:flex/);
    assert.match(list, /act\(starAction\)/);
    assert.match(list, /act\(readAction\)/);
  });
});
