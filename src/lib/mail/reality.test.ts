import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseBody } from "./body-text.ts";
import { applyBackendData } from "./merge.ts";
import {
  attachmentBlobParts,
  bodyBeyondSignature,
  clearDraftThread,
  emptyMailbox,
  hideThreadIds,
  hydrateDisplaySettings,
  savedDraftThreadId,
  settingsFromUnknown,
  shouldPersistDraft,
  type Thread,
} from "./model.ts";
import { OUTBOX_WAITING, QUEUED_TOAST, outboxStatusLabel } from "./outbox.ts";
import { linkedThreadState, threadIsHidden } from "./thread-place.ts";

const SIGNATURE = "You\nyou@example.com";

function thread(id: string, location: Thread["location"] = "inbox"): Thread {
  return {
    id,
    subject: "Hello",
    category: "primary",
    location,
    labels: [],
    plusTag: null,
    starred: false,
    important: false,
    unread: false,
    muted: false,
    snoozeUntil: null,
    messages: [],
    draft: null,
  };
}

describe("signature cut", () => {
  it("shows a body that starts with --", () => {
    const started = parseBody("--\nHello from the signature line\nYou");
    const visible = started.blocks
      .map((block) => (block.kind === "p" ? block.inlines.map((part) => (part.kind === "link" ? part.label : part.text)).join("") : ""))
      .join("\n");
    assert.match(visible, /Hello from the signature line/);
    assert.equal(started.hidden, null);
    const blankThenMark = parseBody("\n\n--\nYou\nyou@example.com");
    const shown = blankThenMark.blocks
      .map((block) => (block.kind === "p" ? block.inlines.map((part) => (part.kind === "link" ? part.label : part.text)).join("") : ""))
      .join("\n");
    assert.match(shown, /you@example.com/);
    assert.equal(blankThenMark.hidden, null);
  });
});

describe("drafts that are only a signature", () => {
  it("skips a blank compose and keeps a letter that has a recipient", () => {
    assert.equal(bodyBeyondSignature(`Hello\n\n--\n${SIGNATURE}`, SIGNATURE), "Hello");
    assert.equal(bodyBeyondSignature(`\n\n--\n${SIGNATURE}`, SIGNATURE), "");
    assert.equal(bodyBeyondSignature("--", SIGNATURE), "");
    assert.equal(shouldPersistDraft({ to: "", cc: "", bcc: "", subject: "", body: "", attachments: [] }, SIGNATURE), false);
    assert.equal(
      shouldPersistDraft({ to: "", cc: "", bcc: "", subject: "", body: `\n\n--\n${SIGNATURE}`, attachments: [] }, SIGNATURE),
      false,
    );
    assert.equal(shouldPersistDraft({ body: "Hello" }, SIGNATURE), true);
    assert.equal(shouldPersistDraft({ to: "ada@example.com", body: `\n\n--\n${SIGNATURE}` }, SIGNATURE), true);
    assert.equal(shouldPersistDraft({ subject: "Notes", body: "" }, SIGNATURE), true);
    assert.equal(shouldPersistDraft({ body: "", attachments: [{ id: "file" }] }, SIGNATURE), true);
  });

  it("reuses the saved draft thread and drops an empty one", () => {
    const draft = {
      mode: "new" as const,
      replyToId: null,
      from: "you@example.com",
      to: "ada@example.com",
      cc: "",
      bcc: "",
      subject: "Notes",
      body: "Hello",
      updatedAt: "2026-10-18T00:00:00.000Z",
      attachments: [],
    };
    const saved = savedDraftThreadId([thread("draft-1")], draft, null);
    assert.equal(saved, null);
    const withDraft = { ...thread("draft-1"), draft };
    assert.equal(savedDraftThreadId([withDraft], draft, null), "draft-1");
    assert.equal(savedDraftThreadId([withDraft], draft, "draft-1"), "draft-1");
    const dropped = clearDraftThread({ ...emptyMailbox(), threads: [thread("draft-1")] }, "draft-1");
    assert.equal(dropped.threads.length, 0);
    const kept = clearDraftThread(
      {
        ...emptyMailbox(),
        threads: [{ ...thread("thr"), messages: [{ ...emptyMessage(), id: "m1" }], draft }],
      },
      "thr",
    );
    assert.equal(kept.threads.length, 1);
    assert.equal(kept.threads[0]?.draft, null);
    assert.equal(kept.threads[0]?.messages.length, 1);
  });
});

describe("settings and wake copy", () => {
  it("reads a stored settings document and lets bootstrap take the server copy", () => {
    assert.equal(settingsFromUnknown(null), null);
    assert.equal(settingsFromUnknown("nope"), null);
    const parsed = settingsFromUnknown({
      theme: "dim",
      density: "compact",
      glass: 40,
      senderRules: [{ email: "Ada@example.com", category: "social" }],
    });
    assert.equal(parsed?.theme, "dim");
    assert.equal(parsed?.density, "compact");
    assert.equal(parsed?.glass, 40);
    assert.equal(parsed?.senderRules?.[0]?.email, "ada@example.com");
    assert.equal(parsed?.senderRules?.[0]?.category, "social");

    const current = emptyMailbox();
    const incoming = emptyMailbox();
    incoming.settings = { ...incoming.settings, theme: "dim", density: "compact" };
    assert.equal(applyBackendData(current, incoming).settings.theme, "light");
    assert.equal(applyBackendData(current, incoming).settings.density, "comfortable");
    const server = applyBackendData(current, incoming, { settingsFrom: "server" });
    assert.equal(server.settings.theme, "dim");
    assert.equal(server.settings.density, "compact");

    const local = {
      ...emptyMailbox().settings,
      density: "compact" as const,
      theme: "dim" as const,
      glass: 12,
      pane: "none" as const,
      undoSeconds: 7,
      vacationOn: true,
      vacationText: "Away",
    };
    assert.equal(hydrateDisplaySettings(null, local).density, "compact");
    assert.equal(hydrateDisplaySettings(undefined, local).theme, "dim");
    assert.equal(hydrateDisplaySettings("nope", local).vacationText, "Away");
    const partial = hydrateDisplaySettings({ theme: "light", glass: 80 }, local);
    assert.equal(partial.theme, "light");
    assert.equal(partial.glass, 80);
    assert.equal(partial.density, "compact");
    assert.equal(partial.pane, "none");
    assert.equal(partial.undoSeconds, 7);
    assert.equal(partial.vacationOn, true);
    assert.equal(partial.vacationText, "Away");
    const encoded = hydrateDisplaySettings('{"density":"cozy"}', local);
    assert.equal(encoded.density, "cozy");
    assert.equal(encoded.theme, "dim");
    assert.equal(hydrateDisplaySettings({ theme: "dark" }, local).theme, "lights-out");
  });

  it("shows Sending while queued and the waiting line only for approval", () => {
    assert.equal(QUEUED_TOAST, "Sending…");
    assert.equal(outboxStatusLabel("queued", null), "Sending…");
    assert.equal(outboxStatusLabel("awaiting_approval", null), OUTBOX_WAITING);
    assert.equal(outboxStatusLabel("sent", null), "Sent");
    assert.equal(outboxStatusLabel("failed", "HTTP 503"), "Failed: HTTP 503");
    assert.equal(outboxStatusLabel("failed", "  "), "Failed");
    for (const line of [QUEUED_TOAST, OUTBOX_WAITING, outboxStatusLabel("failed", "HTTP 503")]) {
      assert.equal(line.includes("did not wake"), false);
      assert.equal(line.includes("not sent"), false);
      assert.equal(line.toLowerCase().includes("reply"), false);
    }
  });
});

describe("trash follows the send", () => {
  it("applies trash and hidden ids from the outbound thread onto the reloaded id", () => {
    const states = new Map<string, { location: string }>([["thread-send", { location: "trash" }]]);
    const keys = new Map<string, string>([
      ["send_1", "thread-send"],
      ["msg_prov", "thread-send"],
      ["<prov@example.com>", "thread-send"],
    ]);
    const messages = [{ id: "msg_prov", clientSendId: "send_1", messageId: "<prov@example.com>" }];
    assert.equal(linkedThreadState("thr_msg", messages, states, keys)?.location, "trash");
    states.set("thr_msg", { location: "inbox" });
    assert.equal(linkedThreadState("thr_msg", messages, states, keys)?.location, "inbox");
    assert.equal(threadIsHidden("thr_msg", messages, new Set(["thread-send"]), keys), true);
    assert.equal(threadIsHidden("thr_other", [{ id: "msg_x" }], new Set(["thread-send"]), keys), false);

    const gone = {
      ...thread("thr_msg", "trash"),
      messages: [{ ...emptyMessage(), id: "msg_prov-1", clientSendId: "send_1", messageId: "prov-1" }],
    };
    const stay = {
      ...thread("keep"),
      messages: [{ ...emptyMessage(), id: "msg_keep", clientSendId: "send_keep" }],
    };
    const mailbox = {
      ...emptyMailbox(),
      threads: [gone, stay],
      hiddenThreadIds: ["old"],
      outbox: [
        {
          id: "send_1",
          fromAddress: "you@example.com",
          to: ["ada@example.com"],
          cc: [],
          subject: "Hello",
          text: "Hello",
          status: "failed" as const,
          error: null,
          createdAt: "2026-10-18T00:00:00.000Z",
        },
        {
          id: "send_keep",
          fromAddress: "you@example.com",
          to: ["ada@example.com"],
          cc: [],
          subject: "Stay",
          text: "Hello",
          status: "queued" as const,
          error: null,
          createdAt: "2026-10-18T00:00:00.000Z",
        },
        {
          id: "send_orphan",
          fromAddress: "you@example.com",
          to: ["ada@example.com"],
          cc: [],
          subject: "Gone",
          text: "Hello",
          status: "sent" as const,
          error: null,
          createdAt: "2026-10-18T00:00:00.000Z",
        },
      ],
    };
    const hidden = hideThreadIds(mailbox, ["thr_msg"]);
    assert.deepEqual(hidden.threads.map((item) => item.id), ["keep"]);
    assert.deepEqual(hidden.hiddenThreadIds, ["old", "thr_msg"]);
    assert.deepEqual(hidden.outbox?.map((item) => item.id), ["send_keep"]);
    assert.deepEqual(hidden.dropOutboxIds, ["send_1", "prov-1"]);
  });
});

describe("attachment bytes", () => {
  it("decodes base64 and falls back to text", () => {
    const parts = attachmentBlobParts({ text: "fallback", base64: btoa("Hi") });
    assert.equal(parts.length, 1);
    const bytes = parts[0];
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(bytes), "Hi");
    assert.deepEqual(attachmentBlobParts({ text: "plain", base64: null }), ["plain"]);
    assert.deepEqual(attachmentBlobParts({ text: "plain", base64: "!!!" }), ["plain"]);
  });
});

describe("reality wiring", () => {
  it("persists settings, signs at send, autosaves, and keeps the row controls tappable", () => {
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    const server = readFileSync(new URL("../../server/mail/store.server.ts", import.meta.url), "utf8");
    const reader = readFileSync(new URL("../../components/mail/reader.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("../../components/mail/thread-list.tsx", import.meta.url), "utf8");
    const compose = readFileSync(new URL("../../components/mail/compose.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const outboundDelete = readFileSync(new URL("../../server/mail/outbound-delete.ts", import.meta.url), "utf8");
    const overlays = readFileSync(new URL("../../components/mail/overlays.tsx", import.meta.url), "utf8");
    const connection = readFileSync(new URL("./bot-connection.ts", import.meta.url), "utf8");

    assert.match(server, /mail_settings/);
    assert.match(server, /hydrateDisplaySettings/);
    assert.match(server, /settingsPresent/);
    assert.match(server, /overlay\?\.settingsPresent \? hydrateDisplaySettings\(overlay\.settingsSpec, localSettings\) : localSettings/);
    assert.match(server, /!overlay\.settingsPresent/);
    assert.equal(server.includes("settingsFromUnknown"), false);
    assert.match(server, /withSignature\(request\.body/);
    assert.match(server, /sendWake\(clientSendId\)/);
    assert.equal(server.includes("wakeMissNotice"), false);
    assert.equal(server.includes("replyWebhook"), false);
    assert.equal(server.includes("did not wake"), false);
    assert.equal(server.includes("not sent"), false);
    assert.match(server, /linkedThreadState/);
    assert.match(server, /applyFilters/);
    assert.match(server, /applySenderRules/);
    assert.match(server, /deleteOutboundForMailbox/);
    assert.match(server, /outboxItemsForThreads/);
    assert.match(outboundDelete, /delete from mail_outbound where thread_id = \$1/);
    assert.match(outboundDelete, /delete from mail_outbound where client_send_id = \$1 or provider_message_id = \$1/);

    const between = (start: string, end: string) => {
      const at = store.indexOf(start);
      const until = store.indexOf(end, at + start.length);
      assert.ok(at > 0 && until > at, `${start} .. ${end}`);
      return store.slice(at, until);
    };
    const settings = between("updateSettings: (partial) => {", "toggleSaved: (query) => {");
    assert.match(settings, /persistProduct\(\)/);
    const gate = between("setGateMode: (mode) => {", "setGateList: (gateList) => set");
    assert.match(gate, /persistProduct\(\)/);
    const open = between("openCompose: (mode, threadId) => {", "patchCompose: (partial) => {");
    assert.equal(open.includes("withSignature"), false);
    const send = between("send: () => {", "cancelOutbox: (id) => {");
    assert.match(send, /withSignature/);
    const dismiss = between("dismissCompose: () => {", "autosaveCompose: () => {");
    assert.match(dismiss, /shouldPersistDraft/);
    const autosave = between("autosaveCompose: () => {", "addFilter: (filter) => {");
    assert.match(autosave, /shouldPersistDraft/);
    assert.match(autosave, /saveDraft/);
    assert.equal(autosave.includes("Draft saved"), false);
    const forever = between("destroyForever: (id) => {", "resetMailbox: () => {");
    assert.match(forever, /location !== "trash"/);
    assert.match(forever, /hideThreadIds/);
    assert.match(forever, /persistProduct\(\)/);
    assert.match(store, /settingsFrom: "server"/);

    assert.equal(reader.includes("previewForPath"), false);
    assert.match(reader, /loadAttachment/);
    assert.match(reader, /attachmentBlobParts/);
    assert.match(reader, /bg-paper/);
    assert.equal(reader.includes('className="glass'), false);
    assert.match(reader, /label=\{link.label\} tall/);
    assert.match(reader, /min-h-11/);
    assert.match(reader, /Could not read this file/);
    assert.match(reader, /Not downloaded yet/);
    assert.match(reader, /This file is ready to download/);
    assert.match(reader, /mail-inline-link wrap-anywhere inline/);
    assert.match(reader, /inline-flex min-h-11/);
    assert.equal(reader.includes("mail-inline-link inline-flex"), false);
    assert.match(css, /\.mail-inline-link \{[^}]*padding-block: 13px;/);
    assert.match(css, /\.mail-inline-link \{[^}]*margin-block: -13px;/);

    assert.match(list, /aria-label="Done"/);
    assert.match(list, /inline-flex size-11 shrink-0 items-center justify-center rounded-full text-accent/);
    assert.equal(list.includes("lg:group-hover:inline-flex"), false);
    assert.equal(list.includes("hidden size-6"), false);
    assert.match(list, /Delete forever/);
    assert.match(list, /destroyForever/);
    assert.match(list, /bg-paper/);
    assert.match(list, /Retry/);
    assert.match(list, /item\.status === "failed"/);
    assert.match(store, /retryOutbox/);

    assert.match(overlays, /Grok Bot connection/);
    assert.match(overlays, /Send test ping/);
    assert.match(overlays, /HEADER_MODE_OPTIONS/);
    assert.match(overlays, /keySet \? "saved" : "not set"/);
    assert.match(connection, /Authorization: Bearer <key>/);
    assert.match(connection, /X-Webhook-Key: <key>/);
    assert.equal(overlays.includes("view.webhookKey"), false);
    assert.equal(/setSenderKey\(view/.test(overlays), false);
    assert.match(overlays, /text-base/);

    assert.match(compose, /autosaveCompose/);
    assert.match(compose, /700/);
  });
});

function emptyMessage() {
  return {
    id: "m",
    messageId: null,
    inReplyTo: null,
    references: [] as string[],
    deliveredTo: null,
    account: "primary",
    from: { name: "Ada", email: "ada@example.com" },
    to: [{ name: "You", email: "you@example.com" }],
    cc: [],
    bcc: [],
    subject: "Hello",
    body: "Hello",
    date: "2026-10-18T00:00:00.000Z",
    attachments: [],
  };
}
