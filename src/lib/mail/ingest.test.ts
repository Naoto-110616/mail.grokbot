import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readIngestBytes, resolveInside } from "../../server/mail/attachments.server.ts";
import { applySendResults, classifyIngestItem, deliveryForStatus, fromJsonWithSignals, HTML_BODY_MAX_BYTES, loadIngest, parseHtmlBody, readMailSignals, threadsFromMessages, withOutboundOwner } from "../../server/mail/ingest.server.ts";
import { groupByHeaders, type ThreadableMessage } from "./threading.ts";
import { ATTACHMENT_CONTENT_MAX_BYTES, attachmentContentBase64, inFolder, listSender, mineSet, type Message, type Thread } from "./model.ts";

const fixtures = fileURLToPath(new URL("../../../tests/fixtures/ingest/", import.meta.url));

function threadFor(threads: Thread[], id: string) {
  return threads.find((thread) => thread.messages.some((message) => message.id === id));
}

describe("ingest fixtures", () => {
  it("keeps list-unsubscribe and auto-submitted for the chips rule", () => {
    const classified = classifyIngestItem({
      kind: "message",
      id: "msg_auto",
      from: { name: "Ada", email: "ada@example.com" },
      headers: { "List-Unsubscribe": "<mailto:leave@example.com>", "Auto-Submitted": "auto-generated" },
      body: "Hi",
      date: "2026-10-18T12:00:00.000Z",
    });
    assert.equal(classified.ok, true);
    if (!classified.ok || classified.kind !== "message") return;
    assert.equal(classified.message.listUnsubscribe, "<mailto:leave@example.com>");
    assert.equal(classified.message.autoSubmitted, "auto-generated");
    assert.equal(classified.message.from.email, "ada@example.com");
    const stored = JSON.parse(fromJsonWithSignals(classified.message)) as Record<string, string>;
    assert.equal(stored.email, "ada@example.com");
    assert.equal(stored.name, "Ada");
    assert.deepEqual(readMailSignals(stored), {
      listUnsubscribe: "<mailto:leave@example.com>",
      autoSubmitted: "auto-generated",
    });
    const plain = classifyIngestItem({
      kind: "message",
      id: "msg_plain",
      from: { name: "Ada", email: "ada@example.com" },
      body: "Hi",
    });
    assert.equal(plain.ok && plain.kind === "message" && plain.message.listUnsubscribe, undefined);
    const listed = classifyIngestItem({
      kind: "message",
      id: "msg_printful",
      from: { name: "Printful", email: "hello@print.example" },
      subject: "This week in the shop",
      body: "New colors are in. Unsubscribe any time.",
      headers: [
        { name: "List-Unsubscribe", value: "<mailto:bye@print.example>, <https://print.example/unsub>" },
        { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
      ],
    });
    assert.equal(listed.ok, true);
    if (!listed.ok || listed.kind !== "message") return;
    assert.equal(listed.message.listUnsubscribe, "<mailto:bye@print.example>, <https://print.example/unsub>");
    const block = classifyIngestItem({
      kind: "message",
      id: "msg_block",
      from: "ada@example.com",
      headers: "List-Unsubscribe: <mailto:leave@example.com>\r\nAuto-Submitted: auto-generated\r\n",
    });
    assert.equal(block.ok && block.kind === "message" && block.message.listUnsubscribe, "<mailto:leave@example.com>");
    assert.equal(block.ok && block.kind === "message" && block.message.autoSubmitted, "auto-generated");
    const pairs = classifyIngestItem({
      kind: "message",
      id: "msg_pairs",
      from: "ada@example.com",
      headers: [["List-Unsubscribe", ["<mailto:one@example.com>", "<https://example.com/unsub>"]]],
    });
    assert.equal(
      pairs.ok && pairs.kind === "message" && pairs.message.listUnsubscribe,
      "<mailto:one@example.com>, <https://example.com/unsub>",
    );
    if (plain.ok && plain.kind === "message") {
      assert.deepEqual(JSON.parse(fromJsonWithSignals(plain.message)), { name: "Ada", email: "ada@example.com" });
    }
  });

  it("threads by headers, then one subject fallback, and keeps the earliest plus tag", async () => {
    const loaded = await loadIngest(fixtures);
    assert.equal(loaded.identity?.address, "you@example.test");
    assert.equal(loaded.identity?.displayName, "You");

    const ops = threadFor(loaded.threads, "msg_a");
    const plain = threadFor(loaded.threads, "msg_c");
    assert.ok(ops);
    assert.ok(plain);
    assert.notEqual(ops.id, plain.id);
    assert.equal(ops.id, "thr_a_example_test");
    assert.deepEqual(
      ops.messages.map((message) => message.id),
      ["msg_a", "msg_b", "msg_d"],
    );
    assert.equal(ops.plusTag, "ops");
    assert.equal(ops.account, "grokbot");
    assert.equal(ops.messages[0]?.account, "primary");
    assert.equal(plain.plusTag, null);
    assert.equal(plain.messages.length, 1);
    assert.equal(plain.id, "thr_c_example_test");

    const note = ops.messages[0]?.attachments[0];
    assert.equal(note?.filename, "note.txt");
    assert.equal(note?.bytes, 11);
    assert.equal(note?.path, "files/note.txt");
    const bytes = await readIngestBytes(fixtures, "files/note.txt");
    assert.equal(bytes?.toString("utf8"), "Notes here\n");

    const promo = threadFor(loaded.threads, "msg_printful");
    const alert = threadFor(loaded.threads, "msg_botbagger");
    assert.ok(promo);
    assert.ok(alert);
    assert.equal(promo.category, "promotions");
    assert.equal(promo.messages[0]?.listUnsubscribe, "<mailto:bye@print.example>, <https://print.example/unsub>");
    assert.equal(alert.category, "updates");
    assert.equal(alert.messages[0]?.from.name, "BotBagger");
    assert.equal(alert.messages[0]?.subject, "Alert: bagger offline");
  });

  it("accepts attachment content under 1 MiB and drops the rest", () => {
    const encoded = btoa("ok");
    assert.equal(attachmentContentBase64({ content: encoded }), encoded);
    assert.equal(attachmentContentBase64({ content: ` ${encoded.slice(0, 2)}\n${encoded.slice(2)} ` }), encoded);
    assert.equal(attachmentContentBase64({ content: "" }), null);
    assert.equal(attachmentContentBase64({ content: "****" }), null);
    assert.equal(attachmentContentBase64({ content: "YQ" }), null);
    const over = btoa("x".repeat(ATTACHMENT_CONTENT_MAX_BYTES + 1));
    assert.equal(attachmentContentBase64({ content: over }), null);
    const exact = btoa("x".repeat(ATTACHMENT_CONTENT_MAX_BYTES));
    assert.equal(attachmentContentBase64({ content: exact }), exact);

    const classified = classifyIngestItem({
      kind: "message",
      id: "msg_file",
      from: "ada@example.com",
      attachments: [{ id: "att_ok", filename: "note.txt", mime: "text/plain", bytes: 2, path: "files/note.txt", content: encoded }],
    });
    assert.equal(classified.ok && classified.kind === "message", true);
    if (!classified.ok || classified.kind !== "message") return;
    assert.equal(classified.attachmentContent.get("att_ok"), encoded);
    assert.equal(Object.hasOwn(classified.message.attachments[0] ?? {}, "content"), false);
    const loose = classifyIngestItem({
      kind: "attachment",
      id: "att_loose",
      filename: "note.txt",
      content: "****",
    });
    assert.equal(loose.ok && loose.kind === "attachment" && loose.contentB64, null);
  });

  it("groups by threadHint before headers, and keeps different hints apart", () => {
    const row = (id: string, hint: string | null, extra: Partial<ThreadableMessage> = {}): ThreadableMessage => ({
      id,
      messageId: `<${id}@example.test>`,
      inReplyTo: null,
      references: [],
      subject: id,
      date: `2026-10-0${id.charCodeAt(0) - 96}T00:00:00Z`,
      deliveredTo: null,
      threadHint: hint,
      ...extra,
    });
    const groups = groupByHeaders([
      row("a", "Batch-1", { subject: "Alpha" }),
      row("b", "batch-1", { subject: "Beta" }),
      row("c", "batch-2", { subject: "Re: Alpha", inReplyTo: "<a@example.test>", references: ["<a@example.test>"] }),
      row("d", null, { subject: "Re: Alpha", inReplyTo: "<a@example.test>", references: ["<a@example.test>"] }),
    ]).map((group) => group.map((message) => message.id));
    assert.deepEqual(
      groups.find((ids) => ids.includes("a")),
      ["a", "b", "d"],
    );
    assert.deepEqual(
      groups.find((ids) => ids.includes("c")),
      ["c"],
    );
  });

  it("shows outbound mail as sent by the mailbox owner and lists it in Sent", () => {
    const owner = { name: "You", email: "you@example.test" };
    const mine = mineSet([{ email: owner.email, tag: null, name: owner.name }]);
    const outbound: Message = {
      id: "out_1",
      messageId: "<out-1@example.test>",
      inReplyTo: null,
      references: [],
      deliveredTo: null,
      account: "primary",
      from: { name: "Ada", email: "ada@example.test" },
      to: [{ name: "Ada", email: "ada@example.test" }],
      cc: [],
      bcc: [],
      subject: "Sent note",
      body: "On it.",
      date: "2026-10-05T12:00:00Z",
      attachments: [],
      direction: "outbound",
    };
    const inbound: Message = { ...outbound, id: "in_1", messageId: "<in-1@example.test>", direction: null, subject: "Inbound" };
    const sentThread = threadsFromMessages([outbound])[0];
    assert.ok(sentThread);
    assert.equal(sentThread.location, "archive");
    const shown = { ...sentThread, messages: sentThread.messages.map((message) => withOutboundOwner(message, owner)) };
    assert.equal(shown.messages[0]?.from.email, owner.email);
    assert.equal(shown.messages[0]?.from.name, owner.name);
    assert.equal(outbound.from.email, "ada@example.test");
    assert.equal(inFolder(shown, "sent", Date.parse("2026-10-06T00:00:00Z"), mine), true);
    assert.equal(inFolder(shown, "inbox", Date.parse("2026-10-06T00:00:00Z"), mine), false);
    assert.equal(listSender(shown, mine), "To: Ada");
    const received = threadsFromMessages([inbound])[0];
    assert.ok(received);
    assert.equal(inFolder(received, "sent", Date.parse("2026-10-06T00:00:00Z"), mine), false);
    assert.equal(withOutboundOwner(inbound, owner).from.email, "ada@example.test");
  });

  it("treats a missing direction as inbound unless from is the account address", () => {
    const owner = "you@example.test";
    const mine = mineSet([{ email: owner, tag: null, name: "You" }]);
    const now = Date.parse("2026-10-06T00:00:00Z");
    const inbound: Message = {
      id: "in_1",
      messageId: "<in-1@example.test>",
      inReplyTo: null,
      references: [],
      deliveredTo: null,
      account: "primary",
      from: { name: "Ada", email: "ada@example.test" },
      to: [{ name: "You", email: owner }],
      cc: [],
      bcc: [],
      subject: "Inbound",
      body: "Hello",
      date: "2026-10-05T12:00:00Z",
      attachments: [],
      direction: null,
    };
    const received = threadsFromMessages([inbound], new Map(), owner)[0];
    assert.ok(received);
    assert.equal(received.location, "inbox");
    assert.equal(received.messages[0]?.direction, null);
    assert.equal(inFolder(received, "inbox", now, mine), true);
    const own: Message = {
      ...inbound,
      id: "own_1",
      messageId: "<own-1@example.test>",
      from: { name: "You", email: "You@Example.Test" },
      subject: "Sent without a direction",
    };
    const sent = threadsFromMessages([own], new Map(), owner)[0];
    assert.ok(sent);
    assert.equal(sent.location, "archive");
    assert.equal(sent.messages[0]?.direction, "outbound");
    assert.equal(own.direction, null);
    assert.equal(inFolder(sent, "inbox", now, mine), false);
    assert.equal(inFolder(sent, "sent", now, mine), true);
    const explicit = threadsFromMessages([{ ...own, id: "keep_in", messageId: "<keep-in@example.test>", direction: "inbound" }], new Map(), owner)[0];
    assert.equal(explicit?.location, "inbox");
    assert.equal(explicit?.messages[0]?.direction, "inbound");
  });

  it("applies a send-result onto a synthetic waiting reply", async () => {
    const loaded = await loadIngest(fixtures);
    const waiting: Message = {
      id: "out_1",
      messageId: "<out-1@example.test>",
      inReplyTo: "<a@example.test>",
      references: ["<a@example.test>"],
      deliveredTo: null,
      account: "primary",
      from: { name: "You", email: "you+ops@example.test" },
      to: [{ name: "Ada", email: "ada@example.test" }],
      cc: [],
      bcc: [],
      subject: "Re: Quarterly notes",
      body: "On it.",
      date: "2026-10-04T12:00:00Z",
      attachments: [],
      delivery: "waiting",
      clientSendId: "send_1",
    };
    const [updated] = applySendResults([waiting], loaded.sendResults);
    assert.equal(updated?.delivery, "sent");
    assert.equal(updated?.messageId, "<sent-1@example.test>");
    assert.equal(deliveryForStatus("pending"), "waiting");
    assert.equal(deliveryForStatus("queued"), "waiting");
    assert.equal(deliveryForStatus("awaiting_approval"), "waiting");
    assert.equal(deliveryForStatus("rejected"), "failed");
    assert.equal(deliveryForStatus("declined"), "failed");
    assert.equal(deliveryForStatus("cancelled"), "failed");
    assert.equal(deliveryForStatus("approved"), "sent");
  });

  it("does not mix a fixtures directory into the live ingest root", async () => {
    const root = await mkdtemp(join(tmpdir(), "mail-ingest-"));
    await mkdir(join(root, "fixtures"), { recursive: true });
    const sample = {
      kind: "message",
      id: "msg_skip",
      messageId: "<skip@example.test>",
      from: { name: "Skip", email: "skip@example.test" },
      to: [{ name: "You", email: "you@example.test" }],
      subject: "Skip me",
      body: "fixture",
      date: "2026-10-01T00:00:00Z",
      deliveredTo: "you@example.test",
      account: "primary",
    };
    const live = { ...sample, id: "msg_live", messageId: "<live@example.test>", subject: "Live" };
    await writeFile(join(root, "fixtures", "skip.json"), JSON.stringify(sample));
    await writeFile(join(root, "live.json"), JSON.stringify(live));
    const scanned = await loadIngest(root);
    assert.deepEqual(scanned.messages.map((message) => message.id), ["msg_live"]);
    const direct = await loadIngest(join(root, "fixtures"));
    assert.deepEqual(direct.messages.map((message) => message.id), ["msg_skip"]);
  });

  it("rejects attachment paths that leave the ingest root", () => {
    const root = resolve("/tmp/ingest-root");
    assert.equal(resolveInside(root, "../secret.txt"), null);
    assert.equal(resolveInside(root, "/etc/passwd"), null);
    assert.equal(resolveInside(root, "files/\0note.txt"), null);
    assert.equal(resolveInside(root, ""), null);
    assert.equal(resolveInside(root, "files/note.txt"), resolve(root, "files/note.txt"));
  });

  it("keeps html from a fictional newsletter message and drops an over-cap body", () => {
    const html = [
      "<table><tr><td>",
      "<h1>Harbor Weekly</h1>",
      "<p>The tide was quiet.</p>",
      '<img src="https://cdn.example.com/harbor.png" alt="Harbor">',
      '<a href="https://news.example.com/harbor">Read the week</a>',
      "</td></tr></table>",
    ].join("");
    const classified = classifyIngestItem({
      kind: "message",
      id: "msg_harbor",
      messageId: "<harbor@example.com>",
      from: { name: "Harbor Weekly", email: "editor@example.com" },
      to: [{ name: "You", email: "you@example.test" }],
      subject: "Harbor Weekly",
      body: "The tide was quiet. Read the week at https://news.example.com/harbor",
      html,
      date: "2026-10-18T12:00:00.000Z",
    });
    assert.equal(classified.ok, true);
    if (!classified.ok || classified.kind !== "message") return;
    assert.equal(classified.message.html, html);
    assert.match(classified.message.body, /tide was quiet/);
    assert.equal(classified.message.from.email, "editor@example.com");

    assert.equal(parseHtmlBody(undefined), null);
    assert.equal(parseHtmlBody("   "), null);
    assert.equal(parseHtmlBody("é".repeat(Math.floor(HTML_BODY_MAX_BYTES / 2) + 1)), null);
    const exact = "p".repeat(HTML_BODY_MAX_BYTES);
    assert.equal(parseHtmlBody(exact), exact);
    const over = classifyIngestItem({
      kind: "message",
      id: "msg_big",
      from: "editor@example.com",
      body: "Plain stays",
      html: "h".repeat(HTML_BODY_MAX_BYTES + 1),
    });
    assert.equal(over.ok && over.kind === "message" && over.message.html, null);
    if (over.ok && over.kind === "message") assert.equal(over.message.body, "Plain stays");
  });
});
