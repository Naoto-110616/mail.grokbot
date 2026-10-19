import { join } from "node:path";
import type { Sql } from "../../lib/db.ts";
import { sendWake } from "../../lib/mail/webhook-body.ts";
import { DUE_WAKE_CAP, WAKE_LEASE_MS, planAfterFailure, wakeErrorText } from "../../lib/mail/wake-retry.ts";
import { deliverWebhook, type DeliverResult } from "./bridge.server.ts";
import { webhookTargetUsing } from "./config.server.ts";

const QUEUED_SQL = "status in ('queued', 'waiting', 'pending')";

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Hold the row until this lease so a second request does not post the same wake. */
export async function armWake(sql: Sql, clientSendId: string, now = Date.now()): Promise<void> {
  await sql.query(
    `update mail_outbound
     set next_attempt_at = $2, updated_at = $3
     where client_send_id = $1 and ${QUEUED_SQL}`,
    [clientSendId, iso(now + WAKE_LEASE_MS), iso(now)],
  );
}

/**
 * Count this wake and either schedule the next delay or mark the row failed.
 * Does nothing unless the row is still queued. HTTP 200 leaves it queued for the bot.
 */
export async function recordWakeResult(sql: Sql, clientSendId: string, result: DeliverResult, now = Date.now()): Promise<void> {
  const rows = await sql.query<{ status: string; attempt_count: unknown }>(
    `select status, attempt_count from mail_outbound where client_send_id = $1`,
    [clientSendId],
  );
  const row = rows[0];
  if (!row) return;
  const status = row.status.trim().toLowerCase();
  if (status !== "queued" && status !== "waiting" && status !== "pending") return;
  const attempt = asCount(row.attempt_count) + 1;
  const updated = iso(now);
  if (result.ok) {
    await sql.query(
      `update mail_outbound
       set attempt_count = $2, next_attempt_at = null, last_error = null, updated_at = $3
       where client_send_id = $1 and ${QUEUED_SQL}`,
      [clientSendId, attempt, updated],
    );
    return;
  }
  const reason = wakeErrorText(result);
  const plan = planAfterFailure(attempt);
  if (plan.kind === "failed") {
    await sql.query(
      `update mail_outbound
       set status = 'failed', attempt_count = $2, next_attempt_at = null, last_error = $3, error = $3, updated_at = $4
       where client_send_id = $1 and ${QUEUED_SQL}`,
      [clientSendId, attempt, reason, updated],
    );
    return;
  }
  await sql.query(
    `update mail_outbound
     set attempt_count = $2, next_attempt_at = $3, last_error = $4, updated_at = $5
     where client_send_id = $1 and ${QUEUED_SQL}`,
    [clientSendId, attempt, iso(now + plan.delayMs), reason, updated],
  );
}

/** Compare-and-set one due row onto a short lease. Null schedules are not due. */
export async function claimDueWake(sql: Sql, now = Date.now()): Promise<string | null> {
  const rows = await sql.query<{ client_send_id: string }>(
    `with due as (
       select client_send_id from mail_outbound
       where ${QUEUED_SQL}
         and next_attempt_at is not null
         and next_attempt_at <= $1
       order by next_attempt_at asc, client_send_id asc
       limit 1
     )
     update mail_outbound
     set next_attempt_at = $2, updated_at = $1
     where client_send_id in (select client_send_id from due)
     returning client_send_id`,
    [iso(now), iso(now + WAKE_LEASE_MS)],
  );
  return rows[0]?.client_send_id ?? null;
}

/**
 * Post due wakes on this request. There is no cron: a Hobby cron cannot run this
 * schedule, so the next app or bot request is what fires a row whose time has passed.
 */
export async function runDueWakes(sql: Sql, root = process.cwd(), now = Date.now()): Promise<void> {
  for (let n = 0; n < DUE_WAKE_CAP; n += 1) {
    let id: string | null;
    try {
      id = await claimDueWake(sql, now);
    } catch {
      return;
    }
    if (!id) return;
    let result: DeliverResult;
    try {
      const target = await webhookTargetUsing(sql, root);
      result = target
        ? await deliverWebhook(target, sendWake(id), { outboxPath: join(root, "data", "outbox.log") })
        : { ok: false, status: null, error: "unconfigured" };
    } catch {
      result = { ok: false, status: null, error: "network" };
    }
    try {
      await recordWakeResult(sql, id, result, now);
    } catch {
      return;
    }
  }
}

/** Failed → queued, attempts cleared, lease held so the caller's POST is the only wake. */
export async function requeueFailedSend(sql: Sql, clientSendId: string, now = Date.now()): Promise<boolean> {
  const rows = await sql.query<{ client_send_id: string }>(
    `update mail_outbound
     set status = 'queued', attempt_count = 0, next_attempt_at = $2, last_error = null, error = null, updated_at = $3
     where client_send_id = $1 and status = 'failed'
     returning client_send_id`,
    [clientSendId, iso(now + WAKE_LEASE_MS), iso(now)],
  );
  return rows.length > 0;
}
