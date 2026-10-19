/** Paths that skip the password gate. `/login` is handled separately. */
const PUBLIC_FILES = new Set(["/favicon.ico", "/favicon.svg", "/og.jpg"]);

/** Posted by the login form. The gate reads these exact names. */
export const LOGIN_PASSWORD_FIELD = "password";
export const LOGIN_NEXT_FIELD = "next";

export function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/** Bearer-authenticated ingest. The cookie gate does not cover these paths. */
export function isIngestApiPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/api/ingest" || path.startsWith("/api/ingest/");
}

/**
 * Static files, and the Vite module graph while developing.
 * Production stays narrow so an unknown path cannot fall through to the app.
 */
export function isPublicAsset(pathname: string, dev: boolean): boolean {
  const path = normalizePath(pathname);
  if (PUBLIC_FILES.has(path)) return true;
  if (path.startsWith("/assets/")) return true;
  if (path.startsWith("/__grok/")) return true;
  if (!dev) return false;
  return (
    path.startsWith("/@") ||
    path.startsWith("/src/") ||
    path.startsWith("/node_modules/") ||
    path.startsWith("/__vite") ||
    path === "/__app-env"
  );
}

function hasControlOrSpace(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127 || char.trim() === "") return true;
  }
  return false;
}

/** A same-origin relative path we are willing to send someone back to after login. */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\") || value.includes("://") || value.includes("\0")) return null;
  if (hasControlOrSpace(value) || /[<>"'`]/.test(value)) return null;
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return null;
  return value;
}

export function loginLocation(error?: string, next?: string | null): string {
  const params = new URLSearchParams();
  if (error) params.set("e", error);
  const safe = safeNextPath(next);
  if (safe) params.set("next", safe);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
