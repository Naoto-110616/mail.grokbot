/**
 * Development-only switch so a local width check can open the shell.
 * Production (`NODE_ENV=production`) never honors it, even on loopback.
 * The flag is `MAIL_LOCALHOST_GATE=open`. Any other value stays closed.
 */

export function loopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let value = host.trim().toLowerCase();
  if (!value || value.includes("/") || value.includes("@") || /\s/.test(value)) return false;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end <= 1) return false;
    value = value.slice(1, end);
  } else {
    const colon = value.lastIndexOf(":");
    if (colon > 0 && /^\d+$/.test(value.slice(colon + 1))) value = value.slice(0, colon);
  }
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

/**
 * True only for a development process, the exact flag, and a loopback host.
 * The URL host and the Host header must both be loopback when both exist,
 * so a forwarded or spoofed host cannot open a public name.
 */
export function localhostGateOpen(input: {
  nodeEnv: string | undefined;
  flag: string | undefined;
  urlHost: string | null | undefined;
  headerHost: string | null | undefined;
}): boolean {
  if (input.nodeEnv !== "development") return false;
  if (input.flag !== "open") return false;
  if (!loopbackHost(input.urlHost)) return false;
  if (input.headerHost && !loopbackHost(input.headerHost)) return false;
  return true;
}

export function requestLocalhostGateOpen(request: Request): boolean {
  let urlHost: string | null = null;
  try {
    urlHost = new URL(request.url).host;
  } catch {
    urlHost = null;
  }
  return localhostGateOpen({
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.MAIL_LOCALHOST_GATE,
    urlHost,
    headerHost: request.headers.get("host"),
  });
}
