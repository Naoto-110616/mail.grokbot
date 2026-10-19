import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { handleIngestApi, loadStoredIngest, upsertMessage } from "../../server/mail/ingest-api.server.ts";
import { handleOutboxApi } from "../../server/mail/outbox-api.server.ts";
import { inFolder, type Message } from "./model.ts";
import { dedupeSentCopies, mergeSentCopy, sentCopyMatch, SENT_COPY_WINDOW_MS } from "./sent-copies.ts";

const TOKEN = "sent-copy-token";
const OWNER = { name: "Sam Rivera", email: "sam@example.com" };
const ADA = { name: "Ada", email: "ada@example.com" };
const migrations = [
  "0002_mail.sql",
  "0004_mail_ingest.sql",
  "0005_mail_thread_hint.sql",
  "0006_mail_direction.sql",
  "0007_mail_done_at.sql",
  "0008_mail_outbound_bridge.sql",
  "0009_mail_attachment_content.sql",
  "0010_mail_mailbox_config.sql",
  "0011_mail_html_body.sql",
];

function wrap(pg: PGlite): Sql {
  const run = async <T>(text: string, params: unknown[]): Promise<T[]> => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  };
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    return run<T>(text, values);
  }) as Sql;
  sql.query = (text, params = []) => run(text, params);
  return sql;
}

async function database(): Promise<{ sql: Sql; close: () => Promise<void> }> {
  const pg = new PGlite();
  for (const name of migrations) {
    await pg.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  return { sql: wrap(pg), close: () => pg.close() };
}

function mail(partial: Partial<Message> & { id: string }): Message {
  return {
    messageId: null,
    inReplyTo: null,
    references: [],
    deliveredTo: null,
    account: "primary",
    from: OWNER,
    to: [ADA],
    cc: [],
    bcc: [],
    subject: "Lunch plan",
    body: "Test",
    date: "2026-10-19T13:35:16.000Z",
    attachments: [],
    ...partial,
  };
}

async function seedSend(sql: Sql, id: string, subject = "Lunch plan"): Promise<void> {
  const spec = { from: OWNER, to: [ADA], cc: [], bcc: [], subject, body: "Test\n\n--\nSam Rivera\nsam@example.com" };
  await sql.query(
    `insert into mail_outbound (client_send_id, thread_id, spec, status, created_at, updated_at, thread_key)
     values ($1, 'thr_ui', $2, 'awaiting_approval', $3, $3, 'thr_ui')`,
    [id, JSON.stringify(spec), new Date().toISOString()],
  );
}

function markSent(sql: Sql, id: string, providerMessageId: string): Promise<Response> {
  return handleOutboxApi(
    new Request(`https://mail.example/api/outbox/${id}/status`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "sent", providerMessageId }),
    }),
    { env: { INGEST_TOKEN: TOKEN }, sql },
  );
}

function ingest(sql: Sql, items: unknown[]): Promise<Response> {
  return handleIngestApi(
    new Request("https://mail.example/api/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ items }),
    }),
    { env: { INGEST_TOKEN: TOKEN }, sql },
  );
}

/** The bot inbox copy of a sent message, the way the bot posts it on sync. */
function inboxCopy(id: string, extra: Record<string, unknown> = {}) {
  return {
    kind: "message",
    id,
    messageId: `<${id}@example.com>`,
    from: OWNER,
    to: [ADA],
    subject: "Lunch plan",
    body: "Test\n\n--\nSam Rivera\nsam@example.com",
    date: new Date().toISOString(),
    unread: false,
    ...extra,
  };
}

async function sentThreads(sql: Sql) {
  const loaded = await loadStoredIngest(sql);
  const now = Date.now();
  return { loaded, sent: loaded.threads.filter((thread) => inFolder(thread, "sent", now, new Set())) };
}

describe("sent copy matching", () => {
  const app = mail({ id: "msg_4200001", messageId: "4200001", clientSendId: "send_a", direction: "outbound" });

  it("matches the inbox copy by provider message id or Message-ID", () => {
    assert.equal(sentCopyMatch(app, mail({ id: "4200001", messageId: "<x@example.com>" })), "id");
    assert.equal(sentCopyMatch(app, mail({ id: "other", messageId: "<4200001>" })), "id");
    assert.equal(sentCopyMatch(app, mail({ id: "other", messageId: null, clientSendId: "send_a" })), "id");
    const real = mail({ id: "msg_9", messageId: "<sent-9@example.com>", clientSendId: "send_b" });
    assert.equal(sentCopyMatch(real, mail({ id: "z", messageId: "<sent-9@example.com>" })), "id");
  });

  it("falls back to from, to, subject, and a close time", () => {
    assert.equal(sentCopyMatch(app, mail({ id: "copy", messageId: "<c@example.com>", date: "2026-10-19T13:36:00.000Z" })), "fuzzy");
    assert.equal(sentCopyMatch(app, mail({ id: "copy", subject: "  lunch   plan " })), "fuzzy");
    const late = new Date(Date.parse(app.date) + SENT_COPY_WINDOW_MS + 1000).toISOString();
    assert.equal(sentCopyMatch(app, mail({ id: "copy", date: late })), null);
    assert.equal(sentCopyMatch(app, mail({ id: "copy", subject: "Test 8" })), null);
    assert.equal(sentCopyMatch(app, mail({ id: "copy", to: [{ name: "Bea", email: "bea@example.com" }] })), null);
    assert.equal(sentCopyMatch(app, mail({ id: "copy", from: ADA, to: [OWNER] })), null);
    // A message to yourself arrives as inbound mail too. That copy stays in the inbox.
    assert.equal(sentCopyMatch(app, mail({ id: "copy", direction: "inbound" })), null);
    // Another send is never folded in.
    assert.equal(sentCopyMatch(app, mail({ id: "msg_2", clientSendId: "send_other" })), null);
  });

  it("folds each pair into one message that keeps the app id and the real headers", () => {
    const copy = mail({
      id: "4200001",
      messageId: "<real@example.com>",
      html: "<p>Test</p>",
      references: ["<parent@example.com>"],
      inReplyTo: "<parent@example.com>",
    });
    const inbound = mail({ id: "reply", from: ADA, to: [OWNER], subject: "Re: Lunch plan", messageId: "<r@example.com>" });
    const { messages, merged } = dedupeSentCopies([{ ...app, threadHint: "outbox:send_a", delivery: "sent" }, copy, inbound]);
    assert.equal(messages.length, 2);
    assert.equal(merged.get("4200001"), "msg_4200001");
    const one = messages.find((message) => message.id === "msg_4200001");
    assert.ok(one);
    assert.equal(one.messageId, "<real@example.com>");
    assert.equal(one.clientSendId, "send_a");
    assert.equal(one.threadHint, "outbox:send_a");
    assert.equal(one.html, "<p>Test</p>");
    assert.equal(one.direction, "outbound");
    assert.equal(one.delivery, "sent");
    assert.deepEqual(mergeSentCopy(app, copy).references, ["<parent@example.com>"]);
  });

  it("pairs two same-subject sends with their own copies by time", () => {
    const first = mail({ id: "msg_1", messageId: "1", clientSendId: "send_1", date: "2026-10-19T12:48:00.000Z" });
    const second = mail({ id: "msg_2", messageId: "2", clientSendId: "send_2", date: "2026-10-19T12:52:00.000Z" });
    const copyA = mail({ id: "a", messageId: "<a@x>", date: "2026-10-19T12:48:20.000Z" });
    const copyB = mail({ id: "b", messageId: "<b@x>", date: "2026-10-19T12:52:10.000Z" });
    const { messages, merged } = dedupeSentCopies([first, second, copyA, copyB]);
    assert.equal(messages.length, 2);
    assert.equal(merged.get("a"), "msg_1");
    assert.equal(merged.get("b"), "msg_2");
  });

  it("leaves mail alone when there is no app send", () => {
    const list = [mail({ id: "a" }), mail({ id: "b" })];
    assert.equal(dedupeSentCopies(list).messages.length, 2);
  });
});

describe("sent copies in the database", () => {
  it("updates the app's sent row when the inbox copy comes back under another id", { timeout: 60_000 }, async () => {
    const db = await database();
    try {
      await seedSend(db.sql, "send_a");
      assert.equal((await markSent(db.sql, "send_a", "4200001")).status, 200);
      const response = await ingest(db.sql, [inboxCopy("4200001")]);
      assert.equal(response.status, 200);
      const rows = await db.sql.query<{ id: string; client_send_id: string | null; message_id: string | null; direction: string | null; thread_hint: string | null }>(
        `select id, client_send_id, message_id, direction, thread_hint from mail_message`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.id, "msg_4200001");
      assert.equal(rows[0]?.client_send_id, "send_a");
      assert.equal(rows[0]?.message_id, "<4200001@example.com>");
      assert.equal(rows[0]?.direction, "outbound");
      assert.equal(rows[0]?.thread_hint, "outbox:send_a");

      // Posting the same copy again still updates that one row and keeps the send link.
      await ingest(db.sql, [inboxCopy("4200001", { body: "Lunch plan again" })]);
      const again = await db.sql.query<{ id: string; client_send_id: string | null }>(`select id, client_send_id from mail_message`);
      assert.deepEqual(again.map((row) => [row.id, row.client_send_id]), [["msg_4200001", "send_a"]]);
      const { sent } = await sentThreads(db.sql);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]?.messages.length, 1);
    } finally {
      await db.close();
    }
  });

  it("links a send to the inbox copy that arrived first", { timeout: 60_000 }, async () => {
    const db = await database();
    try {
      await seedSend(db.sql, "send_b");
      await ingest(db.sql, [inboxCopy("bot-55", { messageId: "<55@example.com>" })]);
      assert.equal((await markSent(db.sql, "send_b", "55")).status, 200);
      const rows = await db.sql.query<{ id: string; client_send_id: string | null; message_id: string | null; direction: string | null; unread: boolean }>(
        `select id, client_send_id, message_id, direction, unread from mail_message`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.id, "bot-55");
      assert.equal(rows[0]?.client_send_id, "send_b");
      assert.equal(rows[0]?.message_id, "<55@example.com>");
      assert.equal(rows[0]?.direction, "outbound");
      assert.equal(rows[0]?.unread, false);
    } finally {
      await db.close();
    }
  });

  it("matches by from, to, subject, and time when the ids share nothing", { timeout: 60_000 }, async () => {
    const db = await database();
    try {
      await seedSend(db.sql, "send_c");
      assert.equal((await markSent(db.sql, "send_c", "prov-c")).status, 200);
      await ingest(db.sql, [inboxCopy("unrelated-id", { messageId: "<zzz@example.com>" })]);
      const rows = await db.sql.query<{ id: string }>(`select id from mail_message`);
      assert.deepEqual(rows.map((row) => row.id), ["msg_prov-c"]);
      // A different subject is a different email.
      await ingest(db.sql, [inboxCopy("other-mail", { subject: "Lunch?" })]);
      assert.equal((await db.sql.query(`select id from mail_message`)).length, 2);
    } finally {
      await db.close();
    }
  });

  it("shows duplicates stored before this fix once, without changing the rows", { timeout: 60_000 }, async () => {
    const db = await database();
    try {
      await upsertMessage(
        db.sql,
        mail({ id: "msg_4200002", messageId: "4200002", clientSendId: "send_old", direction: "outbound", threadHint: "outbox:send_old", date: "2026-10-19T12:50:20.000Z" }),
        false,
      );
      // Insert the inbox copy directly, the way the old ingest stored it.
      await db.sql.query(
        `insert into mail_message (id, message_id, from_json, to_json, subject, body, date, unread, direction)
         values ('4200002-copy', '<old@example.com>', $1, $2, 'Lunch plan', 'Sounds good', '2026-10-19T12:50:15.000Z', false, 'outbound')`,
        [JSON.stringify(OWNER), JSON.stringify([ADA])],
      );
      assert.equal((await db.sql.query(`select id from mail_message`)).length, 2);
      const { loaded, sent } = await sentThreads(db.sql);
      assert.equal(loaded.messages.length, 1);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]?.messages[0]?.id, "msg_4200002");
      assert.equal(sent[0]?.messages[0]?.messageId, "<old@example.com>");
      assert.equal((await db.sql.query(`select id from mail_message`)).length, 2);
    } finally {
      await db.close();
    }
  });
});
