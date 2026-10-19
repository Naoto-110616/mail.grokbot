import { botBridge } from "@/lib/mail/adapters/bot-bridge";
import { localDemo } from "@/lib/mail/adapters/local-demo";
import type { BackendId, MailBackend } from "@/lib/mail/backend";

let active: MailBackend = botBridge;

export function getActiveBackend(): MailBackend {
  return active;
}

export function setActiveBackend(id: BackendId) {
  active = id === "bot-bridge" ? botBridge : localDemo;
}
