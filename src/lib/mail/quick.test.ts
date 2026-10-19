import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { defaultSettings, keepLocalSettings, mineSet, type Message, type Thread } from "./model.ts";
import {
  buildQuickRequest,
  chipsAllowed,
  defaultQuickReplies,
  otherRecipients,
  quickRepliesOf,
} from "./quick.ts";

const MINE = mineSet([{ email: "you@example.test", tag: null, name: "You" }]);

function message(partial: Partial<Message> & Pick<Message, "id" | "from">): Message {
  return {
    messageId: `<${partial.id}@example.test>`,
    inReplyTo: null,
    references: [],
    deliveredTo: "you@example.test",
    account: "primary",
    to: [{ name: "You", email: "you@example.test" }],
    cc: [],
    bcc: [],
    subject: "Hello",
    body: "Hello from the road",
    date: "2026-10-18T12:00:00.000Z",
    attachments: [],
    direction: "inbound",
    ...partial,
  };
}

function thread(partial: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    subject: "Hello",
    category: "primary",
    location: "inbox",
    labels: [],
    plusTag: "ops",
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
      }),
    ],
    ...partial,
  };
}

const thanks = defaultQuickReplies()[0]!;

describe("quick replies", () => {
  it("builds one approval reply and keeps the from address it was given", () => {
    const row = thread({ id: "t1" });
    const request = buildQuickRequest({
      thread: row,
      reply: { ...thanks, emoji: "👋" },
      mode: "reply",
      from: "you+ops@example.test",
      mine: MINE,
      signature: "You\nyou@example.test",
      displayName: "You",
    });
    assert.ok(request);
    assert.equal(request.from, "you+ops@example.test");
    assert.equal(request.mode, "reply");
    assert.deepEqual(request.to.map((item) => item.email), ["ada@example.test"]);
    assert.deepEqual(request.cc, []);
    assert.equal(request.replyToId, "t1-m");
    assert.equal(request.replyToMessageId, "<t1-m@example.test>");
    assert.equal(request.threadId, "t1");
    assert.equal(request.draftThreadId, "t1");
    assert.equal(request.attachments.length, 0);
    assert.ok(request.body.startsWith("👋 Thanks for the note."));
    assert.ok(request.body.includes("You\nyou@example.test"));
    assert.equal(request.body.includes("smtp"), false);
  });

  it("replies to the sender until reply all is chosen", () => {
    const row = thread({
      id: "many",
      messages: [
        message({
          id: "many-m",
          from: { name: "Ada", email: "ada@example.test" },
          to: [
            { name: "You", email: "you@example.test" },
            { name: "Bea", email: "bea@example.test" },
          ],
          cc: [{ name: "Cy", email: "cy@example.test" }],
        }),
      ],
    });
    const inbound = row.messages[0]!;
    assert.deepEqual(otherRecipients(inbound, MINE), ["ada@example.test", "bea@example.test", "cy@example.test"]);
    const one = buildQuickRequest({
      thread: row,
      reply: thanks,
      mode: "reply",
      from: "you@example.test",
      mine: MINE,
      signature: "",
      displayName: "You",
    });
    const all = buildQuickRequest({
      thread: row,
      reply: thanks,
      mode: "replyAll",
      from: "you@example.test",
      mine: MINE,
      signature: "",
      displayName: "You",
    });
    assert.deepEqual(one?.to.map((item) => item.email), ["ada@example.test"]);
    assert.deepEqual(one?.cc, []);
    assert.deepEqual(all?.to.map((item) => item.email), ["ada@example.test", "bea@example.test"]);
    assert.deepEqual(all?.cc.map((item) => item.email), ["cy@example.test"]);
  });

  it("hides chips for newsletters, no-reply, drafts, waiting, and screened mail", () => {
    assert.equal(chipsAllowed(thread({ id: "ok" })), true);
    assert.equal(buildQuickRequest({
      thread: thread({ id: "promo", category: "promotions" }),
      reply: thanks,
      mode: "reply",
      from: "you@example.test",
      mine: MINE,
      signature: "",
      displayName: "You",
    }), null);
    for (const email of [
      "noreply@example.test",
      "no-reply@example.test",
      "notifications@example.test",
      "newsletter@example.test",
      "mailer-daemon@example.test",
      "postmaster@example.test",
    ]) {
      assert.equal(
        chipsAllowed(thread({
          id: email,
          messages: [message({ id: "auto", from: { name: "Bot", email } })],
        })),
        false,
      );
    }
    assert.equal(chipsAllowed(thread({
      id: "draft",
      draft: {
        mode: "reply",
        replyToId: "draft-m",
        from: "you@example.test",
        to: "ada@example.test",
        cc: "",
        bcc: "",
        subject: "Re: Hello",
        body: "Draft",
        updatedAt: "2026-10-18T12:00:00.000Z",
        attachments: [],
      },
    })), false);
    assert.equal(chipsAllowed(thread({
      id: "wait",
      messages: [message({ id: "wait-m", from: { name: "Ada", email: "ada@example.test" }, delivery: "waiting" })],
    })), false);
    assert.equal(chipsAllowed(thread({ id: "pending", screen: "pending" })), false);
    assert.equal(chipsAllowed(thread({ id: "blocked", screen: "blocked" })), false);
    assert.equal(chipsAllowed(thread({ id: "review", review: true })), false);
    assert.equal(chipsAllowed(thread({
      id: "out",
      messages: [message({ id: "out-m", from: { name: "You", email: "you@example.test" }, direction: "outbound" })],
    })), false);
  });

  it("keeps three to five replies and updates what the reader will show", () => {
    assert.equal(defaultQuickReplies().length, 3);
    const messy = [
      { id: "a", name: "  Thanks  ", text: "  Thanks for the note.  ", emoji: "👍👍👍👍👍" },
      { id: "a", name: "Got it", text: "Got it.", emoji: "" },
      { name: "", text: "skip" },
      { name: "Empty", text: "   " },
      { name: "One", text: "One." },
      { name: "Two", text: "Two." },
      { name: "Three", text: "Three." },
      { name: "Four", text: "Four." },
    ];
    const clean = quickRepliesOf(messy);
    assert.equal(clean.length, 5);
    assert.equal(clean[0]?.name, "Thanks");
    assert.equal(clean[0]?.text, "Thanks for the note.");
    assert.equal([...clean[0]!.emoji].length, 4);
    assert.notEqual(clean[1]?.id, clean[0]?.id);
    assert.equal(clean.some((item) => item.name === "Four"), false);
    assert.deepEqual(quickRepliesOf("nope").map((item) => item.id), ["thanks", "got", "soon"]);
    const edited = quickRepliesOf([{ id: "live", name: "On it", text: "On it.", emoji: "" }]);
    assert.equal(edited[0]?.name, "On it");
    const kept = keepLocalSettings(
      { ...defaultSettings(), quickReplies: edited },
      defaultSettings(),
    );
    assert.equal(kept.quickReplies?.[0]?.name, "On it");
  });

  it("sends the chip through the bot bridge and never a direct transport", () => {
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    const reader = readFileSync(new URL("../../components/mail/reader.tsx", import.meta.url), "utf8");
    const overlays = readFileSync(new URL("../../components/mail/overlays.tsx", import.meta.url), "utf8");
    const quickStart = store.indexOf("sendQuick: (threadId, replyId, mode)");
    const quickEnd = store.indexOf("dismissCompose:", quickStart);
    const quick = store.slice(quickStart, quickEnd);
    assert.ok(quickStart > 0);
    assert.match(quick, /getActiveBackend\(\)\.send/);
    assert.match(quick, /Sent for approval/);
    assert.match(quick, /plusFallback\(s, thread\.plusTag, s\.account\)/);
    assert.equal(quick.includes("smtp"), false);
    assert.equal(store.includes("smtp"), false);
    assert.match(reader, /sendQuick\(/);
    assert.match(reader, /quickRepliesOf\(/);
    assert.equal(reader.includes("smtp"), false);
    assert.match(overlays, /Quick replies/);
    assert.match(overlays, /settings\.quickReplies \?\? defaultQuickReplies\(\)/);
    assert.equal(overlays.includes("quickRepliesOf"), false);
  });
});
