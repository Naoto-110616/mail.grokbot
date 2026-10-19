import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { handleIngestApi, loadStoredIngest } from "../../server/mail/ingest-api.server.ts";
import { threadIdFromMessage } from "../../server/mail/ingest.server.ts";
import { visibleThreads, type Alias } from "./model.ts";

const TOKEN = "ingest-test-token";
const migration = readFileSync(new URL("../../../migrations/0004_mail_ingest.sql", import.meta.url), "utf8");
const productMigration = readFileSync(new URL("../../../migrations/0002_mail.sql", import.meta.url), "utf8");
const threadHintMigration = readFileSync(new URL("../../../migrations/0005_mail_thread_hint.sql", import.meta.url), "utf8");
const directionMigration = readFileSync(new URL("../../../migrations/0006_mail_direction.sql", import.meta.url), "utf8");
const outboundBridgeMigration = readFileSync(new URL("../../../migrations/0008_mail_outbound_bridge.sql", import.meta.url), "utf8");
const attachmentContentMigration = readFileSync(new URL("../../../migrations/0009_mail_attachment_content.sql", import.meta.url), "utf8");
const mailboxConfigMigration = readFileSync(new URL("../../../migrations/0010_mail_mailbox_config.sql", import.meta.url), "utf8");
const htmlBodyMigration = readFileSync(new URL("../../../migrations/0011_mail_html_body.sql", import.meta.url), "utf8");

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

async function applyIngestSchema(pg: PGlite): Promise<void> {
  await pg.exec(productMigration);
  await pg.exec(migration);
  await pg.exec(threadHintMigration);
  await pg.exec(directionMigration);
  await pg.exec(outboundBridgeMigration);
  await pg.exec(attachmentContentMigration);
  await pg.exec(mailboxConfigMigration);
  await pg.exec(htmlBodyMigration);
}

async function database(): Promise<{ sql: Sql; close: () => Promise<void> }> {
  const pg = new PGlite();
  await applyIngestSchema(pg);
  return { sql: wrap(pg), close: () => pg.close() };
}

function throwingSql(): Sql {
  const fail = async () => {
    throw new Error("database opened");
  };
  const sql = fail as unknown as Sql;
  sql.query = fail;
  return sql;
}

function call(
  method: string,
  path: string,
  body: unknown,
  token: string | null,
  sql?: Sql,
  env: { INGEST_TOKEN?: string } = { INGEST_TOKEN: TOKEN },
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("authorization", token);
  return handleIngestApi(
    new Request(`https://mail.example${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    { env, sql },
  );
}

const message = {
  kind: "message",
  id: "msg_a",
  messageId: "<a@example.test>",
  inReplyTo: null,
  references: [],
  deliveredTo: "you+ops@example.test",
  account: "primary",
  from: { name: "Ada", email: "ada@example.test" },
  to: [{ name: "You", email: "you+ops@example.test" }],
  cc: [],
  bcc: [],
  subject: "Quarterly notes",
  body: "Notes for the quarter.",
  date: "2026-10-01T15:00:00Z",
  unread: true,
  attachments: [{ id: "att_note", filename: "note.txt", mime: "text/plain", bytes: 11, path: "files/note.txt" }],
};

describe("ingest api", () => {
  it("rejects a missing token, a wrong token, and an unset token without opening the database", async () => {
    const sql = throwingSql();
    const missing = await call("POST", "/api/ingest", { items: [] }, null, sql);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: "unauthorized" });

    const wrong = await call("POST", "/api/ingest", { items: [message] }, "Bearer wrong-token", sql);
    assert.equal(wrong.status, 401);

    const unset = await call("POST", "/api/ingest", { items: [message] }, `Bearer ${TOKEN}`, sql, {});
    assert.equal(unset.status, 503);
    assert.deepEqual(await unset.json(), { error: "unavailable" });

    const blank = await call("POST", "/api/ingest", { items: [message] }, `Bearer ${TOKEN}`, sql, { INGEST_TOKEN: "  " });
    assert.equal(blank.status, 503);

    const state = await call("GET", "/api/ingest/state", undefined, null, sql);
    assert.equal(state.status, 401);
  });

  it("rejects oversized item lists and bodies", async () => {
    const sql = throwingSql();
    const tooMany = await call("POST", "/api/ingest", { items: Array.from({ length: 201 }, () => ({ kind: "thread" })) }, `Bearer ${TOKEN}`, sql);
    assert.equal(tooMany.status, 413);
    assert.deepEqual(await tooMany.json(), { error: "too large" });

    const huge = await call("POST", "/api/ingest", "x".repeat(5 * 1024 * 1024 + 1), `Bearer ${TOKEN}`, sql);
    assert.equal(huge.status, 413);
  });

  it("rejects a declared content-length over 5MB before reading the body", async () => {
    let read = false;
    const request = {
      method: "POST",
      url: "https://mail.example/api/ingest",
      headers: new Headers({
        authorization: `Bearer ${TOKEN}`,
        "content-length": String(5 * 1024 * 1024 + 1),
      }),
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as Request;
    const response = await handleIngestApi(request, { env: { INGEST_TOKEN: TOKEN }, sql: throwingSql() });
    assert.equal(response.status, 413);
    assert.equal(read, false);
  });

  it("upserts messages by id and messageId and reports state", async () => {
    const { sql, close } = await database();
    try {
      const first = await call(
        "POST",
        "/api/ingest",
        {
          items: [
            {
              kind: "account",
              address: "you@example.test",
              displayName: "You",
              aliases: [{ email: "you@example.test", tag: null, name: "You" }],
            },
            { kind: "thread", id: "thr_optional", messageIds: ["<a@example.test>"] },
            message,
            {
              kind: "attachment",
              id: "att_extra",
              messageId: "<a@example.test>",
              filename: "extra.txt",
              mime: "text/plain",
              bytes: 4,
              path: "files/extra.txt",
            },
            { kind: "attachment", id: "att_bad", messageId: "<a@example.test>", filename: "bad.txt", mime: "text/plain", bytes: 1, path: "../secret.txt" },
            { kind: "nope" },
            {
              kind: "send-result",
              clientSendId: "send_1",
              status: "sent",
              replyToMessageId: "<a@example.test>",
              sentMessageId: "<sent-1@example.test>",
              error: null,
            },
          ],
        },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), { accepted: 4, skipped: 3 });

      const again = await call(
        "POST",
        "/api/ingest",
        {
          items: [
            { ...message, id: "msg_other", body: "Updated notes." },
            {
              kind: "send-result",
              clientSendId: "send_1",
              status: "sent",
              replyToMessageId: "<a@example.test>",
              sentMessageId: "<sent-1@example.test>",
              error: null,
            },
          ],
        },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await again.json(), { accepted: 2, skipped: 0 });

      const state = await call("GET", "/api/ingest/state", undefined, `Bearer ${TOKEN}`, sql);
      assert.equal(state.status, 200);
      assert.deepEqual(await state.json(), {
        newest: "2026-10-01T15:00:00Z",
        counts: { messages: 1, attachments: 2, accounts: 1, sendResults: 1 },
      });

      const loaded = await loadStoredIngest(sql);
      assert.equal(loaded.messages.length, 1);
      assert.equal(loaded.messages[0]?.id, "msg_a");
      assert.equal(loaded.messages[0]?.body, "Updated notes.");
      assert.equal(loaded.identity?.address, "you@example.test");
      assert.equal(loaded.threads.length, 1);
      assert.equal(loaded.threads[0]?.plusTag, "ops");
      assert.deepEqual(
        loaded.messages[0]?.attachments.map((file) => file.id).sort(),
        ["att_extra", "att_note"],
      );
    } finally {
      await close();
    }
  });

  it("stores attachment content under the cap and skips bytes it cannot keep", async () => {
    const { sql, close } = await database();
    try {
      const encoded = Buffer.from("ok").toString("base64");
      const posted = await call(
        "POST",
        "/api/ingest",
        {
          items: [
            {
              ...message,
              attachments: [
                {
                  id: "att_ok",
                  filename: "note.txt",
                  mime: "text/plain",
                  bytes: 2,
                  path: "files/note.txt",
                  content: encoded,
                },
              ],
            },
            {
              kind: "attachment",
              id: "att_bad_bytes",
              messageId: "<a@example.test>",
              filename: "skip.txt",
              mime: "text/plain",
              bytes: 4,
              path: "files/skip.txt",
              content: "****",
            },
          ],
        },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.equal(posted.status, 200);
      assert.deepEqual(await posted.json(), { accepted: 2, skipped: 0 });

      const stored = await sql.query<{ id: string; content_b64: string | null }>(
        `select id, content_b64 from mail_attachment order by id`,
      );
      const ok = stored.find((row) => row.id === "att_ok");
      const bad = stored.find((row) => row.id === "att_bad_bytes");
      assert.equal(ok?.content_b64, encoded);
      assert.equal(Buffer.from(ok?.content_b64 ?? "", "base64").length, 2);
      assert.equal(bad?.content_b64, null);

      const jsonRows = await sql.query<{ attachments_json: string }>(
        `select attachments_json from mail_message where id = $1`,
        ["msg_a"],
      );
      const rawJson = jsonRows[0]?.attachments_json ?? "";
      assert.equal(rawJson.includes(encoded), false);
      assert.equal(rawJson.includes('"content"'), false);

      const loaded = await loadStoredIngest(sql);
      const file = loaded.messages[0]?.attachments.find((item) => item.id === "att_ok");
      assert.ok(file);
      assert.equal(Object.hasOwn(file, "content"), false);

      const again = await call(
        "POST",
        "/api/ingest",
        {
          items: [
            {
              ...message,
              attachments: [
                { id: "att_ok", filename: "note.txt", mime: "text/plain", bytes: 2, path: "files/note.txt" },
              ],
            },
          ],
        },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.equal(again.status, 200);
      const kept = await sql.query<{ content_b64: string | null }>(
        `select content_b64 from mail_attachment where id = $1 and message_ref = $2`,
        ["att_ok", "msg_a"],
      );
      assert.equal(kept[0]?.content_b64, encoded);
    } finally {
      await close();
    }
  });

  it("keeps read state and thread folder fields when the same message is posted again", async () => {
    const pg = new PGlite();
    await pg.exec(productMigration);
    await applyIngestSchema(pg);
    const sql = wrap(pg);
    try {
      const first = await call("POST", "/api/ingest", { items: [message] }, `Bearer ${TOKEN}`, sql);
      assert.deepEqual(await first.json(), { accepted: 1, skipped: 0 });

      await sql.query(`update mail_message set unread = false where id = $1`, ["msg_a"]);
      const threadId = threadIdFromMessage({ id: "msg_a", messageId: "<a@example.test>" });
      const snoozeUntil = "2026-11-01T00:00:00Z";
      await sql.query(
        `insert into mail_thread_state (
           thread_id, location, labels_json, starred, important, unread, muted, snooze_until, category
         ) values ($1, 'trash', '["lab_1"]', true, false, false, false, $2, 'primary')`,
        [threadId, snoozeUntil],
      );

      const again = await call(
        "POST",
        "/api/ingest",
        { items: [{ ...message, unread: true, body: "Updated notes.", subject: "Changed subject" }] },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await again.json(), { accepted: 1, skipped: 0 });

      const rows = await sql.query<{ unread: boolean; body: string; subject: string }>(
        `select unread, body, subject from mail_message where id = $1`,
        ["msg_a"],
      );
      assert.equal(rows[0]?.unread, false);
      assert.equal(rows[0]?.body, "Updated notes.");
      assert.equal(rows[0]?.subject, "Changed subject");

      const state = await sql.query<{
        location: string;
        labels_json: string;
        starred: boolean;
        unread: boolean;
        snooze_until: string | null;
      }>(`select location, labels_json, starred, unread, snooze_until from mail_thread_state where thread_id = $1`, [threadId]);
      assert.equal(state.length, 1);
      assert.equal(state[0]?.location, "trash");
      assert.equal(state[0]?.labels_json, '["lab_1"]');
      assert.equal(state[0]?.starred, true);
      assert.equal(state[0]?.unread, false);
      assert.equal(state[0]?.snooze_until, snoozeUntil);

      const created = await call(
        "POST",
        "/api/ingest",
        { items: [{ ...message, id: "msg_new", messageId: "<new@example.test>", unread: false, body: "Fresh." }] },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await created.json(), { accepted: 1, skipped: 0 });
      const fresh = await sql.query<{ unread: boolean }>(`select unread from mail_message where id = $1`, ["msg_new"]);
      assert.equal(fresh[0]?.unread, false);

      const loaded = await loadStoredIngest(sql);
      assert.equal(loaded.messages.find((item) => item.id === "msg_a")?.body, "Updated notes.");
      assert.equal(loaded.threads.find((thread) => thread.messages.some((item) => item.id === "msg_a"))?.unread, false);
    } finally {
      await pg.close();
    }
  });

  it("stores threadHint and groups those messages ahead of headers", async () => {
    const { sql, close } = await database();
    try {
      const posted = await call(
        "POST",
        "/api/ingest",
        {
          items: [
            { ...message, threadHint: "  batch-1  ", subject: "Alpha" },
            {
              ...message,
              id: "msg_b",
              messageId: "<b@example.test>",
              threadHint: "batch-1",
              subject: "Beta",
              date: "2026-10-02T00:00:00Z",
              attachments: [],
            },
            {
              ...message,
              id: "msg_c",
              messageId: "<c@example.test>",
              threadHint: "batch-2",
              inReplyTo: "<a@example.test>",
              references: ["<a@example.test>"],
              subject: "Re: Alpha",
              date: "2026-10-03T00:00:00Z",
              attachments: [],
            },
          ],
        },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await posted.json(), { accepted: 3, skipped: 0 });
      const hints = await sql.query<{ id: string; thread_hint: string | null }>(
        `select id, thread_hint from mail_message order by id`,
      );
      assert.deepEqual(
        hints.map((row) => [row.id, row.thread_hint]),
        [
          ["msg_a", "batch-1"],
          ["msg_b", "batch-1"],
          ["msg_c", "batch-2"],
        ],
      );
      const loaded = await loadStoredIngest(sql);
      const hinted = loaded.threads.find((thread) => thread.messages.some((item) => item.id === "msg_a"));
      assert.deepEqual(
        hinted?.messages.map((item) => item.id),
        ["msg_a", "msg_b"],
      );
      assert.equal(loaded.threads.some((thread) => thread.messages.some((item) => item.id === "msg_c") && thread.messages.length === 1), true);
    } finally {
      await close();
    }
  });

  it("stores outbound direction and html_body", async () => {
    const { sql, close } = await database();
    try {
      const html = "<script>alert(1)</script><p>Hi</p>";
      const posted = await call(
        "POST",
        "/api/ingest",
        {
          items: [
            { ...message, id: "msg_out", messageId: "<out@example.test>", direction: "Outbound", html },
            { ...message, id: "msg_in", messageId: "<in@example.test>", direction: "sideways", attachments: [] },
          ],
        },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await posted.json(), { accepted: 2, skipped: 0 });
      const rows = await sql.query<{ id: string; direction: string | null; html_body: string | null }>(
        `select id, direction, html_body from mail_message order by id`,
      );
      assert.deepEqual(
        rows.map((row) => [row.id, row.direction, row.html_body]),
        [
          ["msg_in", null, null],
          ["msg_out", "outbound", html],
        ],
      );
      const htmlColumn = await sql.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'mail_message' and column_name = 'html_body'`,
      );
      assert.equal(htmlColumn.length, 1);
      const loaded = await loadStoredIngest(sql);
      const outbound = loaded.messages.find((item) => item.id === "msg_out");
      assert.equal(outbound?.direction, "outbound");
      assert.equal(outbound?.from.email, "ada@example.test");
      assert.equal(outbound?.html, html);
      assert.equal(loaded.messages.find((item) => item.id === "msg_in")?.html ?? null, null);
    } finally {
      await close();
    }
  });

  it("updates html in place and keeps unread, star, and folder", async () => {
    const { sql, close } = await database();
    const first = "<p>First harbor note</p>";
    const second = "<p>Second harbor note</p>";
    try {
      const inserted = await call(
        "POST",
        "/api/ingest",
        { items: [{ ...message, html: first, attachments: [] }] },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await inserted.json(), { accepted: 1, skipped: 0 });
      await sql.query(`update mail_message set unread = false where id = $1`, ["msg_a"]);
      const threadId = threadIdFromMessage({ id: "msg_a", messageId: "<a@example.test>" });
      await sql.query(
        `insert into mail_thread_state (
           thread_id, location, labels_json, starred, important, unread, muted, snooze_until, category
         ) values ($1, 'inbox', '["ops"]', true, false, false, false, '2026-11-01T00:00:00Z', 'primary')`,
        [threadId],
      );

      const replaced = await call(
        "POST",
        "/api/ingest",
        { items: [{ ...message, html: second, unread: true, body: "Updated plain", attachments: [] }] },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await replaced.json(), { accepted: 1, skipped: 0 });
      const kept = await call(
        "POST",
        "/api/ingest",
        { items: [{ ...message, body: "Plain only", attachments: [] }] },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await kept.json(), { accepted: 1, skipped: 0 });

      const rows = await sql.query<{ unread: boolean; body: string; html_body: string | null }>(
        `select unread, body, html_body from mail_message where id = $1`,
        ["msg_a"],
      );
      assert.equal(rows[0]?.unread, false);
      assert.equal(rows[0]?.body, "Plain only");
      assert.equal(rows[0]?.html_body, second);
      const state = await sql.query<{ location: string; starred: boolean; labels_json: string; snooze_until: string | null }>(
        `select location, starred, labels_json, snooze_until from mail_thread_state where thread_id = $1`,
        [threadId],
      );
      assert.equal(state[0]?.location, "inbox");
      assert.equal(state[0]?.starred, true);
      assert.equal(state[0]?.labels_json, '["ops"]');
      assert.equal(state[0]?.snooze_until, "2026-11-01T00:00:00Z");

      const oversized = "h".repeat(1_048_576 + 1);
      const tooBig = await call(
        "POST",
        "/api/ingest",
        { items: [{ ...message, html: oversized, body: "Still plain", attachments: [] }] },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await tooBig.json(), { accepted: 1, skipped: 0 });
      const afterCap = await sql.query<{ body: string; html_body: string | null }>(
        `select body, html_body from mail_message where id = $1`,
        ["msg_a"],
      );
      assert.equal(afterCap[0]?.body, "Still plain");
      assert.equal(afterCap[0]?.html_body, second);
    } finally {
      await close();
    }
  });

  it("returns an empty state and rejects bad json, the wrong method, and other paths", async () => {
    const { sql, close } = await database();
    try {
      const state = await call("GET", "/api/ingest/state", undefined, `Bearer ${TOKEN}`, sql);
      assert.deepEqual(await state.json(), {
        newest: null,
        counts: { messages: 0, attachments: 0, accounts: 0, sendResults: 0 },
      });
      const bad = await call("POST", "/api/ingest", "{", `Bearer ${TOKEN}`, sql);
      assert.equal(bad.status, 400);
      const shape = await call("POST", "/api/ingest", { mail: [] }, `Bearer ${TOKEN}`, sql);
      assert.equal(shape.status, 400);
      const method = await call("PUT", "/api/ingest", { items: [] }, `Bearer ${TOKEN}`, sql);
      assert.equal(method.status, 405);
      const missing = await call("GET", "/api/ingest/other", undefined, `Bearer ${TOKEN}`, sql);
      assert.equal(missing.status, 404);
      const gated = await call("POST", "/api/other", { items: [] }, `Bearer ${TOKEN}`, sql);
      assert.equal(gated.status, 404);
    } finally {
      await close();
    }
  });

  it("lists legacy rows with no threadHint and no direction as inbox threads", async () => {
    const pg = new PGlite();
    await applyIngestSchema(pg);
    const sql = wrap(pg);
    const you = { name: "You", email: "you@example.test" };
    const ada = { name: "Ada", email: "ada@example.test" };
    const insert = (
      id: string,
      messageId: string,
      from: { name: string; email: string },
      subject: string,
      date: string,
      inReplyTo: string | null,
      references: string[],
    ) =>
      sql.query(
        `insert into mail_message (
           id, message_id, in_reply_to, references_json, delivered_to, account,
           from_json, to_json, cc_json, bcc_json, subject, body, date, unread,
           attachments_json, client_send_id, thread_hint, direction
         ) values (
           $1, $2, $3, $4, null, 'primary',
           $5, $6, '[]', '[]', $7, 'Legacy body', $8, true,
           '[]', null, null, null
         )`,
        [id, messageId, inReplyTo, JSON.stringify(references), JSON.stringify(from), JSON.stringify([you]), subject, date],
      );
    try {
      await sql.query(
        `insert into mail_account (id, address, display_name, aliases_json, updated_at)
         values ('singleton', 'you@example.test', 'You', $1, '2026-10-01T00:00:00Z')`,
        [JSON.stringify([{ email: you.email, tag: null, name: "You" }])],
      );
      await insert("msg_legacy", "<legacy@example.test>", ada, "Quarterly notes", "2026-10-01T00:00:00Z", null, []);
      await insert("msg_reply", "<reply@example.test>", ada, "A different subject", "2026-10-02T00:00:00Z", "<legacy@example.test>", ["<legacy@example.test>"]);
      await insert("msg_subject", "<subject@example.test>", ada, "Re: Quarterly notes", "2026-10-03T00:00:00Z", null, []);
      await insert("msg_mine", "<mine@example.test>", you, "Notes I sent", "2026-10-04T00:00:00Z", null, []);

      const stored = await sql.query<{ id: string; thread_hint: string | null; direction: string | null }>(
        `select id, thread_hint, direction from mail_message order by id`,
      );
      assert.deepEqual(
        stored.map((row) => [row.id, row.thread_hint, row.direction]),
        [
          ["msg_legacy", null, null],
          ["msg_mine", null, null],
          ["msg_reply", null, null],
          ["msg_subject", null, null],
        ],
      );

      const loaded = await loadStoredIngest(sql);
      assert.equal(loaded.messages.find((item) => item.id === "msg_legacy")?.direction, null);
      assert.equal(loaded.messages.find((item) => item.id === "msg_legacy")?.threadHint, null);
      const aliases: Alias[] = [{ email: you.email, tag: null, name: "You" }];
      const now = Date.parse("2026-10-06T00:00:00Z");
      const inbox = visibleThreads({
        threads: loaded.threads,
        folder: "inbox",
        category: "primary",
        query: "",
        now,
        aliases,
        labels: [],
        account: "grokbot",
      });
      assert.equal(inbox.length, 1);
      assert.deepEqual(
        inbox[0]?.messages.map((item) => item.id),
        ["msg_legacy", "msg_reply", "msg_subject"],
      );
      assert.equal(inbox[0]?.location, "inbox");
      const sent = visibleThreads({
        threads: loaded.threads,
        folder: "sent",
        category: "primary",
        query: "",
        now,
        aliases,
        labels: [],
        account: "grokbot",
      });
      assert.deepEqual(
        sent.filter((thread) => thread.messages.some((item) => item.id === "msg_mine")).map((thread) => thread.messages.map((item) => item.id)),
        [["msg_mine"]],
      );
      assert.equal(inbox.some((thread) => thread.messages.some((item) => item.id === "msg_mine")), false);
    } finally {
      await pg.close();
    }
  });

  it("keeps a message in the inbox when it is ingested again", async () => {
    const pg = new PGlite();
    await pg.exec(productMigration);
    await applyIngestSchema(pg);
    const sql = wrap(pg);
    const kept = {
      ...message,
      id: "msg_keep",
      messageId: "<keep@example.test>",
      from: { name: "You", email: "you@example.test" },
      to: [{ name: "Ada", email: "ada@example.test" }],
      subject: "Keep this in the inbox",
      body: "Original.",
      direction: "inbound",
      threadHint: "batch-keep",
      attachments: [],
    };
    try {
      await sql.query(
        `insert into mail_account (id, address, display_name, aliases_json, updated_at)
         values ('singleton', 'you@example.test', 'You', '[]', '2026-10-01T00:00:00Z')`,
      );
      const first = await call("POST", "/api/ingest", { items: [kept] }, `Bearer ${TOKEN}`, sql);
      assert.deepEqual(await first.json(), { accepted: 1, skipped: 0 });
      await sql.query(`update mail_message set unread = false where id = $1`, ["msg_keep"]);
      const threadId = threadIdFromMessage({ id: "msg_keep", messageId: "<keep@example.test>" });
      await sql.query(
        `insert into mail_thread_state (
           thread_id, location, labels_json, starred, important, unread, muted, snooze_until, category
         ) values ($1, 'inbox', '[]', true, false, false, false, null, 'primary')`,
        [threadId],
      );

      const again = await call(
        "POST",
        "/api/ingest",
        { items: [{ ...kept, unread: true, body: "Posted again.", threadHint: undefined, direction: undefined }] },
        `Bearer ${TOKEN}`,
        sql,
      );
      assert.deepEqual(await again.json(), { accepted: 1, skipped: 0 });

      const rows = await sql.query<{ unread: boolean; body: string; thread_hint: string | null; direction: string | null }>(
        `select unread, body, thread_hint, direction from mail_message where id = $1`,
        ["msg_keep"],
      );
      assert.equal(rows[0]?.unread, false);
      assert.equal(rows[0]?.body, "Posted again.");
      assert.equal(rows[0]?.thread_hint, "batch-keep");
      assert.equal(rows[0]?.direction, "inbound");
      const state = await sql.query<{ location: string; starred: boolean }>(
        `select location, starred from mail_thread_state where thread_id = $1`,
        [threadId],
      );
      assert.equal(state[0]?.location, "inbox");
      assert.equal(state[0]?.starred, true);

      const loaded = await loadStoredIngest(sql);
      const thread = loaded.threads.find((item) => item.messages.some((message) => message.id === "msg_keep"));
      assert.equal(thread?.location, "inbox");
      assert.equal(thread?.id, threadId);
      assert.equal(thread?.messages[0]?.direction, "inbound");
      const aliases: Alias[] = [{ email: "you@example.test", tag: null, name: "You" }];
      const inbox = visibleThreads({
        threads: loaded.threads,
        folder: "inbox",
        category: "primary",
        query: "",
        now: Date.parse("2026-10-06T00:00:00Z"),
        aliases,
        labels: [],
        account: "grokbot",
      });
      assert.equal(inbox.some((item) => item.id === threadId), true);
    } finally {
      await pg.close();
    }
  });
});
