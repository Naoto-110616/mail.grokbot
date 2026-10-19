import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySenderRules, upsertSenderRule } from "./bundles.ts";
import { applyBackendData } from "./merge.ts";
import { defaultSettings, emptyMailbox, type Thread } from "./model.ts";

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
