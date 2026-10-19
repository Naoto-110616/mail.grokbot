import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackendId } from "../../lib/mail/backend.ts";
import { DEMO_ADDRESS, aliasesFor, type Alias } from "../../lib/mail/model.ts";
import { demoPublicConfig, type PublicMailConfig } from "../../lib/mail/public-config.ts";

export type MailSecrets = {
  webhookUrl: string;
  webhookKey: string;
};

export type LoadedConfig = PublicMailConfig & {
  secrets: MailSecrets | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseAliases(value: unknown, address: string, displayName: string): Alias[] {
  if (!Array.isArray(value)) return aliasesFor(address, displayName);
  const aliases: Alias[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const email = asString(row.email);
    if (!email.includes("@")) continue;
    const tag = asString(row.tag);
    aliases.push({
      email,
      tag: tag || null,
      name: asString(row.name) || (tag ? tag : displayName || "Primary"),
    });
  }
  return aliases.length > 0 ? aliases : aliasesFor(address, displayName);
}

export function parseConfig(raw: unknown): LoadedConfig {
  const demo = demoPublicConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...demo, secrets: null };
  }
  const row = raw as Record<string, unknown>;
  const backend: BackendId = "bot-bridge";
  const displayName = asString(row.displayName) || demo.displayName;
  const address = asString(row.address) || DEMO_ADDRESS;
  const webhookUrl = asString(row.webhookUrl);
  const webhookKey = asString(row.webhookKey);
  return {
    backend,
    displayName,
    address,
    aliases: parseAliases(row.aliases, address, displayName),
    configured: true,
    secrets: webhookUrl && webhookKey ? { webhookUrl, webhookKey } : null,
  };
}

export function toPublicConfig(loaded: LoadedConfig): PublicMailConfig {
  return {
    backend: loaded.backend,
    displayName: loaded.displayName,
    address: loaded.address,
    aliases: loaded.aliases,
    configured: loaded.configured,
  };
}

export async function loadMailConfig(root = process.cwd()): Promise<LoadedConfig> {
  try {
    const text = await readFile(join(root, "data", "config.json"), "utf8");
    return parseConfig(JSON.parse(text) as unknown);
  } catch {
    return { ...demoPublicConfig(), secrets: null };
  }
}

export async function publicMailConfig(root = process.cwd()): Promise<PublicMailConfig> {
  return toPublicConfig(await loadMailConfig(root));
}

export async function webhookTarget(root = process.cwd()): Promise<MailSecrets | null> {
  const loaded = await loadMailConfig(root);
  return loaded.secrets;
}
