import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { handleOutboxApi } from "../../server/mail/outbox-api.server.ts";
import { saveBotConnection } from "../../server/mail/config.server.ts";
import {
  cancelDemoOutbox,
  readDemoMailbox,
  resetDemoMailbox,
  writeDemoMailbox,
} from "../../server/mail/demo-state.server.ts";
import {
  SAMPLE_ADDRESS,
  SAMPLE_NOTE,
  SAMPLE_OUTBOX_ID,
  demoMailbox,
  demoPreview,
} from "./demo-mailbox.ts";
import { inFolder, mineSet, signatureFor } from "./model.ts";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "GBM_DEMO",
  "GBM_SITE_PASSWORD",
  "APP_PASSWORD",
  "OUTBOX_STUB_DB",
] as const;
const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
  (typeof ENV_KEYS)[number],
  string | undefined
>;

let aliased = false;

function enableAlias(): void {
  if (aliased) return;
  aliased = true;
  register(new URL("../../../scripts/test-alias-hook.mjs", import.meta.url).href, import.meta.url);
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function emailsIn(value: unknown, found: string[]): void {
  if (typeof value === "string") {
    const matches = value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g);
    if (matches) found.push(...matches);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) emailsIn(item, found);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) emailsIn(item, found);
  }
}

afterEach(() => {
  resetDemoMailbox();
  restoreEnv();
});

describe("sample mailbox", () => {
  it("uses example.com only and keeps a signature, draft, sent row, and queued send", () => {
    const data = demoMailbox();
    const signature = signatureFor("You", SAMPLE_ADDRESS);
    const found: string[] = [];
    emailsIn(data, found);
    assert.ok(found.length > 0);
    for (const email of found) assert.equal(email.endsWith("@example.com"), true);
    assert.equal(data.sample, true);
    assert.equal(data.settings.defaultFrom, SAMPLE_ADDRESS);
    assert.equal(data.settings.signature, signature);
    assert.equal(
      data.threads.find((thread) => thread.id === "thr_draft")?.draft?.body.includes(signature),
      true,
    );
    assert.equal(data.outbox?.[0]?.text.includes(signature), true);
    assert.equal(data.outbox?.[0]?.id, SAMPLE_OUTBOX_ID);
    assert.equal(data.outbox?.[0]?.status, "queued");

    const mine = mineSet(data.aliases);
    const inbox = data.threads
      .filter((thread) => inFolder(thread, "inbox", NOW, mine))
      .map((thread) => thread.subject);
    assert.deepEqual(inbox, ["Saturday picnic", "Sensor check", "This week at the shop"]);
    assert.equal(
      data.threads.find((thread) => thread.subject === "Saturday picnic")?.category,
      "primary",
    );
    assert.equal(
      data.threads.find((thread) => thread.subject === "Sensor check")?.category,
      "updates",
    );
    assert.equal(
      data.threads.find((thread) => thread.subject === "This week at the shop")?.category,
      "promotions",
    );
    assert.equal(
      data.threads.filter((thread) => inFolder(thread, "sent", NOW, mine)).length >= 2,
      true,
    );
    assert.equal(
      data.threads.some((thread) => inFolder(thread, "drafts", NOW, mine)),
      true,
    );
    assert.deepEqual(demoPreview(data), {
      sample: true,
      note: SAMPLE_NOTE,
      subjects: ["Saturday picnic", "Sensor check", "This week at the shop"],
    });
  });

  it("cancels a queued sample send and rejects any other status", () => {
    resetDemoMailbox();
    assert.deepEqual(cancelDemoOutbox("missing"), { ok: false, status: 404, error: "not found" });
    assert.deepEqual(cancelDemoOutbox(SAMPLE_OUTBOX_ID), {
      ok: true,
      id: SAMPLE_OUTBOX_ID,
      status: "cancelled",
    });
    assert.equal(
      readDemoMailbox().outbox?.some((item) => item.id === SAMPLE_OUTBOX_ID),
      false,
    );
    assert.equal(
      readDemoMailbox().threads.some((thread) =>
        thread.messages.some((message) => message.clientSendId === SAMPLE_OUTBOX_ID),
      ),
      false,
    );
    const sent = demoMailbox();
    writeDemoMailbox({
      ...sent,
      outbox: [
        {
          ...(sent.outbox?.[0] ?? {
            id: "send_x",
            fromAddress: SAMPLE_ADDRESS,
            to: [],
            cc: [],
            subject: "",
            text: "",
            error: null,
            createdAt: "",
          }),
          status: "sent",
        },
      ],
    });
    const blocked = cancelDemoOutbox(sent.outbox?.[0]?.id ?? SAMPLE_OUTBOX_ID);
    assert.deepEqual(blocked, { ok: false, status: 409, error: "conflict" });
  });

  it("serves sample mail from memory when GBM_DEMO=1, even with a database URL", async () => {
    process.env.GBM_DEMO = "1";
    process.env.DATABASE_URL = "postgres://db.example/mail";
    process.env.OUTBOX_STUB_DB = "1";
    delete process.env.GBM_SITE_PASSWORD;
    delete process.env.APP_PASSWORD;
    enableAlias();
    resetDemoMailbox();
    const root = await mkdtemp(join(tmpdir(), "mail-demo-"));
    try {
      const { loadBridgeMailbox, sendMailbox, syncMailbox } =
        await import("../../server/mail/store.server.ts");
      const loaded = await loadBridgeMailbox(null, root);
      assert.equal(loaded.sample, true);
      assert.equal(loaded.settings.defaultFrom, SAMPLE_ADDRESS);
      const synced = await syncMailbox(loaded, root);
      assert.equal(synced.notice, "Sample mailbox. No bot is connected.");
      assert.equal(synced.delivery, "sent");
      const sent = await sendMailbox(
        loaded,
        {
          from: SAMPLE_ADDRESS,
          to: [{ name: "Ada", email: "ada@example.com" }],
          cc: [],
          bcc: [],
          subject: "Hello",
          body: "Typed body",
          attachments: [],
          replyToId: null,
          replyToMessageId: null,
          threadId: null,
          draftThreadId: null,
          mode: "new",
          displayName: "You",
        },
        root,
      );
      assert.equal(sent.notice, "Sample only. Nothing was sent.");
      assert.equal(sent.delivery, "waiting");
      assert.equal(sent.data.sample, true);
      assert.equal(
        sent.data.outbox?.some((item) => item.subject === "Hello"),
        true,
      );
      const saved = await saveBotConnection({
        webhookUrl: "https://bot.example/hook",
        webhookKey: "not-a-real-key",
        headerMode: "bearer",
      });
      assert.equal(saved.webhookUrl, "https://bot.example/hook");
      assert.equal(saved.keySet, true);
      const response = await handleOutboxApi(
        new Request(`https://mail.example/api/outbox/${SAMPLE_OUTBOX_ID}`, { method: "DELETE" }),
      );
      assert.equal(response.status, 200);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
