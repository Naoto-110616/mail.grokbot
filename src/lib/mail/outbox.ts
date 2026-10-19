/** Status the bot and the Outbox folder share. `waiting` in the database is queued. */

export type OutboxStatus = "queued" | "awaiting_approval" | "sent" | "declined" | "failed" | "cancelled";

export type OutboxItem = {
  id: string;
  fromAddress: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  status: OutboxStatus;
  error: string | null;
  /** ISO time the row was queued. The folder lists newest first. */
  createdAt: string;
};

export const OUTBOX_WAITING = "Waiting for your OK in Grok Bot";
export const QUEUED_TOAST = "Queued for approval in Grok Bot";

const POST_STATUSES = new Set<OutboxStatus>(["queued", "awaiting_approval", "sent", "declined", "failed"]);

export function canonicalOutboxStatus(status: string | null | undefined): OutboxStatus | null {
  const value = status?.trim().toLowerCase() ?? "";
  if (value === "waiting" || value === "queued" || value === "pending") return "queued";
  if (
    value === "awaiting_approval" ||
    value === "sent" ||
    value === "declined" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

/** Status values the bot may POST. Cancel is only DELETE. */
export function parsePostedStatus(status: unknown): OutboxStatus | null {
  if (typeof status !== "string") return null;
  const canonical = canonicalOutboxStatus(status);
  if (!canonical || !POST_STATUSES.has(canonical)) return null;
  if (status.trim().toLowerCase() === "waiting" || status.trim().toLowerCase() === "pending") return null;
  return canonical;
}

/**
 * queued -> awaiting_approval
 * awaiting_approval -> sent | declined | failed | queued
 * queued -> cancelled (DELETE only)
 */
export function outboxTransitionAllowed(from: string, to: OutboxStatus): boolean {
  const current = canonicalOutboxStatus(from);
  if (!current) return false;
  if (to === "cancelled") return current === "queued";
  if (current === "queued" && to === "awaiting_approval") return true;
  if (current === "awaiting_approval" && (to === "sent" || to === "declined" || to === "failed" || to === "queued")) {
    return true;
  }
  return false;
}

/** Map an ingest send-result onto an outbox status. Unknown values do not move the row. */
export function outboxTargetFromSendResult(status: string): OutboxStatus | null {
  const value = status.trim().toLowerCase();
  if (value === "sent" || value === "approved") return "sent";
  if (value === "failed" || value === "rejected" || value === "error") return "failed";
  if (value === "declined") return "declined";
  if (value === "awaiting_approval") return "awaiting_approval";
  if (value === "queued" || value === "pending" || value === "waiting") return "queued";
  return null;
}

export function outboxStatusLabel(status: OutboxStatus, error: string | null): string {
  if (status === "queued" || status === "awaiting_approval") return OUTBOX_WAITING;
  if (status === "sent") return "Sent";
  if (status === "declined") return "Declined";
  if (status === "cancelled") return "Cancelled";
  return `Failed: ${error ?? ""}`;
}

export function outboxBadgeCount(items: readonly OutboxItem[]): number {
  return items.filter((item) => item.status === "queued" || item.status === "awaiting_approval").length;
}

export function sentMessageIdForProvider(providerMessageId: string): string {
  return `msg_${providerMessageId}`;
}
