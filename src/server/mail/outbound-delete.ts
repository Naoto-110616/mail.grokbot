import type { Sql } from "../../lib/db.ts";

/** Remove outbound rows for threads deleted forever, and for send ids the client dropped. */
export async function deleteOutboundForMailbox(
  sql: Sql,
  hiddenThreadIds: readonly string[],
  dropOutboxIds: readonly string[],
): Promise<void> {
  for (const id of hiddenThreadIds) {
    if (!id) continue;
    await sql.query(`delete from mail_outbound where thread_id = $1`, [id]);
  }
  for (const id of dropOutboxIds) {
    if (!id) continue;
    await sql.query(`delete from mail_outbound where client_send_id = $1 or provider_message_id = $1`, [id]);
  }
}
