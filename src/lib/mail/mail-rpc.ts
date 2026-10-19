import { createServerFn } from "@tanstack/react-start";
import type { AttachmentBody } from "@/lib/mail/backend";
import type { ActKind, Attachment, Draft, MailData } from "@/lib/mail/model";
import type { SendRequest } from "@/lib/mail/backend";
import { demoPublicConfig, type PublicMailConfig } from "@/lib/mail/public-config";

/**
 * Browser entry for the bot bridge. Handlers dynamic-import server modules so
 * the webhook URL and key never join this module's client graph.
 */
export const fetchPublicMailConfig = createServerFn({ method: "GET" }).handler(async (): Promise<PublicMailConfig> => {
  const { publicMailConfig } = await import("@/server/mail/config.server");
  return publicMailConfig();
});

function asMail(input: unknown): MailData {
  if (!input || typeof input !== "object" || !Array.isArray((input as MailData).threads)) {
    throw new Error("invalid mail data");
  }
  return input as MailData;
}

export const bridgeBootstrap = createServerFn({ method: "POST" })
  .validator((input: unknown) => (input == null ? null : asMail(input)))
  .handler(async ({ data }): Promise<MailData> => {
    const { loadBridgeMailbox } = await import("@/server/mail/store.server");
    return loadBridgeMailbox(data);
  });

export const bridgeSync = createServerFn({ method: "POST" })
  .validator((input: unknown) => asMail(input))
  .handler(async ({ data }) => {
    const { syncMailbox } = await import("@/server/mail/store.server");
    return syncMailbox(data);
  });

export const bridgeAct = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { data?: unknown; kind?: unknown; ids?: unknown };
    return { data: asMail(row?.data), kind: row?.kind as ActKind, ids: Array.isArray(row?.ids) ? (row.ids as string[]) : [] };
  })
  .handler(async ({ data }) => {
    const { actMailbox } = await import("@/server/mail/store.server");
    return actMailbox(data.data, data.kind, data.ids);
  });

export const bridgeSnooze = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { data?: unknown; at?: unknown; ids?: unknown };
    return {
      data: asMail(row?.data),
      at: typeof row?.at === "number" ? row.at : Date.now(),
      ids: Array.isArray(row?.ids) ? (row.ids as string[]) : [],
    };
  })
  .handler(async ({ data }) => {
    const { snoozeMailbox } = await import("@/server/mail/store.server");
    return snoozeMailbox(data.data, data.at, data.ids);
  });

export const bridgeSetLabels = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { data?: unknown; labelId?: unknown; ids?: unknown };
    return {
      data: asMail(row?.data),
      labelId: typeof row?.labelId === "string" ? row.labelId : "",
      ids: Array.isArray(row?.ids) ? (row.ids as string[]) : [],
    };
  })
  .handler(async ({ data }) => {
    const { setLabelMailbox } = await import("@/server/mail/store.server");
    return setLabelMailbox(data.data, data.labelId, data.ids);
  });

export const bridgeSaveDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { data?: unknown; draft?: Draft; threadId?: unknown };
    if (!row?.draft || typeof row.draft !== "object") throw new Error("invalid mail data");
    return { data: asMail(row.data), draft: row.draft, threadId: typeof row.threadId === "string" ? row.threadId : null };
  })
  .handler(async ({ data }) => {
    const { saveDraftMailbox } = await import("@/server/mail/store.server");
    return saveDraftMailbox(data.data, data.draft, data.threadId);
  });

export const bridgeSend = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as { data?: unknown; request?: SendRequest };
    if (!row?.request || typeof row.request !== "object") throw new Error("invalid mail data");
    return { data: asMail(row.data), request: row.request };
  })
  .handler(async ({ data }) => {
    const { sendMailbox } = await import("@/server/mail/store.server");
    return sendMailbox(data.data, data.request);
  });

export const bridgeReadAttachment = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const row = input as Partial<Attachment> | null;
    if (!row || typeof row.path !== "string" || typeof row.filename !== "string") throw new Error("invalid mail data");
    return {
      id: typeof row.id === "string" ? row.id : "file",
      filename: row.filename,
      mime: typeof row.mime === "string" ? row.mime : "application/octet-stream",
      bytes: typeof row.bytes === "number" ? row.bytes : 0,
      path: row.path,
    };
  })
  .handler(async ({ data }): Promise<AttachmentBody | null> => {
    const { readIngestBytes, bodyFromBytes } = await import("@/server/mail/attachments.server");
    const { join } = await import("node:path");
    const bytes = await readIngestBytes(join(process.cwd(), "data", "ingest"), data.path);
    if (!bytes) return null;
    return bodyFromBytes(data.filename, data.mime, bytes);
  });

export function publicConfigFallback(): PublicMailConfig {
  return demoPublicConfig();
}
