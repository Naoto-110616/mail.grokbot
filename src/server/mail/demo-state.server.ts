import type { BotConnectionView } from "../../lib/mail/bot-connection.ts";
import { demoMailbox } from "../../lib/mail/demo-mailbox.ts";
import type { MailData } from "../../lib/mail/model.ts";

export type CancelDemoResult =
  | { ok: true; id: string; status: "cancelled" }
  | { ok: false; status: 404 | 409; error: "not found" | "conflict" };

const EMPTY_CONNECTION: BotConnectionView = { webhookUrl: "", headerMode: "bearer", keySet: false };

let current: MailData | null = null;
let connection: BotConnectionView = { ...EMPTY_CONNECTION };

export function readDemoMailbox(): MailData {
  if (!current) current = demoMailbox();
  return structuredClone(current);
}

export function writeDemoMailbox(data: MailData): void {
  const next = structuredClone(data);
  next.sample = true;
  current = next;
}

export function readDemoConnection(): BotConnectionView {
  return { ...connection };
}

export function writeDemoConnection(view: BotConnectionView): void {
  connection = { ...view };
}

/** Drop a queued sample send. The row is not in the database and is not delivered. */
export function cancelDemoOutbox(id: string): CancelDemoResult {
  const data = readDemoMailbox();
  const item = (data.outbox ?? []).find((row) => row.id === id);
  if (!item) return { ok: false, status: 404, error: "not found" };
  if (item.status !== "queued") return { ok: false, status: 409, error: "conflict" };
  const threads = data.threads
    .map((thread) => ({
      ...thread,
      messages: thread.messages.filter((message) => message.clientSendId !== id),
    }))
    .filter((thread) => thread.messages.length > 0 || thread.draft);
  writeDemoMailbox({
    ...data,
    threads,
    outbox: (data.outbox ?? []).filter((row) => row.id !== id),
  });
  return { ok: true, id, status: "cancelled" };
}

export function resetDemoMailbox(): void {
  current = null;
  connection = { ...EMPTY_CONNECTION };
}
