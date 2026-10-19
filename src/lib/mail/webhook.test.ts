import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toBotConnectionView } from "./bot-connection.ts";
import { deliverWebhook } from "../../server/mail/bridge.server.ts";
import { parseConfig, toPublicConfig } from "../../server/mail/config.server.ts";
import { pingWebhook, sendWake } from "./webhook-body.ts";
import { WAKE_ATTEMPT_DELAYS_MS, planAfterFailure, wakeErrorText } from "./wake-retry.ts";

const SENDER_KEY = "sender-key-example";

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

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
  });
}

describe("webhook bridge", () => {
  it("posts a content-free send wake with the bearer header only", async () => {
    let count = 0;
    let seen: { headers: IncomingMessage["headers"]; body: Record<string, unknown> } | null = null;
    const { server, url } = await listen((req, res) => {
      count += 1;
      void readBody(req).then((body) => {
        seen = { headers: req.headers, body };
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    const outbox = join(await mkdtemp(join(tmpdir(), "mail-outbox-")), "outbox.log");
    try {
      const payload = sendWake("send_1");
      assert.deepEqual(payload, { action: "send", clientSendId: "send_1" });
      const result = await deliverWebhook({ webhookUrl: url, webhookKey: "test-key" }, payload, { outboxPath: outbox });
      assert.deepEqual(result, { ok: true, status: 200 });
      assert.equal(count, 1);
      assert.ok(seen);
      const posted = seen as { headers: IncomingMessage["headers"]; body: Record<string, unknown> };
      assert.equal(posted.headers.authorization, "Bearer test-key");
      assert.equal(posted.headers["x-webhook-key"], undefined);
      assert.equal(posted.headers["x-automation-key"], undefined);
      assert.deepEqual(posted.body, { action: "send", clientSendId: "send_1" });
      for (const field of ["subject", "text", "from", "to", "cc", "bcc", "attachments", "html"]) {
        assert.equal(field in posted.body, false, field);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("sends the key in X-Webhook-Key when that mode is saved", async () => {
    let seen: IncomingMessage["headers"] | null = null;
    const { server, url } = await listen((req, res) => {
      req.resume();
      seen = req.headers;
      res.writeHead(200);
      res.end("{}");
    });
    const outbox = join(await mkdtemp(join(tmpdir(), "mail-outbox-")), "outbox.log");
    try {
      const result = await deliverWebhook(
        { webhookUrl: url, webhookKey: "test-key", headerMode: "x-webhook-key" },
        sendWake("send_2"),
        { outboxPath: outbox },
      );
      assert.deepEqual(result, { ok: true, status: 200 });
      assert.ok(seen);
      const headers = seen as IncomingMessage["headers"];
      assert.equal(headers["x-webhook-key"], "test-key");
      assert.equal(headers.authorization, undefined);
      assert.equal(headers["x-automation-key"], undefined);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("pings with {action:ping} and returns only the status", async () => {
    let seen: Record<string, unknown> | null = null;
    const { server, url } = await listen((req, res) => {
      void readBody(req).then((body) => {
        seen = body;
        res.writeHead(204);
        res.end();
      });
    });
    const outbox = join(await mkdtemp(join(tmpdir(), "mail-outbox-")), "outbox.log");
    try {
      const payload = pingWebhook();
      assert.deepEqual(payload, { action: "ping" });
      const result = await deliverWebhook({ webhookUrl: url, webhookKey: SENDER_KEY }, payload, { outboxPath: outbox });
      assert.equal(result.ok, false);
      assert.equal(result.status, 204);
      const shown = { status: result.status };
      assert.deepEqual(shown, { status: 204 });
      assert.equal(JSON.stringify(shown).includes(SENDER_KEY), false);
      assert.deepEqual(seen, { action: "ping" });
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
      webhookKey: SENDER_KEY,
      headerMode: "x-webhook-key",
    });
    const pub = toPublicConfig(loaded);
    assert.equal(pub.backend, "bot-bridge");
    assert.equal(pub.configured, true);
    const text = JSON.stringify(pub);
    assert.equal(text.includes(SENDER_KEY), false);
    assert.equal(text.includes("127.0.0.1"), false);
    assert.equal("webhookUrl" in pub, false);
    assert.equal("webhookKey" in pub, false);
    assert.equal("headerMode" in pub, false);
    const view = toBotConnectionView({
      webhookUrl: "https://example.com/hook",
      webhookKey: SENDER_KEY,
      headerMode: "bearer",
    });
    assert.equal(JSON.stringify(view).includes(SENDER_KEY), false);
    assert.deepEqual(view, { webhookUrl: "https://example.com/hook", headerMode: "bearer", keySet: true });
    assert.equal(loaded.delivery.keySet, true);
    assert.equal(JSON.stringify(loaded.delivery).includes(SENDER_KEY), false);
  });

  it("schedules five wakes and then fails", () => {
    assert.deepEqual([...WAKE_ATTEMPT_DELAYS_MS], [0, 30_000, 120_000, 600_000, 3_600_000]);
    assert.deepEqual(planAfterFailure(1), { kind: "retry", delayMs: 30_000 });
    assert.deepEqual(planAfterFailure(2), { kind: "retry", delayMs: 120_000 });
    assert.deepEqual(planAfterFailure(3), { kind: "retry", delayMs: 600_000 });
    assert.deepEqual(planAfterFailure(4), { kind: "retry", delayMs: 3_600_000 });
    assert.deepEqual(planAfterFailure(5), { kind: "failed" });
    for (const reason of [
      wakeErrorText({ status: 503, error: "http" }),
      wakeErrorText({ status: null, error: "timeout" }),
      wakeErrorText({ status: null, error: "network" }),
      wakeErrorText({ status: null, error: "unconfigured" }),
    ]) {
      assert.equal(reason.includes("did not wake"), false);
      assert.equal(reason.includes("not sent"), false);
      assert.equal(reason.toLowerCase().includes("reply"), false);
    }
    assert.equal(wakeErrorText({ status: 503, error: "http" }), "HTTP 503");
    assert.equal(wakeErrorText({ status: null, error: "timeout" }), "Timed out");
    assert.equal(wakeErrorText({ status: null, error: "network" }), "Network error");
    assert.equal(wakeErrorText({ status: null, error: "unconfigured" }), "Webhook is not set");
  });
});
