import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DONE_TOAST, DONE_TOAST_LABEL, popUndo, pushUndo, reopenDoneThread, toastLabel, waitUntilOnline } from "./done.ts";
import {
  applyAct,
  defaultAliases,
  isDone,
  visibleThreads,
  type MailData,
  type Message,
  type Thread,
} from "./model.ts";
import { ignoreSwipeStart, lockSwipe, revealSwipe, SWIPE_EDGE_PX } from "./swipe.ts";

const NOW = Date.parse("2026-10-18T15:00:00.000Z");

function message(partial: Partial<Message> & Pick<Message, "id" | "date">): Message {
  return {
    messageId: null,
    inReplyTo: null,
    references: [],
    deliveredTo: null,
    account: "primary",
    from: { name: "Ada", email: "ada@example.test" },
    to: [{ name: "You", email: "you@example.test" }],
    cc: [],
    bcc: [],
    subject: "Notes",
    body: "Hello",
    attachments: [],
    direction: "inbound",
    ...partial,
  };
}

function thread(partial: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    subject: "Notes",
    category: "primary",
    location: "inbox",
    labels: [],
    plusTag: null,
    starred: false,
    important: false,
    unread: true,
    muted: false,
    snoozeUntil: null,
    messages: [message({ id: `${partial.id}-m`, date: "2026-10-18T12:00:00.000Z" })],
    draft: null,
    ...partial,
  };
}

function mailbox(threads: Thread[]): MailData {
  return {
    threads,
    labels: [],
    filters: [],
    settings: {
      displayName: "You",
      signature: "You",
      density: "comfortable",
      theme: "light",
      glass: 68,
      undoSeconds: 8,
      pane: "right",
      defaultFrom: "you@example.test",
      vacationOn: false,
      vacationText: "I'm away from this mailbox.",
    },
    aliases: defaultAliases(),
    demoCursor: 0,
    gmail: "off",
  };
}

describe("mark done", () => {
  it("archives the thread, stamps doneAt, and clears a snooze", () => {
    const snoozed = thread({ id: "t1", snoozeUntil: "2026-10-19T08:00:00.000Z" });
    const done = applyAct(snoozed, "archive", NOW);
    assert.equal(done.location, "archive");
    assert.equal(done.snoozeUntil, null);
    assert.equal(done.doneAt, "2026-10-18T15:00:00.000Z");
    assert.equal(isDone(done), true);
    assert.equal(applyAct(thread({ id: "bin", location: "trash" }), "archive", NOW).location, "trash");
  });

  it("brings a done thread back when newer inbound mail arrives", () => {
    const done = applyAct(thread({ id: "t1" }), "archive", NOW);
    const quiet = reopenDoneThread({
      ...done,
      messages: [...done.messages, message({ id: "out", date: "2026-10-18T16:00:00.000Z", direction: "outbound" })],
    });
    assert.equal(quiet.location, "archive");
    const replied = reopenDoneThread({
      ...done,
      messages: [...done.messages, message({ id: "in", date: "2026-10-18T16:00:00.000Z", direction: "inbound" })],
    });
    assert.equal(replied.location, "inbox");
    assert.equal(replied.unread, true);
    assert.equal(replied.doneAt, null);
    const sentOnly = thread({
      id: "sent",
      location: "archive",
      messages: [message({ id: "out", date: "2026-10-18T16:00:00.000Z", direction: "outbound" })],
    });
    assert.equal(isDone(sentOnly), false);
    assert.equal(reopenDoneThread(sentOnly).location, "archive");
  });

  it("hides done mail until show done, then restores the original index", () => {
    const rows = [
      thread({ id: "new", messages: [message({ id: "n", date: "2026-10-18T14:00:00.000Z" })] }),
      thread({ id: "mid", messages: [message({ id: "m", date: "2026-10-18T13:00:00.000Z" })] }),
      thread({ id: "old", messages: [message({ id: "o", date: "2026-10-18T12:00:00.000Z" })] }),
    ];
    const opts = {
      folder: "inbox" as const,
      category: "primary" as const,
      query: "",
      now: NOW,
      aliases: defaultAliases(),
      labels: [],
    };
    assert.deepEqual(visibleThreads({ threads: rows, ...opts }).map((item) => item.id), ["new", "mid", "old"]);
    const doneMid = rows.map((item) => (item.id === "mid" ? applyAct(item, "archive", NOW) : item));
    assert.deepEqual(visibleThreads({ threads: doneMid, ...opts }).map((item) => item.id), ["new", "old"]);
    const mixed = visibleThreads({ threads: doneMid, ...opts, showDone: true });
    assert.deepEqual(mixed.map((item) => item.id), ["new", "mid", "old"]);
    assert.equal(mixed[1]?.doneAt, "2026-10-18T15:00:00.000Z");
    assert.deepEqual(
      visibleThreads({ threads: doneMid, ...opts, folder: "done" }).map((item) => item.id),
      ["mid"],
    );
  });

  it("stacks undo lifo and names the done toast", () => {
    const first = mailbox([thread({ id: "a" })]);
    const second = mailbox([thread({ id: "b" })]);
    const third = mailbox([thread({ id: "c" })]);
    let toast = pushUndo(null, DONE_TOAST, first, 5000);
    toast = pushUndo(toast, "Moved to trash", second, 8000);
    toast = pushUndo(toast, DONE_TOAST, third, 5000);
    assert.equal(toast.text, DONE_TOAST);
    assert.equal(toastLabel(toast.text), DONE_TOAST_LABEL);
    assert.equal(toast.stack?.length, 3);
    const once = popUndo(toast);
    assert.equal(once.restore, third);
    assert.equal(once.toast?.text, "Moved to trash");
    const twice = popUndo(once.toast);
    assert.equal(twice.restore, second);
    assert.equal(popUndo(twice.toast).restore, first);
    assert.equal(popUndo(popUndo(twice.toast).toast).toast, null);
  });

  it("waits for online before a queued mail action retries", async () => {
    let up = false;
    let notify = () => {};
    const pending = waitUntilOnline(
      () => up,
      (onOnline) => {
        notify = onOnline;
        return () => {};
      },
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);
    up = true;
    notify();
    await pending;
    assert.equal(settled, true);
  });
});

describe("row swipe", () => {
  it("ignores the screen edge and vertical drags, and commits a right swipe", () => {
    assert.equal(ignoreSwipeStart(SWIPE_EDGE_PX), true);
    assert.equal(ignoreSwipeStart(SWIPE_EDGE_PX + 1), false);
    assert.equal(lockSwipe(4, 40), "scroll");
    assert.equal(lockSwipe(30, 4), "swipe");
    assert.equal(revealSwipe(20)?.commit, false);
    const committed = revealSwipe(90);
    assert.equal(committed?.side, "right");
    assert.equal(committed?.commit, true);
    assert.equal(committed?.depth, "short");
    assert.equal(revealSwipe(-150)?.depth, "long");
    assert.equal(revealSwipe(-150)?.side, "left");
  });
});
