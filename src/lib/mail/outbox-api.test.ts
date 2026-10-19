import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { SESSION_COOKIE, sessionAllowed, signSession, type GateDeps } from "../site-gate/gate.ts";
import { handleIngestApi, upsertMessage } from "../../server/mail/ingest-api.server.ts";
import { threadsFromMessages } from "../../server/mail/ingest.server.ts";
import { handleOutboxApi, type OutboxApiDeps } from "../../server/mail/outbox-api.server.ts";
import { QUEUED_TOAST, outboxStatusLabel } from "./outbox.ts";
import { emptyMailbox, inFolder, type Message } from "./model.ts";

const TOKEN = "outbox-test-token";
const SECRET = "outbox-session-secret";
const NOW = 1_700_000_000_000;
const WAKE_FAILURE = "Grok Bot did not wake. This reply was not sent.";
const STORED = ["queued", "waiting", "pending", "awaiting_approval", "sent", "declined", "failed", "cancelled"] as const;
const POSTED = ["awaiting_approval", "sent", "declined", "failed", "queued"] as const;

const sqlFiles = ["0002_mail.sql", "0004_mail_ingest.sql", "0005_mail_thread_hint.sql", "0006_mail_direction.sql", "0008_mail_outbound_bridge.sql"];

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
  for (const name of sqlFiles) {
    await pg.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
  }
  return { sql: wrap(pg), close: () => pg.close() };
}

function throwingSql(): { sql: Sql; opened: () => boolean } {
  let hit = false;
  const fail = async () => {
    hit = true;
    throw new Error("database opened");
  };
  const sql = fail as unknown as Sql;
  sql.query = fail;
  return { sql, opened: () => hit };
}

function sessionDeps(): GateDeps {
  return {
    now: () => NOW,
    appPassword: "env-password",
    sessionSecret: SECRET,
    getSecurity: async () => ({ passwordHash: null, sessionVersion: 0 }),
    savePassword: async () => ({ passwordHash: null, sessionVersion: 0 }),
    rateLimit: { isLimited: () => false, recordFailure: () => {}, clear: () => {} },
  };
}

function sessionCookie(): string {
  return `${SESSION_COOKIE}=${signSession({ v: 0, exp: NOW + 60_000 }, SECRET)}`;
}

function call(
  method: string,
  path: string,
  body: unknown,
  token: string | null,
  sql: Sql,
  extra: { cookie?: string; session?: OutboxApiDeps["session"]; env?: { INGEST_TOKEN?: string } } = {},
): Promise<Response> {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (token !== null) headers.set("authorization", token);
  if (extra.cookie) headers.set("cookie", extra.cookie);
  return handleOutboxApi(
    new Request(`https://mail.example${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    {
      env: extra.env ?? { INGEST_TOKEN: TOKEN },
      sql,
      session: extra.session,
    },
  );
}

function allowedMove(from: string, to: string): boolean {
  const queued = from === "queued" || from === "waiting" || from === "pending";
  if (queued && to === "awaiting_approval") return true;
  if (from === "awaiting_approval" && (to === "sent" || to === "declined" || to === "failed" || to === "queued")) return true;
  return false;
}

async function seed(
  sql: Sql,
  row: {
    id: string;
    status: string;
    createdAt: string;
    replyTo?: string | null;
    subject?: string;
    text?: string;
    html?: string | null;
    to?: string[];
    cc?: string[];
  },
): Promise<void> {
  const spec: Record<string, unknown> = {
    from: { name: "You", email: "you@example.com" },
    to: (row.to ?? ["ada@example.com"]).map((email) => ({ name: "Ada", email })),
    cc: (row.cc ?? ["bea@example.com"]).map((email) => ({ name: "Bea", email })),
    bcc: [{ name: "Hidden", email: "hidden-bcc@example.com" }],
    subject: row.subject ?? "Hello",
    body: row.text ?? "Body text",
  };
  if (row.html !== undefined) spec.html = row.html;
  await sql.query(
    `insert into mail_outbound (
       client_send_id, thread_id, spec, status, created_at, updated_at, reply_to_message_id, thread_key
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [row.id, "thr_ui", JSON.stringify(spec), row.status, row.createdAt, row.createdAt, row.replyTo ?? null, "thr_ui"],
  );
}

async function statusOf(sql: Sql, id: string): Promise<string | undefined> {
  const rows = await sql.query<{ status: string }>(`select status from mail_outbound where client_send_id = $1`, [id]);
  return rows[0]?.status;
}

async function messageIds(sql: Sql): Promise<string[]> {
  const rows = await sql.query<{ id: string }>(`select id from mail_message order by id`);
  return rows.map((row) => String(row.id));
}

type StoredMessage = {
  id: string;
  message_id: string | null;
  in_reply_to: string | null;
  references_json: string;
  subject: string;
  body: string;
  date: string | Date;
  from_json: string;
  to_json: string;
  cc_json: string;
  bcc_json: string;
  thread_hint: string | null;
  direction: string | null;
  client_send_id: string | null;
  unread: boolean;
};

async function loadMessages(sql: Sql): Promise<StoredMessage[]> {
  return sql.query<StoredMessage>(
    `select id, message_id, in_reply_to, references_json, subject, body, date, from_json, to_json, cc_json, bcc_json,
            thread_hint, direction, client_send_id, unread
     from mail_message`,
  );
}

async function parentMessage(sql: Sql): Promise<void> {
  await upsertMessage(
    sql,
    {
      id: "msg_parent",
      messageId: "<parent@example.com>",
      inReplyTo: null,
      references: [],
      deliveredTo: null,
      account: "primary",
      from: { name: "Ada", email: "ada@example.com" },
      to: [{ name: "You", email: "you@example.com" }],
      cc: [],
      bcc: [],
      subject: "Parent subject",
      body: "Parent body",
      date: "2026-10-01T00:00:00.000Z",
      attachments: [],
      threadHint: "hint-parent",
      direction: "inbound",
    },
    true,
  );
}

let aliased = false;
function enableAlias(): void {
  if (aliased) return;
  aliased = true;
  register(new URL("../../../scripts/test-alias-hook.mjs", import.meta.url).href, import.meta.url);
}

describe("outbox copy", () => {
  it("uses the queued strings", () => {
    assert.equal(QUEUED_TOAST, "Queued for approval in Grok Bot");
    assert.equal(outboxStatusLabel("queued", null), "Waiting for your OK in Grok Bot");
    assert.equal(outboxStatusLabel("awaiting_approval", "x"), "Waiting for your OK in Grok Bot");
    assert.equal(outboxStatusLabel("sent", null), "Sent");
    assert.equal(outboxStatusLabel("declined", null), "Declined");
    assert.equal(outboxStatusLabel("cancelled", null), "Cancelled");
    assert.equal(outboxStatusLabel("failed", "smtp down"), "Failed: smtp down");
    assert.equal(outboxStatusLabel("failed", null), "Failed: ");
  });
});

describe("outbox api", () => {
  it("rejects a missing token, a wrong token, a cookie, and an unset token without opening the database", async () => {
    const db = throwingSql();
    const cookie = sessionCookie();
    const probe = new Request("https://mail.example/api/outbox?status=queued", { headers: { cookie } });
    assert.equal(await sessionAllowed(probe, sessionDeps()), true);
    const session = (request: Request) => sessionAllowed(request, sessionDeps());

    const missing = await call("GET", "/api/outbox?status=queued", undefined, null, db.sql, { cookie, session });
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: "unauthorized" });

    const wrong = await call("GET", "/api/outbox?status=queued", undefined, "Bearer wrong-token", db.sql, { cookie, session });
    assert.equal(wrong.status, 401);

    const posted = await call("POST", "/api/outbox/send_1/status", { status: "awaiting_approval" }, null, db.sql, { cookie, session });
    assert.equal(posted.status, 401);
    assert.deepEqual(await posted.json(), { error: "unauthorized" });

    const unset = await call("GET", "/api/outbox?status=queued", undefined, `Bearer ${TOKEN}`, db.sql, { env: {} });
    assert.equal(unset.status, 503);
    assert.deepEqual(await unset.json(), { error: "unavailable" });

    const blank = await call("POST", "/api/outbox/send_1/status", { status: "sent" }, `Bearer ${TOKEN}`, db.sql, {
      env: { INGEST_TOKEN: "  " },
    });
    assert.equal(blank.status, 503);

    const cancel = await call("DELETE", "/api/outbox/send_1", undefined, `Bearer ${TOKEN}`, db.sql, { session });
    assert.equal(cancel.status, 401);
    assert.deepEqual(await cancel.json(), { error: "unauthorized" });
    assert.equal(db.opened(), false);
  });

  it("lists waiting rows as queued and omits bcc", async () => {
    const db = await database();
    try {
      await parentMessage(db.sql);
      await seed(db.sql, {
        id: "send_wait",
        status: "waiting",
        createdAt: "2026-10-01T00:00:00.000Z",
        replyTo: "msg_parent",
        subject: "Hello",
        text: "Body text",
        html: null,
      });
      await seed(db.sql, {
        id: "send_html",
        status: "queued",
        createdAt: "2026-10-02T00:00:00.000Z",
        subject: "With html",
        text: "Plain",
        html: "<p>Hi</p>",
        cc: [],
      });
      await seed(db.sql, {
        id: "send_gone",
        status: "pending",
        createdAt: "2026-10-03T00:00:00.000Z",
        replyTo: "msg_gone",
        subject: "Missing parent",
        text: "Still queued",
      });
      await seed(db.sql, { id: "send_sent", status: "sent", createdAt: "2026-09-01T00:00:00.000Z" });

      const response = await call("GET", "/api/outbox?status=queued", undefined, `Bearer ${TOKEN}`, db.sql, {
        cookie: "gb_session=not-a-session",
      });
      assert.equal(response.status, 200);
      const body: unknown = await response.json();
      assert.deepEqual(body, [
        {
          id: "send_wait",
          fromAddress: "you@example.com",
          to: ["ada@example.com"],
          cc: ["bea@example.com"],
          subject: "Hello",
          text: "Body text",
          html: null,
          replyTo: { ingestId: "msg_parent", subject: "Parent subject" },
        },
        {
          id: "send_html",
          fromAddress: "you@example.com",
          to: ["ada@example.com"],
          cc: [],
          subject: "With html",
          text: "Plain",
          html: "<p>Hi</p>",
          replyTo: null,
        },
        {
          id: "send_gone",
          fromAddress: "you@example.com",
          to: ["ada@example.com"],
          cc: ["bea@example.com"],
          subject: "Missing parent",
          text: "Still queued",
          html: null,
          replyTo: { ingestId: "msg_gone", subject: "" },
        },
      ]);
      const serialized = JSON.stringify(body);
      assert.equal(serialized.includes("hidden-bcc@example.com"), false);
      assert.equal(serialized.includes('"bcc"'), false);

      const other = await call("GET", "/api/outbox?status=sent", undefined, `Bearer ${TOKEN}`, db.sql);
      assert.equal(other.status, 400);
      const omitted = await call("GET", "/api/outbox", undefined, `Bearer ${TOKEN}`, db.sql);
      assert.equal(omitted.status, 400);
      const method = await call("POST", "/api/outbox", {}, `Bearer ${TOKEN}`, db.sql);
      assert.equal(method.status, 405);
    } finally {
      await db.close();
    }
  });

  it("allows every legal status move and rejects the rest", { timeout: 120_000 }, async () => {
    const db = await database();
    try {
      let ok = 0;
      let conflict = 0;
      for (const from of STORED) {
        for (const to of POSTED) {
          const id = `send_${from}_${to}`;
          await seed(db.sql, { id, status: from, createdAt: "2026-10-01T00:00:00.000Z" });
          const payload: { status: string; providerMessageId?: string; error?: string } = { status: to };
          if (to === "sent") payload.providerMessageId = `p-${from}-${to}`;
          if (to === "failed") payload.error = "nope";
          const response = await call("POST", `/api/outbox/${id}/status`, payload, `Bearer ${TOKEN}`, db.sql);
          const after = await statusOf(db.sql, id);
          if (allowedMove(from, to)) {
            ok += 1;
            assert.equal(response.status, 200, `${from} -> ${to}`);
            assert.deepEqual(await response.json(), { id, status: to });
            assert.equal(after, to, `${from} -> ${to}`);
          } else {
            conflict += 1;
            assert.equal(response.status, 409, `${from} -> ${to}`);
            assert.deepEqual(await response.json(), { error: "conflict" });
            assert.equal(after, from, `${from} -> ${to}`);
          }
        }
      }
      assert.equal(ok, 7);
      assert.equal(conflict, 33);
      assert.deepEqual(await messageIds(db.sql), ["msg_p-awaiting_approval-sent"]);

      const failed = await db.sql.query<{ error: string | null }>(
        `select error from mail_outbound where client_send_id = $1`,
        ["send_awaiting_approval_failed"],
      );
      assert.equal(failed[0]?.error, "nope");
      const declined = await db.sql.query<{ error: string | null }>(
        `select error from mail_outbound where client_send_id = $1`,
        ["send_awaiting_approval_declined"],
      );
      assert.equal(declined[0]?.error, null);

      await seed(db.sql, { id: "send_hold", status: "awaiting_approval", createdAt: "2026-10-04T00:00:00.000Z" });
      const needsId = await call("POST", "/api/outbox/send_hold/status", { status: "sent" }, `Bearer ${TOKEN}`, db.sql);
      assert.equal(needsId.status, 400);
      assert.equal(await statusOf(db.sql, "send_hold"), "awaiting_approval");

      const missing = await call("POST", "/api/outbox/send_missing/status", { status: "awaiting_approval" }, `Bearer ${TOKEN}`, db.sql);
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), { error: "not found" });

      for (const status of ["cancelled", "approved", "waiting", "pending", ""]) {
        const response = await call("POST", "/api/outbox/send_hold/status", { status }, `Bearer ${TOKEN}`, db.sql);
        assert.equal(response.status, 400, status);
        assert.equal(await statusOf(db.sql, "send_hold"), "awaiting_approval");
      }
      const bad = await call("POST", "/api/outbox/send_hold/status", "{", `Bearer ${TOKEN}`, db.sql);
      assert.equal(bad.status, 400);
      assert.deepEqual(await messageIds(db.sql), ["msg_p-awaiting_approval-sent"]);
    } finally {
      await db.close();
    }
  });

  it("cancels only from queued", async () => {
    const db = await database();
    try {
      const session = async () => true;
      const refused = async () => false;
      for (const status of STORED) {
        const id = `cancel_${status}`;
        await seed(db.sql, { id, status, createdAt: "2026-10-01T00:00:00.000Z" });
        const response = await call("DELETE", `/api/outbox/${id}`, undefined, null, db.sql, { session });
        const queued = status === "queued" || status === "waiting" || status === "pending";
        assert.equal(response.status, queued ? 200 : 409, status);
        assert.equal(await statusOf(db.sql, id), queued ? "cancelled" : status, status);
      }

      const noSession = await call("DELETE", "/api/outbox/cancel_sent", undefined, `Bearer ${TOKEN}`, db.sql, { session: refused });
      assert.equal(noSession.status, 401);
      assert.equal(await statusOf(db.sql, "cancel_sent"), "sent");

      const unknown = await call("DELETE", "/api/outbox/cancel_missing", undefined, null, db.sql, { session });
      assert.equal(unknown.status, 404);
      const hidden = await call("DELETE", "/api/outbox/cancel_missing", undefined, `Bearer ${TOKEN}`, db.sql, { session: refused });
      assert.equal(hidden.status, 401);

      const listed = await call("GET", "/api/outbox?status=queued", undefined, `Bearer ${TOKEN}`, db.sql);
      assert.deepEqual(await listed.json(), []);
    } finally {
      await db.close();
    }
  });

  it("inserts one outbound message and a later ingest updates it", { timeout: 120_000 }, async () => {
    const db = await database();
    try {
      await parentMessage(db.sql);
      await seed(db.sql, {
        id: "send_reply",
        status: "awaiting_approval",
        createdAt: "2026-10-02T00:00:00.000Z",
        replyTo: "msg_parent",
        subject: "Hello",
        text: "Body text",
      });
      const first = await call(
        "POST",
        "/api/outbox/send_reply/status",
        { status: "sent", providerMessageId: "prov-1" },
        `Bearer ${TOKEN}`,
        db.sql,
      );
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), { id: "send_reply", status: "sent" });
      const inserted = await loadMessages(db.sql);
      const created = inserted.find((row) => row.id === "msg_prov-1");
      assert.ok(created);
      assert.equal(created.direction, "outbound");
      assert.equal(created.thread_hint, "hint-parent");
      assert.equal(created.in_reply_to, "<parent@example.com>");
      assert.equal(created.body, "Body text");
      assert.equal(created.client_send_id, "send_reply");
      assert.equal(created.unread, false);
      assert.deepEqual(JSON.parse(created.bcc_json), []);
      assert.equal(JSON.parse(created.from_json).email, "you@example.com");
      const createdAt = created.date instanceof Date ? created.date.toISOString() : String(created.date);
      const age = Date.now() - Date.parse(createdAt);
      assert.ok(age >= -5_000 && age < 120_000, createdAt);

      const again = await call(
        "POST",
        "/api/outbox/send_reply/status",
        { status: "sent", providerMessageId: "prov-1" },
        `Bearer ${TOKEN}`,
        db.sql,
      );
      assert.equal(again.status, 409);
      assert.deepEqual((await messageIds(db.sql)).sort(), ["msg_parent", "msg_prov-1"].sort());

      const ingested = await handleIngestApi(
        new Request("https://mail.example/api/ingest", {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                kind: "message",
                id: "msg_prov-1",
                messageId: "<prov-1@example.com>",
                from: { name: "You", email: "you@example.com" },
                to: [{ name: "Ada", email: "ada@example.com" }],
                subject: "Hello",
                body: "Updated body",
                date: "2026-10-18T12:00:00.000Z",
              },
            ],
          }),
        }),
        { env: { INGEST_TOKEN: TOKEN }, sql: db.sql },
      );
      assert.equal(ingested.status, 200);
      assert.deepEqual((await messageIds(db.sql)).sort(), ["msg_parent", "msg_prov-1"].sort());

      const rows = await loadMessages(db.sql);
      const sent = rows.find((row) => row.id === "msg_prov-1");
      assert.ok(sent);
      assert.equal(sent.direction, "outbound");
      assert.equal(sent.thread_hint, "hint-parent");
      assert.equal(sent.body, "Updated body");
      assert.equal(sent.unread, false);

      const messages: Message[] = rows.map((row) => ({
        id: row.id,
        messageId: row.message_id,
        inReplyTo: row.in_reply_to,
        references: JSON.parse(row.references_json) as string[],
        deliveredTo: null,
        account: "primary",
        from: JSON.parse(row.from_json) as Message["from"],
        to: JSON.parse(row.to_json) as Message["to"],
        cc: JSON.parse(row.cc_json) as Message["cc"],
        bcc: JSON.parse(row.bcc_json) as Message["bcc"],
        subject: row.subject,
        body: row.body,
        date: row.date instanceof Date ? row.date.toISOString() : String(row.date),
        attachments: [],
        threadHint: row.thread_hint,
        direction: row.direction === "outbound" || row.direction === "inbound" ? row.direction : null,
      }));
      const threads = threadsFromMessages(messages, new Map(messages.map((message) => [message.id, false])));
      assert.equal(threads.length, 1);
      assert.deepEqual(
        threads[0]?.messages.map((message) => message.id).sort(),
        ["msg_parent", "msg_prov-1"],
      );
      assert.equal(inFolder(threads[0]!, "sent", Date.parse("2026-10-18T12:00:00.000Z"), new Set()), true);
    } finally {
      await db.close();
    }
  });

  it("starts a new thread when the send is not a reply", async () => {
    const db = await database();
    try {
      await seed(db.sql, { id: "send_fresh", status: "awaiting_approval", createdAt: "2026-10-02T00:00:00.000Z" });
      const response = await call(
        "POST",
        "/api/outbox/send_fresh/status",
        { status: "sent", providerMessageId: "fresh-1" },
        `Bearer ${TOKEN}`,
        db.sql,
      );
      assert.equal(response.status, 200);
      const rows = await db.sql.query<{ id: string; thread_hint: string | null; direction: string | null }>(
        `select id, thread_hint, direction from mail_message`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.id, "msg_fresh-1");
      assert.equal(rows[0]?.thread_hint, "outbox:send_fresh");
      assert.equal(rows[0]?.direction, "outbound");
    } finally {
      await db.close();
    }
  });

  it("updates mail_outbound from an ingest send-result using the same rules", async () => {
    const db = await database();
    try {
      await seed(db.sql, { id: "send_ok", status: "awaiting_approval", createdAt: "2026-10-01T00:00:00.000Z" });
      await seed(db.sql, { id: "send_early", status: "queued", createdAt: "2026-10-01T00:00:01.000Z" });
      await seed(db.sql, { id: "send_bad", status: "awaiting_approval", createdAt: "2026-10-01T00:00:02.000Z" });
      await seed(db.sql, { id: "send_back", status: "awaiting_approval", createdAt: "2026-10-01T00:00:03.000Z" });
      await seed(db.sql, { id: "send_no_id", status: "awaiting_approval", createdAt: "2026-10-01T00:00:04.000Z" });

      async function ingest(items: unknown[]): Promise<Response> {
        return handleIngestApi(
          new Request("https://mail.example/api/ingest", {
            method: "POST",
            headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
            body: JSON.stringify({ items }),
          }),
          { env: { INGEST_TOKEN: TOKEN }, sql: db.sql },
        );
      }

      const sent = await ingest([
        { kind: "send-result", clientSendId: "send_ok", status: "sent", sentMessageId: "prov-sr", error: null },
      ]);
      assert.equal(sent.status, 200);
      assert.equal(await statusOf(db.sql, "send_ok"), "sent");

      const early = await ingest([
        { kind: "send-result", clientSendId: "send_early", status: "approved", sentMessageId: "prov-early", error: null },
      ]);
      assert.equal(early.status, 200);
      assert.equal(await statusOf(db.sql, "send_early"), "queued");

      const failed = await ingest([
        { kind: "send-result", clientSendId: "send_bad", status: "failed", error: "nope" },
      ]);
      assert.equal(failed.status, 200);
      assert.equal(await statusOf(db.sql, "send_bad"), "failed");
      const error = await db.sql.query<{ error: string | null }>(`select error from mail_outbound where client_send_id = $1`, [
        "send_bad",
      ]);
      assert.equal(error[0]?.error, "nope");

      const back = await ingest([{ kind: "send-result", clientSendId: "send_back", status: "waiting" }]);
      assert.equal(back.status, 200);
      assert.equal(await statusOf(db.sql, "send_back"), "queued");

      const noId = await ingest([{ kind: "send-result", clientSendId: "send_no_id", status: "sent", sentMessageId: null }]);
      assert.equal(noId.status, 200);
      assert.equal(await statusOf(db.sql, "send_no_id"), "awaiting_approval");

      assert.deepEqual(await messageIds(db.sql), ["msg_prov-sr"]);
      const direction = await db.sql.query<{ direction: string | null }>(`select direction from mail_message where id = $1`, [
        "msg_prov-sr",
      ]);
      assert.equal(direction[0]?.direction, "outbound");
    } finally {
      await db.close();
    }
  });

  it("does not report a wake failure when the webhook is unset", async () => {
    const previousDatabase = process.env.DATABASE_URL;
    const previousUnpooled = process.env.DATABASE_URL_UNPOOLED;
    const previousStub = process.env.OUTBOX_STUB_DB;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;
    process.env.OUTBOX_STUB_DB = "1";
    try {
      enableAlias();
      const root = await mkdtemp(join(tmpdir(), "mail-unconfigured-"));
      const { sendMailbox } = await import("../../server/mail/store.server.ts");
      const result = await sendMailbox(
        emptyMailbox(),
        {
          from: "you@example.com",
          to: [{ name: "Ada", email: "ada@example.com" }],
          cc: [],
          bcc: [{ name: "Hidden", email: "hidden-bcc@example.com" }],
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
      assert.equal(result.notice, QUEUED_TOAST);
      assert.equal(result.notice.includes("did not wake"), false);
      assert.notEqual(result.notice, WAKE_FAILURE);
      assert.equal(result.delivery, "waiting");
      const signed = "Typed body\n\n--\nYou\nyou@example.test";
      assert.equal(result.data.outbox?.[0]?.text, signed);
      assert.equal(result.data.outbox?.[0]?.status, "queued");
      assert.equal(result.data.threads[0]?.messages[0]?.body, signed);
    } finally {
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousUnpooled === undefined) delete process.env.DATABASE_URL_UNPOOLED;
      else process.env.DATABASE_URL_UNPOOLED = previousUnpooled;
      if (previousStub === undefined) delete process.env.OUTBOX_STUB_DB;
      else process.env.OUTBOX_STUB_DB = previousStub;
    }
  });
});
