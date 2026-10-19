/** Browser view of the saved Grok Bot webhook. The sender key is never on this type. */

export type HeaderMode = "bearer" | "x-webhook-key";

export type BotConnectionView = {
  webhookUrl: string;
  headerMode: HeaderMode;
  keySet: boolean;
};

export const HEADER_MODE_OPTIONS: { value: HeaderMode; label: string }[] = [
  { value: "bearer", label: "Authorization: Bearer <key>" },
  { value: "x-webhook-key", label: "X-Webhook-Key: <key>" },
];

export function headerModeOf(value: unknown): HeaderMode {
  return value === "x-webhook-key" ? "x-webhook-key" : "bearer";
}

/** Drop the key. `keySet` is the only signal the browser gets. */
export function toBotConnectionView(spec: {
  webhookUrl: string;
  webhookKey: string;
  headerMode: HeaderMode;
}): BotConnectionView {
  return {
    webhookUrl: spec.webhookUrl,
    headerMode: headerModeOf(spec.headerMode),
    keySet: spec.webhookKey.trim().length > 0,
  };
}
