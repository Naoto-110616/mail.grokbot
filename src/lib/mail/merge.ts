import { applyInboxCategories } from "./category.ts";
import { applyGate } from "./gate.ts";
import { hydrateDisplaySettings, keepLocalSettings, type MailData } from "./model.ts";

/** Keep browser prefs when a server mailbox replaces threads. Bootstrap and refresh can take the server copy. */
export function applyBackendData(
  current: MailData,
  incoming: MailData,
  options?: { settingsFrom?: "server" },
): MailData {
  const settings =
    options?.settingsFrom === "server"
      ? hydrateDisplaySettings(incoming.settings, current.settings)
      : keepLocalSettings(current.settings, incoming.settings);
  const aliases = incoming.aliases?.length ? incoming.aliases : current.aliases;
  const ruled = applyInboxCategories(incoming.threads, settings.senderRules);
  const gated = applyGate(ruled, settings.gate, aliases);
  return {
    ...incoming,
    threads: gated.threads,
    gmail: current.gmail,
    demoCursor: 0,
    settings: { ...settings, gate: gated.book },
  };
}
