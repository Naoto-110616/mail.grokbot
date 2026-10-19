/**
 * Mail backend for one person's own box.
 *
 * `bot-bridge` reads mail the bot delivered with POST /api/ingest and asks the
 * bot to wake up by POSTing to that box's webhook. The webhook URL, key, and
 * ingest token stay in server config. They are not part of this client contract.
 *
 * There is no shared host and no IMAP or SMTP in this app. Each person runs
 * their own copy. Product state (read, star, snooze, labels, folder) is stored
 * with the mailbox. The bot does not return message bodies on the webhook.
 */
import type { ActKind, Address, Attachment, Draft, DraftMode, MailData, Thread } from "@/lib/mail/model";

export type BackendId = "local-demo" | "bot-bridge";

export type AccountSummary = {
  id: string;
  address: string;
  label: string;
};

export type AttachmentBody = {
  filename: string;
  mime: string;
  text: string;
  base64: string | null;
};

export type SendRequest = {
  from: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
  attachments: Attachment[];
  replyToId: string | null;
  replyToMessageId: string | null;
  threadId: string | null;
  draftThreadId: string | null;
  mode: DraftMode;
  displayName: string;
};

export type MutationResult = {
  data: MailData;
  notice: string;
  delivery?: "sent" | "waiting" | "failed";
};

export interface MailBackend {
  id: BackendId;
  bootstrap(current: MailData | null): Promise<MailData>;
  sync(data: MailData): Promise<MutationResult>;
  readThread(data: MailData, id: string): Promise<Thread | null>;
  search(data: MailData, query: string): Promise<Thread[]>;
  getAttachment(attachment: Attachment): Promise<AttachmentBody | null>;
  act(data: MailData, kind: ActKind, ids: string[]): Promise<MailData>;
  snooze(data: MailData, at: number, ids: string[]): Promise<MailData>;
  setLabels(data: MailData, labelId: string, ids: string[]): Promise<{ data: MailData; added: boolean }>;
  saveDraft(data: MailData, draft: Draft, threadId: string | null): Promise<MailData>;
  send(data: MailData, request: SendRequest): Promise<MutationResult>;
  listAccounts(data: MailData): Promise<AccountSummary[]>;
}
