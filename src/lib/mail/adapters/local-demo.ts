import type { MailBackend, MutationResult, SendRequest } from "@/lib/mail/backend";
import {
  type ActKind,
  type Draft,
  type MailData,
  type Message,
  DEMO_ADDRESS,
  DEMO_DOMAIN,
  PRIMARY,
  aliasAddress,
  applyAct,
  emptyMailbox,
  mineSet,
  normalizeMailData,
  previewForPath,
  sealMessages,
  uid,
  visibleThreads,
} from "@/lib/mail/model";

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : DEMO_DOMAIN;
}

function sentMessage(data: MailData, request: SendRequest): Message {
  const id = uid();
  const fromEmail = request.from || data.settings.defaultFrom || PRIMARY;
  const reply = request.threadId
    ? data.threads.find((thread) => thread.id === request.threadId)?.messages.find((message) => message.id === request.replyToId)
    : undefined;
  const prior = reply?.references ?? [];
  const inReplyTo = request.replyToMessageId ?? reply?.messageId ?? null;
  const [sealed] = sealMessages(
    [
      {
        id,
        from: { name: request.displayName || data.settings.displayName, email: fromEmail },
        to: request.to,
        cc: request.cc,
        bcc: request.bcc,
        subject: request.subject,
        body: request.body,
        date: new Date().toISOString(),
        attachments: request.attachments,
        messageId: `<${id}@${domainOf(fromEmail)}>`,
        inReplyTo,
        references: inReplyTo ? [...prior, inReplyTo] : prior,
        deliveredTo: null,
        account: "primary",
        delivery: "sent",
        clientSendId: null,
      },
    ],
    null,
  );
  return sealed ?? {
    id,
    messageId: `<${id}@${domainOf(fromEmail)}>`,
    inReplyTo,
    references: [],
    deliveredTo: null,
    account: "primary",
    from: { name: request.displayName, email: fromEmail },
    to: request.to,
    cc: request.cc,
    bcc: request.bcc,
    subject: request.subject,
    body: request.body,
    date: new Date().toISOString(),
    attachments: request.attachments,
    delivery: "sent",
    clientSendId: null,
  };
}

function withThreads(data: MailData, threads: MailData["threads"]): MailData {
  return { ...data, threads };
}

export function insertOutgoing(data: MailData, request: SendRequest, message: Message): MailData {
  const mine = mineSet(data.aliases);
  const toSelf = request.to.some((address) => mine.has(address.email.toLowerCase()));
  const alias = data.aliases.find((item) => item.email === request.from);
  let threads = data.threads;
  if (request.threadId) {
    threads = threads.map((thread) =>
      thread.id === request.threadId
        ? {
            ...thread,
            subject: thread.subject || message.subject,
            messages: [...thread.messages, message],
            draft: null,
            unread: false,
            location: thread.location === "drafts" ? (toSelf ? "inbox" : "archive") : thread.location,
          }
        : thread,
    );
  } else {
    threads = [
      {
        id: request.draftThreadId ?? uid(),
        subject: message.subject,
        category: "primary",
        location: toSelf ? "inbox" : "archive",
        labels: [],
        plusTag: alias?.tag ?? null,
        starred: false,
        important: false,
        unread: false,
        muted: false,
        snoozeUntil: null,
        messages: [message],
        draft: null,
      },
      ...threads.filter((thread) => thread.id !== request.draftThreadId),
    ];
  }
  return withThreads(data, threads);
}

export const localDemo: MailBackend = {
  id: "local-demo",

  async bootstrap(current) {
    if (current && Array.isArray(current.threads)) {
      const normalized = normalizeMailData(current);
      return { ...normalized, gmail: normalized.gmail === "on" ? "on" : "off", demoCursor: 0 };
    }
    return emptyMailbox();
  },

  async sync(data) {
    return { data: { ...data, demoCursor: 0 }, notice: "Checked for new mail.", delivery: "sent" };
  },

  async readThread(data, id) {
    return data.threads.find((thread) => thread.id === id) ?? null;
  },

  async search(data, query) {
    return visibleThreads({
      threads: data.threads,
      folder: "all",
      category: "all",
      query,
      now: Date.now(),
      aliases: data.aliases,
      labels: data.labels,
      account: "grokbot",
    });
  },

  async getAttachment(attachment) {
    const text = previewForPath(attachment.path);
    return { filename: attachment.filename, mime: attachment.mime, text, base64: null };
  },

  async act(data, kind: ActKind, ids) {
    const chosen = new Set(ids);
    return withThreads(
      data,
      data.threads.map((thread) => (chosen.has(thread.id) ? applyAct(thread, kind) : thread)),
    );
  },

  async snooze(data, at, ids) {
    const chosen = new Set(ids);
    return withThreads(
      data,
      data.threads.map((thread) => {
        if (!chosen.has(thread.id)) return thread;
        const location = thread.location === "drafts" ? thread.location : "inbox";
        return { ...thread, snoozeUntil: new Date(at).toISOString(), location };
      }),
    );
  },

  async setLabels(data, labelId, ids) {
    if (!labelId || ids.length === 0) return { data, added: false };
    const allHave = ids.every((id) => data.threads.find((thread) => thread.id === id)?.labels.includes(labelId));
    const chosen = new Set(ids);
    const threads = data.threads.map((thread) => {
      if (!chosen.has(thread.id)) return thread;
      const labels = allHave ? thread.labels.filter((id) => id !== labelId) : [...new Set([...thread.labels, labelId])];
      return { ...thread, labels };
    });
    return { data: withThreads(data, threads), added: !allHave };
  },

  async saveDraft(data, draft: Draft, threadId) {
    if (threadId && data.threads.some((thread) => thread.id === threadId)) {
      return withThreads(
        data,
        data.threads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                draft,
                subject: thread.messages.length ? thread.subject : draft.subject || thread.subject || "(no subject)",
              }
            : thread,
        ),
      );
    }
    const id = uid();
    return withThreads(data, [
      {
        id,
        subject: draft.subject.trim() || "(no subject)",
        category: "primary",
        location: "drafts",
        labels: [],
        plusTag: data.aliases.find((alias) => alias.email === draft.from)?.tag ?? null,
        starred: false,
        important: false,
        unread: false,
        muted: false,
        snoozeUntil: null,
        messages: [],
        draft,
      },
      ...data.threads,
    ]);
  },

  async send(data, request: SendRequest): Promise<MutationResult> {
    const message = sentMessage(data, request);
    return { data: insertOutgoing(data, request, message), notice: "Message sent", delivery: "sent" };
  },

  async listAccounts(data) {
    const address = data.settings.defaultFrom || data.aliases[0]?.email || DEMO_ADDRESS;
    return [{ id: "grokbot" as const, address, label: addressLocalLabel(address) }];
  },
};

function addressLocalLabel(address: string): string {
  const local = address.split("@")[0]?.split("+")[0] || "you";
  return `${local}@`;
}

export function demoFromAddress(data: MailData, _account: "grokbot" | "gmail"): string {
  return data.settings.defaultFrom || data.aliases[0]?.email || PRIMARY;
}

export function demoMine(data: MailData, _account: "grokbot" | "gmail") {
  return mineSet(data.aliases);
}

export function plusFallback(data: MailData, tag: string | null, _account: "grokbot" | "gmail"): string {
  if (tag) {
    const match = data.aliases.find((alias) => alias.tag === tag);
    if (match) return match.email;
    return aliasAddress(tag, data.settings.defaultFrom || DEMO_ADDRESS);
  }
  return data.settings.defaultFrom || DEMO_ADDRESS;
}
