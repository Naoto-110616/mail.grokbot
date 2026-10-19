import { createHash, timingSafeEqual } from "node:crypto";
import type { Sql } from "../../lib/db.ts";
import type { Address, Alias, Attachment, Message } from "../../lib/mail/model.ts";
import { normalizePath } from "../../lib/site-gate/paths.ts";
import {
  applySendResults,
  attachmentPathUnsafe,
  classifyIngestItem,
  mergeLooseAttachment,
  threadsFromMessages,
  type ClassifiedIngest,
  type IngestIdentity,
  type IngestLoad,
  type SendResult,
} from "./ingest.server.ts";

export const INGEST_MAX_ITEMS = 200;
export const INGEST_MAX_BYTES = 5 * 1024 * 1024;

const ACCOUNT_ID = "singleton";

export type IngestApiDeps = {
  /** When set, this object is the only token source. A blank value rejects every call. */
  env?: { INGEST_TOKEN?: string };
  sql?: Sql;
};

type StoredItem = Exclude<ClassifiedIngest, { ok: false } | { kind: "thread" }>;

function json(status: number, body: unknown, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function ingestToken(deps: IngestApiDeps): string | undefined {
  const raw = deps.env ? deps.env.INGEST_TOKEN : process.env.INGEST_TOKEN;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Compare the bearer value to the configured token. Length is not leaked. */
export function ingestTokenMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

function providedBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return "";
  return header.slice(prefix.length);
}

function authorize(request: Request, deps: IngestApiDeps): Response | null {
  const expected = ingestToken(deps);
  if (!expected) return json(503, { error: "unavailable" });
  if (!ingestTokenMatches(providedBearer(request), expected)) return json(401, { error: "unauthorized" });
  return null;
}

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function textOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

/** Open the app database only after auth. Tests inject `deps.sql` and never reach this. */
async function openDatabase(): Promise<Sql> {
  const { getSql } = await import("../../lib/db.ts");
  return getSql();
}

async function database(deps: IngestApiDeps): Promise<Sql> {
  return deps.sql ?? openDatabase();
}

async function upsertAccount(sql: Sql, identity: IngestIdentity, updatedAt: string): Promise<void> {
  await sql.query(
    `insert into mail_account (id, address, display_name, aliases_json, updated_at)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set
       address = excluded.address,
       display_name = excluded.display_name,
       aliases_json = excluded.aliases_json,
       updated_at = excluded.updated_at`,
    [ACCOUNT_ID, identity.address, identity.displayName, JSON.stringify(identity.aliases), updatedAt],
  );
}

async function writeAttachments(sql: Sql, messageRef: string, attachments: Attachment[]): Promise<void> {
  await sql.query(`delete from mail_attachment where message_ref = $1`, [messageRef]);
  for (const file of attachments) {
    if (attachmentPathUnsafe(file.path)) continue;
    const bytes = Number.isFinite(file.bytes) ? Math.max(0, Math.trunc(file.bytes)) : 0;
    await sql.query(
      `insert into mail_attachment (id, message_ref, filename, mime, bytes, path)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id, message_ref) do update set
         filename = excluded.filename,
         mime = excluded.mime,
         bytes = excluded.bytes,
         path = excluded.path`,
      [file.id, messageRef, file.filename, file.mime, bytes, file.path],
    );
  }
}

export async function upsertMessage(sql: Sql, message: Message, unread: boolean): Promise<void> {
  const messageId = textOrNull(message.messageId);
  const id = message.id;
  const matches = await sql.query<{ id: string }>(
    `select id from mail_message where id = $1 or ($2::text is not null and message_id = $2)`,
    [id, messageId],
  );
  const ids = matches.map((row) => String(row.id));
  const keep = ids.includes(id) ? id : (ids[0] ?? null);
  const safeAttachments = message.attachments.filter((file) => !attachmentPathUnsafe(file.path));
  const content = [
    messageId,
    textOrNull(message.inReplyTo),
    JSON.stringify(message.references),
    textOrNull(message.deliveredTo),
    message.account || "primary",
    JSON.stringify(message.from),
    JSON.stringify(message.to),
    JSON.stringify(message.cc),
    JSON.stringify(message.bcc),
    message.subject,
    message.body,
    message.date || new Date(0).toISOString(),
  ];
  const tail = [
    JSON.stringify(safeAttachments),
    textOrNull(message.clientSendId),
    textOrNull(message.threadHint),
    message.direction ?? null,
  ];
  if (keep) {
    for (const extra of ids) {
      if (extra === keep) continue;
      await sql.query(
        `delete from mail_attachment where message_ref = $2 and id in (select id from mail_attachment where message_ref = $1)`,
        [keep, extra],
      );
      await sql.query(`update mail_attachment set message_ref = $1 where message_ref = $2`, [keep, extra]);
      await sql.query(`delete from mail_message where id = $1`, [extra]);
    }
    // Content updates. A missing threadHint or direction keeps the stored value.
    // unread stays as the row already has it. Star, snooze, labels, folder, and
    // trash live on mail_thread_state and are not written here.
    await sql.query(
      `update mail_message set
         message_id = $2,
         in_reply_to = $3,
         references_json = $4,
         delivered_to = $5,
         account = $6,
         from_json = $7,
         to_json = $8,
         cc_json = $9,
         bcc_json = $10,
         subject = $11,
         body = $12,
         date = $13,
         attachments_json = $14,
         client_send_id = $15,
         thread_hint = coalesce($16, thread_hint),
         direction = coalesce($17, direction)
       where id = $1`,
      [keep, ...content, ...tail],
    );
    await writeAttachments(sql, keep, safeAttachments);
    return;
  }
  await sql.query(
    `insert into mail_message (
       id, message_id, in_reply_to, references_json, delivered_to, account,
       from_json, to_json, cc_json, bcc_json, subject, body, date, unread,
       attachments_json, client_send_id, thread_hint, direction
     ) values (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18
     )`,
    [id, ...content, unread, ...tail],
  );
  await writeAttachments(sql, id, safeAttachments);
}

async function upsertSendResult(sql: Sql, result: SendResult): Promise<void> {
  await sql.query(
    `insert into mail_send_result (client_send_id, status, reply_to_message_id, sent_message_id, error)
     values ($1, $2, $3, $4, $5)
     on conflict (client_send_id) do update set
       status = excluded.status,
       reply_to_message_id = excluded.reply_to_message_id,
       sent_message_id = excluded.sent_message_id,
       error = excluded.error`,
    [
      result.clientSendId,
      result.status,
      result.replyToMessageId,
      result.sentMessageId,
      result.error,
    ],
  );
}

async function applyItems(sql: Sql, items: StoredItem[]): Promise<{ accepted: number; skipped: number }> {
  let accepted = 0;
  const updatedAt = new Date().toISOString();
  await sql.query("begin");
  try {
    for (const item of items) {
      if (item.kind === "account") await upsertAccount(sql, item.identity, updatedAt);
      else if (item.kind === "message") await upsertMessage(sql, item.message, item.unread);
      else if (item.kind === "attachment") {
        const bytes = Number.isFinite(item.attachment.bytes) ? Math.max(0, Math.trunc(item.attachment.bytes)) : 0;
        const messageRef = item.messageId ?? "";
        await sql.query(
          `insert into mail_attachment (id, message_ref, filename, mime, bytes, path)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (id, message_ref) do update set
             filename = excluded.filename,
             mime = excluded.mime,
             bytes = excluded.bytes,
             path = excluded.path`,
          [item.attachment.id, messageRef, item.attachment.filename, item.attachment.mime, bytes, item.attachment.path],
        );
      } else {
        await upsertSendResult(sql, item.result);
        const { applySendResultToOutbound } = await import("./outbox-api.server.ts");
        await applySendResultToOutbound(sql, item.result);
      }
      accepted += 1;
    }
    await sql.query("commit");
  } catch (err) {
    try {
      await sql.query("rollback");
    } catch {
      // The failed transaction is already unusable.
    }
    throw err;
  }
  return { accepted, skipped: 0 };
}

async function readState(sql: Sql): Promise<{ newest: string | null; counts: { messages: number; attachments: number; accounts: number; sendResults: number } }> {
  const counts = await sql.query<{
    messages: unknown;
    attachments: unknown;
    accounts: unknown;
    send_results: unknown;
  }>(
    `select
       (select count(*) from mail_message) as messages,
       (select count(*) from mail_attachment) as attachments,
       (select count(*) from mail_account) as accounts,
       (select count(*) from mail_send_result) as send_results`,
  );
  const row = counts[0];
  const dates = await sql.query<{ date: unknown }>(`select date from mail_message`);
  let newest: string | null = null;
  let best = Number.NEGATIVE_INFINITY;
  for (const item of dates) {
    const raw = typeof item.date === "string" ? item.date : item.date instanceof Date ? item.date.toISOString() : "";
    const ms = Date.parse(raw);
    if (!raw || Number.isNaN(ms) || ms < best) continue;
    best = ms;
    newest = raw;
  }
  return {
    newest,
    counts: {
      messages: asCount(row?.messages),
      attachments: asCount(row?.attachments),
      accounts: asCount(row?.accounts),
      sendResults: asCount(row?.send_results),
    },
  };
}

function addressOf(value: unknown): Address | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Address>;
  if (typeof row.email !== "string" || !row.email.includes("@")) return null;
  return { name: typeof row.name === "string" && row.name ? row.name : row.email.split("@")[0] || row.email, email: row.email };
}

function addressList(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  return value.map(addressOf).filter((item): item is Address => item !== null);
}

/** Messages, loose attachment metadata, and send results currently stored. */
export async function loadStoredIngest(sql?: Sql): Promise<IngestLoad> {
  const db = sql ?? (await openDatabase());
  const accounts = await db.query<{ address: string; display_name: string; aliases_json: string }>(
    `select address, display_name, aliases_json from mail_account where id = $1`,
    [ACCOUNT_ID],
  );
  let identity: IngestIdentity | null = null;
  const account = accounts[0];
  if (account?.address?.includes("@")) {
    const aliases = readJson<Alias[]>(account.aliases_json) ?? [];
    identity = {
      address: account.address,
      displayName: account.display_name || account.address.split("@")[0] || "You",
      aliases: Array.isArray(aliases) ? aliases.filter((alias) => alias && typeof alias.email === "string" && alias.email.includes("@")) : [],
    };
  }
  const rows = await db.query<{
    id: string;
    message_id: string | null;
    in_reply_to: string | null;
    references_json: string;
    delivered_to: string | null;
    account: string;
    from_json: string;
    to_json: string;
    cc_json: string;
    bcc_json: string;
    subject: string;
    body: string;
    date: string;
    unread: unknown;
    attachments_json: string;
    client_send_id: string | null;
    thread_hint: string | null;
    direction: string | null;
  }>(
    `select id, message_id, in_reply_to, references_json, delivered_to, account, from_json, to_json, cc_json, bcc_json,
            subject, body, date, unread, attachments_json, client_send_id, thread_hint, direction
     from mail_message`,
  );
  const messages: Message[] = [];
  const unread = new Map<string, boolean>();
  for (const row of rows) {
    const from = addressOf(readJson<unknown>(row.from_json));
    if (!from) continue;
    const attachments = readJson<Attachment[]>(row.attachments_json) ?? [];
    const message: Message = {
      id: row.id,
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      references: readJson<string[]>(row.references_json)?.filter((item) => typeof item === "string") ?? [],
      deliveredTo: row.delivered_to,
      account: row.account || "primary",
      from,
      to: addressList(readJson<unknown>(row.to_json)),
      cc: addressList(readJson<unknown>(row.cc_json)),
      bcc: addressList(readJson<unknown>(row.bcc_json)),
      subject: row.subject ?? "",
      body: row.body ?? "",
      date: typeof row.date === "string" ? row.date : new Date(0).toISOString(),
      attachments: Array.isArray(attachments)
        ? attachments.filter((file) => file && typeof file.filename === "string" && !attachmentPathUnsafe(file.path ?? ""))
        : [],
      delivery: null,
      clientSendId: row.client_send_id,
      threadHint: row.thread_hint,
      direction: row.direction === "outbound" || row.direction === "inbound" ? row.direction : null,
    };
    messages.push(message);
    unread.set(message.id, boolValue(row.unread));
  }
  const loose = await db.query<{
    id: string;
    message_ref: string;
    filename: string;
    mime: string;
    bytes: unknown;
    path: string;
  }>(`select id, message_ref, filename, mime, bytes, path from mail_attachment`);
  for (const file of loose) {
    if (attachmentPathUnsafe(file.path ?? "")) continue;
    mergeLooseAttachment(
      messages,
      {
        id: file.id,
        filename: file.filename,
        mime: file.mime || "application/octet-stream",
        bytes: asCount(file.bytes),
        path: file.path ?? "",
      },
      file.message_ref || null,
    );
  }
  const results = await db.query<{
    client_send_id: string;
    status: string;
    reply_to_message_id: string | null;
    sent_message_id: string | null;
    error: string | null;
  }>(`select client_send_id, status, reply_to_message_id, sent_message_id, error from mail_send_result`);
  const sendResults: SendResult[] = results.map((row) => ({
    clientSendId: row.client_send_id,
    status: row.status,
    replyToMessageId: row.reply_to_message_id,
    sentMessageId: row.sent_message_id,
    error: row.error,
  }));
  const withResults = applySendResults(messages, sendResults);
  return {
    identity,
    messages: withResults,
    sendResults,
    threads: threadsFromMessages(withResults, unread, identity?.address),
  };
}

/**
 * Bearer ingest API. The cookie gate does not cover these paths.
 * Bodies and the token are never logged.
 */
export async function handleIngestApi(request: Request, deps: IngestApiDeps = {}): Promise<Response> {
  const path = normalizePath(new URL(request.url).pathname);
  const method = request.method.toUpperCase();
  const denied = authorize(request, deps);
  if (denied) return denied;
  if (path !== "/api/ingest" && path !== "/api/ingest/state") return json(404, { error: "not found" });

  if (path === "/api/ingest/state") {
    if (method !== "GET") return json(405, { error: "method" }, { allow: "GET" });
    try {
      return json(200, await readState(await database(deps)));
    } catch (err) {
      console.error("[ingest] state failed", err instanceof Error ? err.name : "error");
      return json(503, { error: "unavailable" });
    }
  }

  if (method !== "POST") return json(405, { error: "method" }, { allow: "POST" });

  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > INGEST_MAX_BYTES) return json(413, { error: "too large" });

  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch (err) {
    console.error("[ingest] read failed", err instanceof Error ? err.name : "error");
    return json(400, { error: "invalid" });
  }
  if (bytes.byteLength > INGEST_MAX_BYTES) return json(413, { error: "too large" });

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return json(400, { error: "invalid" });
  }
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as { items?: unknown }) : null;
  if (!record || !Array.isArray(record.items)) return json(400, { error: "invalid" });
  if (record.items.length > INGEST_MAX_ITEMS) return json(413, { error: "too large" });

  let skipped = 0;
  const pending: StoredItem[] = [];
  for (const item of record.items) {
    const classified = classifyIngestItem(item);
    if (!classified.ok || classified.kind === "thread") {
      skipped += 1;
      continue;
    }
    if (classified.kind === "attachment" && attachmentPathUnsafe(classified.attachment.path)) {
      skipped += 1;
      continue;
    }
    pending.push(classified);
  }
  if (pending.length === 0) return json(200, { accepted: 0, skipped });

  try {
    const wrote = await applyItems(await database(deps), pending);
    return json(200, { accepted: wrote.accepted, skipped });
  } catch (err) {
    console.error("[ingest] write failed", err instanceof Error ? err.name : "error");
    return json(503, { error: "unavailable" });
  }
}
