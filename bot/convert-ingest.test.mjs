import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertInput, headersFrom, normalizeMessage } from "./convert-ingest.mjs";
import { ATTACHMENT_MAX_BYTES, HTML_MAX_BYTES, REQUEST_MAX_BYTES } from "./ingest-shape.mjs";
import { bearerToken, ingestUrl, pushIngest } from "./push-ingest.mjs";

const SMALL = Buffer.from("hello").toString("base64");

test("converts a message, drops oversize html and attachment bytes, and keeps headers as a list", () => {
  const headers = headersFrom({ From: "Ada <ada@example.com>", Subject: "Picnic" });
  assert.deepEqual(headers, [
    { name: "From", value: "Ada <ada@example.com>" },
    { name: "Subject", value: "Picnic" },
  ]);
  const kept = normalizeMessage({
    kind: "message",
    from: { name: "Ada", email: "ada@example.com" },
    to: ["you@example.com"],
    subject: "Picnic",
    body: "Hello",
    html: "<p>Hello</p>",
    headers: { From: "Ada <ada@example.com>" },
    attachments: [
      { id: "att_1", filename: "note.txt", mime: "text/plain", bytes: 5, content: SMALL },
    ],
  });
  assert.equal(kept.html, "<p>Hello</p>");
  assert.equal(kept.attachments[0].content, SMALL);
  assert.deepEqual(kept.headers, [{ name: "From", value: "Ada <ada@example.com>" }]);

  const hugeHtml = normalizeMessage({
    from: "ada@example.com",
    subject: "Big",
    body: "plain",
    html: "a".repeat(HTML_MAX_BYTES + 1),
  });
  assert.equal(hugeHtml.body, "plain");
  assert.equal("html" in hugeHtml, false);

  const tooBig = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 1).toString("base64");
  const dropped = normalizeMessage({
    from: "ada@example.com",
    subject: "File",
    body: "see file",
    attachments: [
      {
        id: "att_big",
        filename: "big.bin",
        mime: "application/octet-stream",
        bytes: 12,
        content: tooBig,
      },
    ],
  });
  assert.equal(dropped.attachments[0].filename, "big.bin");
  assert.equal("content" in dropped.attachments[0], false);

  const mapped = convertInput(
    JSON.stringify({
      contentById: { att_1: SMALL, att_missing: SMALL },
      items: [
        {
          kind: "message",
          from: "ada@example.com",
          subject: "Mapped",
          body: "body",
          attachments: [{ id: "att_1", filename: "note.txt", mime: "text/plain", bytes: 0 }],
        },
      ],
    }),
  );
  assert.equal(mapped.items[0].attachments[0].content, SMALL);
  assert.equal(JSON.stringify(mapped).includes("att_missing"), false);
});

test("keeps deliveredTo and account so the plus-tag survives", () => {
  const fromJson = convertInput(
    JSON.stringify({
      kind: "message",
      id: "msg_a",
      from: "ada@example.com",
      to: "you@example.com",
      subject: "Notes",
      body: "Hello",
      deliveredTo: "you+ops@example.com",
      account: "primary",
      headers: { "Delivered-To": "you+other@example.com" },
    }),
  );
  assert.equal(fromJson.items[0].deliveredTo, "you+ops@example.com");
  assert.equal(fromJson.items[0].account, "primary");
  assert.equal(fromJson.items[0].id, "msg_a");

  const fromHeader = normalizeMessage({
    from: "ada@example.com",
    subject: "Tag",
    body: "Hi",
    headers: [{ name: "Delivered-To", value: "You <you+books@example.com>" }],
    account: "books",
  });
  assert.equal(fromHeader.deliveredTo, "You <you+books@example.com>");
  assert.equal(fromHeader.account, "books");

  const originalTo = normalizeMessage({
    from: "ada@example.com",
    subject: "Alt",
    body: "Hi",
    headers: { "X-Original-To": "you+ops@example.com" },
  });
  assert.equal(originalTo.deliveredTo, "you+ops@example.com");
  assert.equal("account" in originalTo, false);

  const raw = [
    "From: Ada <ada@example.com>",
    "To: you@example.com",
    "Delivered-To: you+ops@example.com",
    "Subject: Tagged",
    "Message-ID: <tagged@example.com>",
    "Date: Sat, 18 Oct 2026 15:00:00 +0000",
    "",
    "Body",
  ].join("\n");
  const mime = convertInput(raw);
  assert.equal(mime.items[0].deliveredTo, "you+ops@example.com");
  assert.equal("account" in mime.items[0], false);
});

test("converts a raw message and a simple multipart message", () => {
  const raw = [
    "From: Ada Lovelace <ada@example.com>",
    "To: You <you@example.com>",
    "Subject: Saturday picnic",
    "Message-ID: <picnic@example.com>",
    "Date: Sat, 18 Oct 2026 15:00:00 +0000",
    "",
    "See you at noon.",
  ].join("\n");
  const plain = convertInput(raw);
  assert.equal(plain.items.length, 1);
  assert.equal(plain.items[0].kind, "message");
  assert.equal(plain.items[0].id.startsWith("msg_"), true);
  assert.equal(plain.items[0].from.email, "ada@example.com");
  assert.equal(plain.items[0].subject, "Saturday picnic");
  assert.equal(plain.items[0].body, "See you at noon.");
  assert.equal(
    plain.items[0].headers.some((header) => header.name === "Subject"),
    true,
  );

  const mixed = [
    "From: Ada Lovelace <ada@example.com>",
    "To: you@example.com",
    "Subject: Shop note",
    "Message-ID: <shop@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=bound",
    "",
    "--bound",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Plain line.",
    "--bound",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>Html line.</p>",
    "--bound",
    "Content-Type: text/plain",
    'Content-Disposition: attachment; filename="note.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    SMALL,
    "--bound--",
    "",
  ].join("\n");
  const parts = convertInput(mixed);
  assert.equal(parts.items[0].body, "Plain line.");
  assert.equal(parts.items[0].html, "<p>Html line.</p>");
  assert.equal(parts.items[0].attachments[0].filename, "note.txt");
  assert.equal(parts.items[0].attachments[0].content, SMALL);
});

test("push uses env for the URL and refuses an oversized body without calling fetch", async () => {
  assert.equal(ingestUrl({}), "");
  assert.equal(
    ingestUrl({ GBM_APP_ORIGIN: "https://app.example/" }),
    "https://app.example/api/ingest",
  );
  assert.equal(
    ingestUrl({ GBM_INGEST_URL: "https://app.example/hook" }),
    "https://app.example/hook",
  );
  assert.equal(bearerToken({}), "");
  const value = "abc123xyz";
  const env = { GBM_APP_ORIGIN: "https://app.example" };
  env.GBM_INGEST_TOKEN = value;
  let calls = 0;
  const ok = await pushIngest(Buffer.from('{"items":[]}'), env, async (url, init) => {
    calls += 1;
    assert.equal(url, "https://app.example/api/ingest");
    assert.equal(init.headers.authorization, `Bearer ${value}`);
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  });
  assert.equal(calls, 1);
  assert.equal(ok.status, 401);
  assert.equal(ok.error, "unauthorized");
  await assert.rejects(
    pushIngest(Buffer.alloc(REQUEST_MAX_BYTES + 1), env, async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }),
    (err) => err.code === "too_large",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    pushIngest("{}", {}, async () => new Response("")),
    (err) => err.code === "usage",
  );
});

test("push script exits 2 when no origin is configured and files contain no baked token", () => {
  const script = fileURLToPath(new URL("./push-ingest.mjs", import.meta.url));
  const env = { ...process.env };
  delete env.GBM_INGEST_URL;
  delete env.GBM_APP_ORIGIN;
  delete env.GBM_INGEST_PATH;
  delete env.GBM_INGEST_TOKEN;
  delete env.INGEST_TOKEN;
  const result = spawnSync(process.execPath, [script, "missing.json"], { env, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /GBM_APP_ORIGIN/);
  assert.equal(result.stdout, "");
  const sources = ["ingest-shape.mjs", "convert-ingest.mjs", "push-ingest.mjs", "reply-id.mjs"].map(
    (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
  );
  for (const source of sources) {
    assert.equal(/Bearer\s+[A-Za-z0-9_\-.]{20,}/.test(source), false);
    assert.equal(/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i.test(source), false);
    const local = String.fromCharCode(112, 98, 104, 64);
    const host = ["mail", "grokbot", "com"].join(".");
    assert.equal(source.toLowerCase().includes(local), false);
    assert.equal(source.toLowerCase().includes(host), false);
  }
  const dir = mkdtempSync(join(tmpdir(), "ingest-push-"));
  const file = join(dir, "items.json");
  writeFileSync(file, '{"items":[]}\n');
  const missingToken = spawnSync(process.execPath, [script, file], {
    env: { ...env, GBM_APP_ORIGIN: "https://app.example" },
    encoding: "utf8",
  });
  assert.equal(missingToken.status, 2);
});
