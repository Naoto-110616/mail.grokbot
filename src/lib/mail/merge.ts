import { applySenderRules } from "./bundles.ts";
import { applyGate } from "./gate.ts";
import { keepLocalSettings, type MailData } from "./model.ts";

/** Keep browser prefs when a server mailbox replaces threads. */
export function applyBackendData(current: MailData, incoming: MailData): MailData {
  const settings = keepLocalSettings(current.settings, incoming.settings);
  const aliases = incoming.aliases?.length ? incoming.aliases : current.aliases;
  const ruled = applySenderRules(incoming.threads, settings.senderRules);
  const gated = applyGate(ruled, settings.gate, aliases);
  return {
    ...incoming,
    threads: gated.threads,
    gmail: current.gmail,
    demoCursor: 0,
    settings: { ...settings, gate: gated.book },
  };
}
