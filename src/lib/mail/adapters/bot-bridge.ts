import type { MailBackend } from "@/lib/mail/backend";
import { localDemo } from "@/lib/mail/adapters/local-demo";
import { previewForPath } from "@/lib/mail/model";
import {
  bridgeAct,
  bridgeBootstrap,
  bridgeReadAttachment,
  bridgeSaveDraft,
  bridgeSend,
  bridgeSetLabels,
  bridgeSnooze,
  bridgeSync,
} from "@/lib/mail/mail-rpc";

export const botBridge: MailBackend = {
  id: "bot-bridge",

  async bootstrap(current) {
    return bridgeBootstrap({ data: current });
  },

  async sync(data) {
    return bridgeSync({ data });
  },

  readThread(data, id) {
    return localDemo.readThread(data, id);
  },

  search(data, query) {
    return localDemo.search(data, query);
  },

  async getAttachment(attachment) {
    const text = previewForPath(attachment.path);
    if (text) return { filename: attachment.filename, mime: attachment.mime, text, base64: null };
    try {
      return await bridgeReadAttachment({ data: attachment });
    } catch {
      return null;
    }
  },

  async act(data, kind, ids) {
    return bridgeAct({ data: { data, kind, ids } });
  },

  async snooze(data, at, ids) {
    return bridgeSnooze({ data: { data, at, ids } });
  },

  async setLabels(data, labelId, ids) {
    return bridgeSetLabels({ data: { data, labelId, ids } });
  },

  async saveDraft(data, draft, threadId) {
    return bridgeSaveDraft({ data: { data, draft, threadId } });
  },

  async send(data, request) {
    return bridgeSend({ data: { data, request } });
  },

  listAccounts(data) {
    return localDemo.listAccounts(data);
  },
};
