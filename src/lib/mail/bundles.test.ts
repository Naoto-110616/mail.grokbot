import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySenderRules, upsertSenderRule } from "./bundles.ts";
import { applyInboxCategories, categoryInboxTotal, classifyMessage, classifyThread, unreadBadgeLabel, visibleCategoryTabs } from "./category.ts";
import { applyBackendData } from "./merge.ts";
import { categoryCount, defaultAliases, defaultSettings, emptyMailbox, type Message, type Thread } from "./model.ts";

function thread(partial: Partial<Thread> & Pick<Thread, "id" | "category"> & { from?: string }): Thread {
  const { from: fromEmail = "ada@example.test", ...rest } = partial;
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
    draft: null,
    ...rest,
    messages: rest.messages ?? [
      {
        id: `${partial.id}-m`,
        messageId: null,
        inReplyTo: null,
        references: [],
        deliveredTo: null,
        account: "primary",
        from: { name: fromEmail.split("@")[0] || "Ada", email: fromEmail },
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
  };
}

describe("sender rules", () => {
  it("routes the next message from a filed sender", () => {
    const rules = upsertSenderRule([], "Ada@example.test", "promotions");
    const fresh = thread({ id: "new", category: "primary", from: "ada@example.test" });
    assert.equal(applySenderRules([fresh], rules)[0]?.category, "promotions");
    const other = thread({ id: "other", category: "primary", from: "bea@example.test" });
    assert.equal(applySenderRules([other], rules)[0]?.category, "primary");
    const current = emptyMailbox();
    current.settings = { ...defaultSettings(), density: "compact", senderRules: rules };
    const incoming = emptyMailbox();
    incoming.threads = [fresh];
    const merged = applyBackendData(current, incoming);
    assert.equal(merged.threads[0]?.category, "promotions");
    assert.equal(merged.settings.density, "compact");
    assert.equal(merged.settings.senderRules?.[0]?.email, "ada@example.test");
    assert.equal(merged.settings.gate?.mode, "off");
  });
});

describe("inbox categories", () => {
  const now = Date.parse("2026-10-19T12:00:00.000Z");
  const aliases = defaultAliases();

  function message(from: { name: string; email: string }, extra: Partial<Message> = {}): Message {
    return {
      id: "m",
      messageId: null,
      inReplyTo: null,
      references: [],
      deliveredTo: null,
      account: "primary",
      from,
      to: [{ name: "You", email: "you@example.test" }],
      cc: [],
      bcc: [],
      subject: "Note",
      body: "Hello",
      date: "2026-10-18T12:00:00.000Z",
      attachments: [],
      direction: "inbound",
      ...extra,
    };
  }

  it("keeps people in Primary and files automated, bulk, and social senders", () => {
    assert.equal(classifyMessage(message({ name: "Mina Cole", email: "mina@example.com" })), "primary");
    assert.equal(classifyMessage(message({ name: "Mina Cole", email: "mina@example.com" }, { autoSubmitted: "no" })), "primary");
    assert.equal(classifyMessage(message({ name: "WatchBot", email: "alerts@example.com" })), "updates");
    assert.equal(classifyMessage(message({ name: "Notes", email: "no-reply@status.example.com" })), "updates");
    assert.equal(classifyMessage(message({ name: "Notifier", email: "notifications@github.com" })), "updates");
    assert.equal(classifyMessage(message({ name: "Post", email: "mailer-daemon@example.com" })), "updates");
    assert.equal(classifyMessage(message({ name: "Person", email: "person@example.com" }, { autoSubmitted: "auto-generated" })), "updates");
    assert.equal(classifyMessage(message({ name: "Status Bot", email: "person@example.com" })), "updates");
    assert.equal(classifyMessage(message({ name: "Northwind", email: "newsletter@shop.example.com" })), "promotions");
    assert.equal(classifyMessage(message({ name: "Shop", email: "deals@shop.example.com" })), "promotions");
    assert.equal(
      classifyMessage(message({ name: "Shop", email: "no-reply@shop.example.com" }, { listUnsubscribe: "<mailto:unsubscribe@shop.example.com>" })),
      "promotions",
    );
    assert.equal(classifyMessage(message({ name: "X", email: "notify@x.com" })), "social");
    assert.equal(classifyMessage(message({ name: "X", email: "no-reply@x.com" })), "social");
    assert.equal(classifyMessage(message({ name: "Li", email: "news@mail.linkedin.com" })), "social");
    assert.equal(classifyMessage(message({ name: "Not X", email: "ada@evilx.com" })), "primary");
    assert.equal(
      classifyMessage(
        message(
          { name: "Printshop", email: "hello@print.example" },
          { subject: "This week in the shop", body: "New colors are in. Unsubscribe any time." },
        ),
      ),
      "primary",
    );
    assert.equal(
      classifyMessage(
        message(
          { name: "Printshop", email: "hello@print.example" },
          {
            subject: "This week in the shop",
            body: "New colors are in. Unsubscribe any time.",
            listUnsubscribe: "<mailto:bye@print.example>",
          },
        ),
      ),
      "promotions",
    );
    assert.equal(
      classifyMessage(message({ name: "WatchBot", email: "watcher@example.com" }, { subject: "Alert: sensor offline" })),
      "updates",
    );
    assert.equal(classifyMessage(message({ name: "WatchBot", email: "watcher@example.com" })), "updates");
    assert.equal(
      classifyMessage(message({ name: "Mina Cole", email: "mina@example.com" }, { subject: "Alert: gate open" })),
      "updates",
    );
  });

  it("classifies from the latest inbound sender and lets a sender rule win", () => {
    const alert = thread({ id: "alert", category: "primary", from: "alerts@example.com" });
    const first = alert.messages[0];
    assert.ok(first);
    const replied = {
      ...alert,
      messages: [
        first,
        {
          ...first,
          id: "alert-out",
          direction: "outbound" as const,
          from: { name: "You", email: "you@example.test" },
          date: "2026-10-18T18:00:00.000Z",
        },
      ],
    };
    assert.equal(classifyThread(replied), "updates");
    const rules = upsertSenderRule([], "alerts@example.com", "primary");
    assert.equal(applyInboxCategories([alert], rules)[0]?.category, "primary");
    assert.equal(applyInboxCategories([alert], [])[0]?.category, "updates");
    const human = thread({ id: "human", category: "updates", from: "mina@example.com" });
    assert.equal(applyInboxCategories([human], [])[0]?.category, "primary");
    const incoming = emptyMailbox();
    incoming.threads = [alert];
    assert.equal(applyBackendData(emptyMailbox(), incoming).threads[0]?.category, "updates");
  });

  it("hides a category tab with no inbox mail and labels unread counts", () => {
    const human = thread({ id: "human", category: "promotions", from: "mina@example.com", unread: false });
    const social = thread({ id: "social", category: "primary", from: "notify@x.com" });
    const archived = thread({ id: "old", category: "primary", from: "alerts@example.com", location: "archive" });
    const next = applyInboxCategories([human, social, archived], []);
    assert.equal(next.find((item) => item.id === "human")?.category, "primary");
    assert.equal(next.find((item) => item.id === "social")?.category, "social");
    assert.equal(next.find((item) => item.id === "old")?.category, "updates");
    assert.deepEqual(
      visibleCategoryTabs(next, now, aliases).map((tab) => tab.id),
      ["primary", "social"],
    );
    assert.equal(categoryInboxTotal(next, "updates", now, aliases), 0);
    assert.equal(categoryInboxTotal(next, "primary", now, aliases), 1);
    assert.equal(categoryCount(next, "primary", now, aliases), 0);
    assert.equal(categoryCount(next, "social", now, aliases), 1);
    assert.equal(unreadBadgeLabel(0), null);
    assert.equal(unreadBadgeLabel(1), "1 unread");
    assert.equal(unreadBadgeLabel(9), "9 unread");
  });
});
