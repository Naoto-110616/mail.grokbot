import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handledToday, pictureInbox } from "./inbox-zero.ts";
import { applyAct, defaultAliases, type Thread } from "./model.ts";

const NOW = Date.parse("2026-10-18T18:00:00.000Z");

function thread(partial: Partial<Thread> & Pick<Thread, "id" | "category">): Thread {
  return {
    subject: partial.id,
    location: "inbox",
    labels: [],
    plusTag: null,
    starred: false,
    important: false,
    unread: true,
    muted: false,
    snoozeUntil: null,
    messages: [
      {
        id: `${partial.id}-m`,
        messageId: null,
        inReplyTo: null,
        references: [],
        deliveredTo: null,
        account: "primary",
        from: { name: "Ada", email: "ada@example.test" },
        to: [{ name: "You", email: "you@example.test" }],
        cc: [],
        bcc: [],
        subject: partial.id,
        body: "Hello",
        date: "2026-10-18T12:00:00.000Z",
        attachments: [],
        direction: "inbound",
      },
    ],
    draft: null,
    ...partial,
  };
}

const base = {
  folder: "inbox" as const,
  query: "",
  now: NOW,
  aliases: defaultAliases(),
  account: "grokbot" as const,
  address: "you@example.test",
};

describe("inbox zero", () => {
  it("keeps a fresh mailbox distinct from a cleared one", () => {
    const fresh = pictureInbox({ ...base, threads: [], category: "primary", visible: [] });
    assert.deepEqual(fresh, { kind: "fresh", address: "you@example.test" });
    const done = applyAct(thread({ id: "a", category: "primary", unread: false }), "archive", NOW);
    const clear = pictureInbox({ ...base, threads: [done], category: "primary", visible: [] });
    assert.equal(clear.kind, "clear");
    if (clear.kind === "clear") assert.equal(clear.handled, 1);
    const open = thread({ id: "b", category: "primary" });
    assert.equal(pictureInbox({ ...base, threads: [open], category: "primary", visible: [open] }).kind, "messages");
  });

  it("leaves a category tab empty without calling the inbox clear", () => {
    const promo = thread({ id: "p", category: "promotions" });
    const picture = pictureInbox({ ...base, threads: [promo], category: "primary", visible: [] });
    assert.equal(picture.kind, "messages");
    const start = new Date(NOW);
    start.setHours(0, 0, 0, 0);
    const yesterday = applyAct(thread({ id: "old", category: "primary" }), "archive", start.getTime() - 60_000);
    assert.equal(handledToday([yesterday], NOW, "grokbot"), 0);
  });

  it("shows the clear card only when nothing is left in the inbox", () => {
    const snoozed = thread({ id: "s", category: "primary", snoozeUntil: "2026-10-19T08:00:00.000Z", unread: false });
    const picture = pictureInbox({
      ...base,
      threads: [snoozed],
      category: "all",
      visible: [],
    });
    assert.equal(picture.kind, "clear");
    if (picture.kind === "clear") assert.equal(picture.snoozeAt, "2026-10-19T08:00:00.000Z");
    const promo = thread({ id: "p", category: "promotions" });
    assert.equal(pictureInbox({ ...base, threads: [promo], category: "all", visible: [promo] }).kind, "messages");
  });
});
