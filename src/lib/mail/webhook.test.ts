import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deliverWebhook } from "../../server/mail/bridge.server.ts";
import { parseConfig, toPublicConfig } from "../../server/mail/config.server.ts";
import { replyWebhook } from "./webhook-body.ts";
import type { Attachment } from "./model.ts";

const attachment: Attachment = {
  id: "att_note",
  filename: "note.txt",
  mime: "text/plain",
  bytes: 11,
  path: "files/note.txt",
};

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  return new Promise<{ server: typeof server; url: string }>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/hook` });
    });
  });
}

describe("webhook bridge", () => {
  it("posts one reply and keeps file bytes off the body", async () => {
    let count = 0;
    let seen: { headers: IncomingMessage["headers"]; body: Record<string, unknown> } | null = null;
    const { server, url } = await listen((req, res) => {
      count += 1;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen = { headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> };
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    const outbox = join(await mkdtemp(join(tmpdir(), "mail-outbox-")), "outbox.log");
    try {
      const payload = replyWebhook({
        clientSendId: "send_1",
        from: "you+ops@example.test",
        to: ["ada@example.test"],
        cc: [],
        bcc: [],
        subject: "Re: Quarterly notes",
        text: "Thanks.",
        replyToMessageId: "<a@example.test>",
        threadId: "thr_a_example_test",
        attachments: [attachment],
      });
      const result = await deliverWebhook({ webhookUrl: url, webhookKey: "test-key" }, payload, { outboxPath: outbox });
      assert.deepEqual(result, { ok: true, status: 200 });
      assert.equal(count, 1);
      assert.ok(seen);
      const posted = seen as { headers: IncomingMessage["headers"]; body: Record<string, unknown> };
      assert.equal(posted.headers.authorization, "Bearer test-key");
      assert.equal(posted.headers["x-automation-key"], "test-key");
      assert.equal(posted.body.action, "reply");
      assert.equal(posted.body.from, "you+ops@example.test");
      assert.equal(posted.body.replyToMessageId, "<a@example.test>");
      assert.deepEqual(posted.body.attachments, [{ filename: "note.txt", mime: "text/plain", bytes: 11 }]);
      assert.equal(JSON.stringify(posted.body).includes("files/note.txt"), false);
      assert.equal(JSON.stringify(posted.body).includes("Notes here"), false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("records a failed wake without the url or the key", async () => {
    const { server, url } = await listen((_req, res) => {
      res.writeHead(503);
      res.end("no");
    });
    const outbox = join(await mkdtemp(join(tmpdir(), "mail-outbox-")), "outbox.log");
    try {
      const result = await deliverWebhook(
        { webhookUrl: url, webhookKey: "test-key" },
        { action: "sync", after: null },
        { outboxPath: outbox },
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, "http");
      const line = await readFile(outbox, "utf8");
      assert.equal(line.includes("test-key"), false);
      assert.equal(line.includes("127.0.0.1"), false);
      assert.equal(line.includes("/hook"), false);
      assert.match(line, /"action":"sync"/);
      assert.match(line, /"error":"http"/);
      assert.match(line, /"status":503/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not return the webhook target on the public config", () => {
    const loaded = parseConfig({
      backend: "bot-bridge",
      displayName: "You",
      address: "you@example.test",
      webhookUrl: "http://127.0.0.1/hook",
      webhookKey: "test-key",
    });
    const pub = toPublicConfig(loaded);
    assert.equal(pub.backend, "bot-bridge");
    assert.equal(pub.configured, true);
    const text = JSON.stringify(pub);
    assert.equal(text.includes("test-key"), false);
    assert.equal(text.includes("127.0.0.1"), false);
    assert.equal("webhookUrl" in pub, false);
    assert.equal("webhookKey" in pub, false);
  });
});
