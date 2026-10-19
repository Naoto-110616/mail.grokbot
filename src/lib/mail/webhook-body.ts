import type { Attachment } from "./model.ts";

export type SyncWebhook = {
  action: "sync";
  after: string | null;
};

export type ReplyAttachmentMeta = {
  filename: string;
  mime: string;
  bytes: number;
};

export type ReplyWebhook = {
  action: "reply";
  clientSendId: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  replyToMessageId: string | null;
  threadId: string | null;
  attachments: ReplyAttachmentMeta[];
};

export type WebhookBody = SyncWebhook | ReplyWebhook;

export function syncWebhook(after: string | null): SyncWebhook {
  return { action: "sync", after };
}

/** Metadata only. File bytes and paths never ride on the webhook. */
export function replyWebhook(input: {
  clientSendId: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  replyToMessageId: string | null;
  threadId: string | null;
  attachments: Attachment[];
}): ReplyWebhook {
  return {
    action: "reply",
    clientSendId: input.clientSendId,
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    replyToMessageId: input.replyToMessageId,
    threadId: input.threadId,
    attachments: input.attachments.map((file) => ({
      filename: file.filename,
      mime: file.mime,
      bytes: file.bytes,
    })),
  };
}
