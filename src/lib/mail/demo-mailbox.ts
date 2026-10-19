import { applyInboxCategories } from "./category.ts";
import {
  aliasesFor,
  defaultSettings,
  inFolder,
  mineSet,
  signatureFor,
  type Address,
  type MailData,
  type Message,
  type Thread,
} from "./model.ts";
import type { OutboxItem } from "./outbox.ts";

/** Sample inbox. Always example.com, never the owner's real address. */
export const SAMPLE_ADDRESS = "you@example.com";
export const SAMPLE_NOTE =
  "Sample mail. Every address is example.com. Nothing here was sent or received.";
export const SAMPLE_OUTBOX_ID = "send_demo_1";

const SAMPLE_NOW = Date.parse("2026-10-19T12:00:00.000Z");

export type DemoPreview = {
  sample: boolean;
  note: string;
  subjects: string[];
};

function person(name: string, email: string): Address {
  return { name, email };
}

function message(
  partial: Pick<Message, "id" | "from" | "to" | "subject" | "body" | "date"> & Partial<Message>,
): Message {
  return {
    messageId: `<${partial.id}@example.com>`,
    inReplyTo: null,
    references: [],
    deliveredTo: partial.direction === "outbound" ? null : SAMPLE_ADDRESS,
    account: "primary",
    cc: [],
    bcc: [],
    attachments: [],
    direction: "inbound",
    ...partial,
  };
}

function thread(partial: Pick<Thread, "id" | "subject" | "location"> & Partial<Thread>): Thread {
  return {
    category: "primary",
    labels: [],
    plusTag: null,
    starred: false,
    important: false,
    unread: false,
    muted: false,
    snoozeUntil: null,
    messages: [],
    draft: null,
    account: "grokbot",
    ...partial,
  };
}

/** Invented mailbox. Callers clone it before saving edits. */
export function demoMailbox(): MailData {
  const signature = signatureFor("You", SAMPLE_ADDRESS);
  const settings = {
    ...defaultSettings(),
    displayName: "You",
    signature,
    defaultFrom: SAMPLE_ADDRESS,
  };
  const you = person("You", SAMPLE_ADDRESS);
  const ada = person("Ada Lovelace", "ada@example.com");
  const queuedBody = `I can bring the lemonade.\n\n${signature}`;
  const threads = applyInboxCategories(
    [
      thread({
        id: "thr_picnic",
        subject: "Saturday picnic",
        location: "inbox",
        starred: true,
        unread: true,
        messages: [
          message({
            id: "msg_picnic",
            from: ada,
            to: [you],
            subject: "Saturday picnic",
            body: "The park is free on Saturday. Bring a blanket.",
            date: "2026-10-18T15:00:00.000Z",
            direction: "inbound",
          }),
        ],
      }),
      thread({
        id: "thr_sensor",
        subject: "Sensor check",
        location: "inbox",
        unread: true,
        messages: [
          message({
            id: "msg_sensor",
            from: person("Sensor", "alerts@example.com"),
            to: [you],
            subject: "Sensor check",
            body: "The sensor reported a normal reading.",
            date: "2026-10-18T12:00:00.000Z",
            direction: "inbound",
          }),
        ],
      }),
      thread({
        id: "thr_shop",
        subject: "This week at the shop",
        location: "inbox",
        unread: true,
        messages: [
          message({
            id: "msg_shop",
            from: person("Shop", "newsletter@example.com"),
            to: [you],
            subject: "This week at the shop",
            body: "This week at the shop: bread on Friday.",
            html: "<p>This week at the shop.</p>",
            date: "2026-10-17T09:00:00.000Z",
            direction: "inbound",
          }),
        ],
      }),
      thread({
        id: "thr_sent",
        subject: "Picnic plan",
        location: "archive",
        messages: [
          message({
            id: "msg_sent",
            from: you,
            to: [ada],
            subject: "Picnic plan",
            body: "See you by the south gate.",
            date: "2026-10-16T18:00:00.000Z",
            direction: "outbound",
            delivery: "sent",
          }),
        ],
      }),
      thread({
        id: "thr_queued",
        subject: "Lemonade",
        location: "archive",
        messages: [
          message({
            id: "msg_queued",
            from: you,
            to: [ada],
            subject: "Lemonade",
            body: queuedBody,
            date: "2026-10-18T16:30:00.000Z",
            direction: "outbound",
            delivery: "waiting",
            clientSendId: SAMPLE_OUTBOX_ID,
          }),
        ],
      }),
      thread({
        id: "thr_draft",
        subject: "Basket list",
        location: "drafts",
        draft: {
          mode: "new",
          replyToId: null,
          from: SAMPLE_ADDRESS,
          to: "ada@example.com",
          cc: "",
          bcc: "",
          subject: "Basket list",
          body: `Bring the basket.\n\n${signature}`,
          updatedAt: "2026-10-18T16:00:00.000Z",
          attachments: [],
          signed: true,
        },
      }),
    ],
    settings.senderRules,
  );
  const outbox: OutboxItem[] = [
    {
      id: SAMPLE_OUTBOX_ID,
      fromAddress: SAMPLE_ADDRESS,
      to: ["ada@example.com"],
      cc: [],
      subject: "Lemonade",
      text: queuedBody,
      status: "queued",
      error: null,
      createdAt: "2026-10-18T16:30:00.000Z",
    },
  ];
  return {
    threads,
    labels: [],
    filters: [],
    settings,
    aliases: aliasesFor(SAMPLE_ADDRESS, "You"),
    demoCursor: 0,
    gmail: "off",
    outbox,
    sample: true,
  };
}

/** Inbox lines for the first paint and GET /api/demo. */
export function demoPreview(data: MailData = demoMailbox()): DemoPreview {
  const mine = mineSet(data.aliases);
  const subjects = data.threads
    .filter((item) => inFolder(item, "inbox", SAMPLE_NOW, mine))
    .map((item) => item.subject);
  return { sample: data.sample === true, note: SAMPLE_NOTE, subjects };
}
