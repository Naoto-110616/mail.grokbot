import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WebhookBody } from "../../lib/mail/webhook-body.ts";
import { webhookTarget, type MailSecrets } from "./config.server.ts";

const TIMEOUT_MS = 8_000;

export type DeliverResult =
  | { ok: true; status: 200 }
  | { ok: false; status: number | null; error: string };

function failureName(err: unknown): "timeout" | "network" {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return "timeout";
  return "network";
}

export function outboxRecord(action: string, status: number | null, error: string): string {
  return `${JSON.stringify({ at: new Date().toISOString(), action, status, error })}\n`;
}

async function writeOutbox(path: string, action: string, status: number | null, error: string) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, outboxRecord(action, status, error), "utf8");
}

/** One POST. A 200 means the bot woke up. The response body is ignored. */
export async function deliverWebhook(
  target: MailSecrets,
  body: WebhookBody,
  options?: { fetchImpl?: typeof fetch; outboxPath?: string; timeoutMs?: number },
): Promise<DeliverResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
  const outboxPath = options?.outboxPath ?? join(process.cwd(), "data", "outbox.log");
  try {
    const response = await fetchImpl(target.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${target.webhookKey}`,
        "x-automation-key": target.webhookKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 200) return { ok: true, status: 200 };
    await writeOutbox(outboxPath, body.action, response.status, "http");
    return { ok: false, status: response.status, error: "http" };
  } catch (err) {
    const error = failureName(err);
    await writeOutbox(outboxPath, body.action, null, error);
    return { ok: false, status: null, error };
  }
}

export async function deliverConfigured(body: WebhookBody, root = process.cwd()): Promise<DeliverResult> {
  const target = await webhookTarget(root);
  if (!target) return { ok: false, status: null, error: "unconfigured" };
  return deliverWebhook(target, body, { outboxPath: join(root, "data", "outbox.log") });
}
