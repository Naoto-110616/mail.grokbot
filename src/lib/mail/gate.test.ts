import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptStoredSenders,
  applyGate,
  blockDomain,
  decideSenders,
  defaultGate,
  migrateSavedGate,
  pendingCards,
  resolveStatus,
  shouldNotify,
  shouldNotifyThread,
} from "./gate.ts";
import { applyBackendData } from "./merge.ts";
import { defaultAliases, defaultSettings, emptyMailbox, inFolder, mineSet, type Thread } from "./model.ts";

const NOW = Date.parse("2026-10-18T18:00:00.000Z");

function thread(partial: Partial<Thread> & Pick<Thread, "id"> & { from?: string; outboundTo?: string }): Thread {
  const from = partial.from ?? "ada@example.test";
  const messages: Thread["messages"] = [];
  if (partial.outboundTo) {
    messages.push({
      id: `${partial.id}-out`,
      messageId: null,
      inReplyTo: null,
      references: [],
      deliveredTo: null,
      account: "primary",
      from: { name: "You", email: "you@example.test" },
      to: [{ name: "Them", email: partial.outboundTo }],
      cc: [],
      bcc: [],
      subject: partial.id,
      body: "Sent",
      date: "2026-10-17T12:00:00.000Z",
      attachments: [],
      direction: "outbound",
    });
  }
  messages.push({
    id: `${partial.id}-m`,
    messageId: null,
    inReplyTo: null,
    references: [],
    deliveredTo: partial.plusTag ? `you+${partial.plusTag}@example.test` : "you@example.test",
    account: "primary",
    from: { name: from.split("@")[0] || "Ada", email: from },
    to: [{ name: "You", email: "you@example.test" }],
    cc: [],
    bcc: [],
    subject: partial.subject ?? partial.id,
    body: partial.messages?.[0]?.body ?? "Hello from the road",
    date: "2026-10-18T12:00:00.000Z",
    attachments: [],
    direction: from === "you@example.test" ? "outbound" : "inbound",
  });
  const { from: _from, outboundTo: _to, ...rest } = partial;
  return {
    subject: partial.id,
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
    ...rest,
    messages,
  };
}

describe("new senders", () => {
  it("keeps a first-time sender out of the inbox until accept or block", () => {
    const mine = mineSet(defaultAliases());
    const gated = applyGate(
      [thread({ id: "new", from: "ada@example.test", plusTag: "ops", subject: "Hello" })],
      { ...defaultGate(), mode: "before" },
      defaultAliases(),
    );
    const row = gated.threads[0];
    assert.ok(row);
    assert.equal(row.screen, "pending");
    assert.equal(inFolder(row, "inbox", NOW, mine), false);
    assert.equal(shouldNotifyThread(row), false);
    assert.equal(shouldNotify("pending"), false);
    const [card] = pendingCards(gated.threads);
    assert.equal(card?.email, "ada@example.test");
    assert.equal(card?.plusTag, "ops");
    const accepted = applyGate(gated.threads, decideSenders(gated.book, ["ada@example.test"], "accepted"), defaultAliases());
    assert.equal(accepted.threads[0]?.screen ?? null, null);
    assert.equal(inFolder(accepted.threads[0]!, "inbox", NOW, mine), true);
    const blocked = applyGate(gated.threads, decideSenders(gated.book, ["ada@example.test"], "blocked"), defaultAliases());
    assert.equal(blocked.threads[0]?.screen, "blocked");
    assert.equal(inFolder(blocked.threads[0]!, "blocked", NOW, mine), true);
    assert.equal(shouldNotify("blocked"), false);
    assert.equal(shouldNotifyThread(blocked.threads[0]!), false);
  });

  it("lets an accepted address beat a domain block and skips mail you already trust", () => {
    const book = decideSenders(blockDomain(defaultGate(), "example.test"), ["ada@example.test"], "accepted");
    assert.equal(resolveStatus("ada@example.test", book), "accepted");
    assert.equal(resolveStatus("bea@example.test", book), "blocked");
    const gated = applyGate(
      [
        thread({ id: "ada", from: "ada@example.test" }),
        thread({ id: "bea", from: "bea@example.test" }),
        thread({ id: "me", from: "you@example.test" }),
        thread({ id: "bot", from: "mailer-daemon@example.test" }),
        thread({ id: "reply", from: "new@example.test", outboundTo: "new@example.test" }),
      ],
      book,
      defaultAliases(),
    );
    const byId = new Map(gated.threads.map((item) => [item.id, item.screen ?? null]));
    assert.equal(byId.get("ada"), null);
    assert.equal(byId.get("bea"), "blocked");
    assert.equal(byId.get("me"), null);
    assert.equal(byId.get("bot"), null);
    assert.equal(byId.get("reply"), null);
    const seeded = applyGate(
      [thread({ id: "sent", outboundTo: "sam@example.test", from: "sam@example.test" }), thread({ id: "later", from: "sam@example.test" })],
      defaultGate(),
      defaultAliases(),
    );
    assert.equal(seeded.book.senders["sam@example.test"], "accepted");
    assert.equal(seeded.threads.every((item) => (item.screen ?? null) === null), true);
  });

  it("screens inside the message, turns off, and accepts fifty senders at once", () => {
    const inside = applyGate([thread({ id: "a", from: "ada@example.test" })], { ...defaultGate(), mode: "inside" }, defaultAliases());
    assert.equal(inside.threads[0]?.screen ?? null, null);
    assert.equal(inside.threads[0]?.review, true);
    assert.equal(inFolder(inside.threads[0]!, "inbox", NOW, mineSet(defaultAliases())), true);
    assert.equal(shouldNotifyThread(inside.threads[0]!), false);
    const off = applyGate([thread({ id: "a", from: "ada@example.test" })], { ...defaultGate(), mode: "off" }, defaultAliases());
    assert.equal(off.threads[0]?.review, false);
    assert.equal(shouldNotifyThread(off.threads[0]!), true);
    const emails = Array.from({ length: 50 }, (_, index) => `person${index}@example.test`);
    const threads = emails.map((email, index) => thread({ id: `t${index}`, from: email }));
    const bulk = applyGate(threads, decideSenders(defaultGate(), emails, "accepted"), defaultAliases());
    assert.equal(Object.keys(bulk.book.senders).length, 50);
    assert.equal(bulk.threads.every((item) => (item.screen ?? null) === null), true);
    assert.equal(pendingCards(bulk.threads).length, 0);
  });

  it("keeps accept and block across a mailbox refresh", () => {
    const current = emptyMailbox();
    current.settings = { ...defaultSettings(), gate: decideSenders(defaultGate(), ["ada@example.test"], "blocked") };
    const incoming = emptyMailbox();
    incoming.threads = [thread({ id: "ada", from: "ada@example.test" }), thread({ id: "bea", from: "bea@example.test" })];
    const merged = applyBackendData(current, incoming);
    assert.equal(merged.settings.gate?.senders["ada@example.test"], "blocked");
    assert.equal(merged.threads.find((item) => item.id === "ada")?.screen, "blocked");
    assert.equal(merged.threads.find((item) => item.id === "bea")?.screen ?? null, null);
    assert.equal(merged.settings.density, current.settings.density);
    const screening = applyBackendData(
      {
        ...current,
        settings: { ...current.settings, gate: { ...decideSenders(defaultGate(), ["ada@example.test"], "blocked"), mode: "before" } },
      },
      incoming,
    );
    assert.equal(screening.threads.find((item) => item.id === "bea")?.screen, "pending");
  });

  it("stays off until turned on, then trusts senders already stored", () => {
    const mine = mineSet(defaultAliases());
    assert.equal(defaultGate().mode, "off");
    const stored = thread({ id: "ada", from: "ada@example.test" });
    const off = applyGate([stored], defaultGate(), defaultAliases());
    assert.equal(off.threads[0]?.screen ?? null, null);
    assert.equal(inFolder(off.threads[0]!, "inbox", NOW, mine), true);
    assert.equal(inFolder({ ...off.threads[0]!, location: "spam" }, "all", NOW, mine), true);
    assert.equal(inFolder({ ...off.threads[0]!, location: "trash" }, "all", NOW, mine), false);
    assert.equal(inFolder({ ...off.threads[0]!, screen: "pending" }, "all", NOW, mine), true);
    const enabled = acceptStoredSenders({ ...defaultGate(), mode: "before" }, [stored]);
    assert.equal(enabled.senders["ada@example.test"], "accepted");
    const later = applyGate([stored, thread({ id: "new", from: "new@example.test" })], enabled, defaultAliases());
    assert.equal(later.threads.find((item) => item.id === "ada")?.screen ?? null, null);
    assert.equal(later.threads.find((item) => item.id === "new")?.screen, "pending");
    assert.equal(migrateSavedGate({ mode: "before", senders: {}, domains: [] }, [stored]).mode, "off");
    const used = migrateSavedGate({ mode: "before", senders: { "ada@example.test": "blocked" }, domains: [] }, [
      stored,
      thread({ id: "bea", from: "bea@example.test" }),
    ]);
    assert.equal(used.mode, "before");
    assert.equal(used.senders["ada@example.test"], "blocked");
    assert.equal(used.senders["bea@example.test"], "accepted");
    assert.equal(migrateSavedGate({ mode: "inside", senders: {}, domains: [] }, [stored]).senders["ada@example.test"], "accepted");
  });
});
