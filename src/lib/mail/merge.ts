import { applySenderRules } from "./bundles.ts";
import { applyGate } from "./gate.ts";
import { keepLocalSettings, settingsFromUnknown, type MailData } from "./model.ts";

/** Keep browser prefs when a server mailbox replaces threads. Bootstrap and refresh can take the server copy. */
export function applyBackendData(
  current: MailData,
  incoming: MailData,
  options?: { settingsFrom?: "server" },
): MailData {
  const serverSettings = options?.settingsFrom === "server" ? settingsFromUnknown(incoming.settings) : null;
  const settings = serverSettings ?? keepLocalSettings(current.settings, incoming.settings);
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
