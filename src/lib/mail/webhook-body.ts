export type SyncWebhook = {
  action: "sync";
  after: string | null;
};

/** Wake only. The bot reads the message with GET /api/outbox. */
export type SendWebhook = {
  action: "send";
  clientSendId: string;
};

export type PingWebhook = {
  action: "ping";
};

export type WebhookBody = SyncWebhook | SendWebhook | PingWebhook;

export function syncWebhook(after: string | null): SyncWebhook {
  return { action: "sync", after };
}

export function sendWake(clientSendId: string): SendWebhook {
  return { action: "send", clientSendId };
}

export function pingWebhook(): PingWebhook {
  return { action: "ping" };
}
