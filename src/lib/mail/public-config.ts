import type { BackendId } from "./backend.ts";
import { type Alias, DEMO_ADDRESS, aliasesFor, defaultSettings } from "./model.ts";

/** Safe to send to the browser. Webhook URL and key are never on this type. */
export type PublicMailConfig = {
  backend: BackendId;
  displayName: string;
  address: string;
  aliases: Alias[];
  configured: boolean;
};

export function demoPublicConfig(): PublicMailConfig {
  const settings = defaultSettings();
  return {
    backend: "bot-bridge",
    displayName: settings.displayName,
    address: DEMO_ADDRESS,
    aliases: aliasesFor(DEMO_ADDRESS, settings.displayName),
    configured: false,
  };
}
