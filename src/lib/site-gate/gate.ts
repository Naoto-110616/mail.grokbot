import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { PasswordStoreUnavailable } from "./env-security.ts";
import { GATE_COPY } from "./messages.ts";
import {
  LOGIN_NEXT_FIELD,
  LOGIN_PASSWORD_FIELD,
  isIngestApiPath,
  isPublicAsset,
  loginLocation,
  normalizePath,
  safeNextPath,
} from "./paths.ts";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Submitted passwords longer than this are rejected before scrypt. */
export const MAX_PASSWORD_LENGTH = 1024;
export const MIN_NEW_PASSWORD_LENGTH = 10;

export const SESSION_COOKIE = "gb_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 15 * 60 * 1000;

export interface SecurityState {
  passwordHash: string | null;
  sessionVersion: number;
}

export interface RateLimiter {
  isLimited(ip: string, now: number): boolean;
  recordFailure(ip: string, now: number): void;
  clear(ip: string): void;
}

export interface GateDeps {
  now: () => number;
  appPassword: string | undefined;
  sessionSecret: string | undefined;
  getSecurity: () => Promise<SecurityState>;
  savePassword: (passwordHash: string) => Promise<SecurityState>;
  rateLimit: RateLimiter;
  /**
   * Session version used when the store throws. Defaults to 1.
   * Live deploys pass SESSION_VERSION.
   */
  fallbackVersion?: number;
}

export interface SessionClaims {
  v: number;
  exp: number;
}

export type PasswordCheck = "match" | "miss" | "unconfigured";

export type PasswordChangeResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Compare two strings without returning early when their lengths differ.
 * Both sides are padded to the same length, then compared with timingSafeEqual.
 * The length check happens only after that compare.
 */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  const length = Math.max(a.length, b.length, 1);
  const padA = Buffer.alloc(length);
  const padB = Buffer.alloc(length);
  a.copy(padA);
  b.copy(padB);
  const equal = timingSafeEqual(padA, padB);
  return equal && a.length === b.length;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 2 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 8) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64url");
    expected = Buffer.from(parts[5] ?? "", "base64url");
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length < 16) return false;
  let key: Buffer;
  try {
    key = (await scryptAsync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    })) as Buffer;
  } catch {
    return false;
  }
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

/**
 * A stored scrypt hash wins over APP_PASSWORD. With neither, sign-in is unconfigured.
 * Oversized input still pays for one compare, then always misses.
 */
export async function checkPassword(
  password: string,
  security: SecurityState,
  appPassword: string | undefined,
): Promise<PasswordCheck> {
  const hash = security.passwordHash;
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    if (hash) {
      await verifyScrypt("nope", hash);
      return "miss";
    }
    if (appPassword) {
      safeEqual("nope", appPassword);
      return "miss";
    }
    return "unconfigured";
  }
  if (hash) {
    return (await verifyScrypt(password, hash)) ? "match" : "miss";
  }
  if (!appPassword) return "unconfigured";
  return safeEqual(password, appPassword) ? "match" : "miss";
}

export function signSession(claims: SessionClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify({ v: claims.v, exp: claims.exp }), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string, now: number): SessionClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return null;
  }
  if (!timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      v?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.v !== "number" || !Number.isInteger(parsed.v) || parsed.v < 0) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return null;
    if (parsed.exp <= now) return null;
    return { v: parsed.v, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function serializeSessionCookie(token: string, maxAge = SESSION_MAX_AGE): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 200);
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 200);
  return "unknown";
}

export function createRateLimiter(options?: { limit?: number; windowMs?: number }): RateLimiter {
  const limit = options?.limit ?? RATE_LIMIT;
  const windowMs = options?.windowMs ?? RATE_WINDOW_MS;
  const buckets = new Map<string, number[]>();

  function fresh(ip: string, now: number): number[] {
    const kept = (buckets.get(ip) ?? []).filter((stamp) => now - stamp < windowMs);
    if (kept.length === 0) buckets.delete(ip);
    else buckets.set(ip, kept);
    return kept;
  }

  return {
    isLimited(ip, now) {
      return fresh(ip, now).length >= limit;
    },
    recordFailure(ip, now) {
      const kept = fresh(ip, now);
      kept.push(now);
      buckets.set(ip, kept);
      if (buckets.size <= 5000) return;
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    },
    clear(ip) {
      buckets.delete(ip);
    },
  };
}

function versionAfterStoreFailure(deps: GateDeps): number {
  const version = deps.fallbackVersion;
  if (typeof version === "number" && Number.isInteger(version) && version >= 0) return version;
  return 1;
}

/**
 * A store failure must not become a 503. Fall back to APP_PASSWORD
 * (no stored hash) and the env session version.
 */
async function readSecurity(deps: GateDeps): Promise<SecurityState> {
  try {
    return await deps.getSecurity();
  } catch (err) {
    console.error(
      "[site-gate] security store unavailable",
      err instanceof Error ? err.name : "error",
    );
    return { passwordHash: null, sessionVersion: versionAfterStoreFailure(deps) };
  }
}

export async function sessionAllowed(request: Request, deps: GateDeps): Promise<boolean> {
  if (!deps.sessionSecret) return false;
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return false;
  const claims = verifySession(token, deps.sessionSecret, deps.now());
  if (!claims) return false;
  const security = await readSecurity(deps);
  return claims.v === security.sessionVersion;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function redirect(location: string, status = 302, extra?: Record<string, string>): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return new Response(null, { status, headers });
}

async function readCredentials(
  request: Request,
): Promise<{ password: string; next: string | null }> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown> | null;
      const password = body?.[LOGIN_PASSWORD_FIELD];
      const next = body?.[LOGIN_NEXT_FIELD];
      return {
        password: typeof password === "string" ? password : "",
        next: typeof next === "string" ? next : null,
      };
    }
    const form = await request.formData();
    const password = form.get(LOGIN_PASSWORD_FIELD);
    const next = form.get(LOGIN_NEXT_FIELD);
    return {
      password: typeof password === "string" ? password : "",
      next: typeof next === "string" ? next : null,
    };
  } catch {
    return { password: "", next: null };
  }
}

async function login(request: Request, deps: GateDeps): Promise<Response> {
  const ip = clientIp(request.headers);
  const now = deps.now();
  const { password, next } = await readCredentials(request);
  if (deps.rateLimit.isLimited(ip, now)) {
    return redirect(loginLocation("rate", next), 303, { "retry-after": "60" });
  }
  if (!deps.sessionSecret) return redirect(loginLocation("config", next), 303);
  const security = await readSecurity(deps);
  const verdict = await checkPassword(password, security, deps.appPassword);
  if (verdict === "unconfigured") return redirect(loginLocation("config", next), 303);
  if (verdict !== "match") {
    deps.rateLimit.recordFailure(ip, now);
    return redirect(loginLocation("wrong", next), 303);
  }
  deps.rateLimit.clear(ip);
  const token = signSession(
    { v: security.sessionVersion, exp: now + SESSION_MAX_AGE * 1000 },
    deps.sessionSecret,
  );
  const headers = new Headers({
    location: safeNextPath(next) ?? "/",
    "cache-control": "no-store",
    "set-cookie": serializeSessionCookie(token),
  });
  return new Response(null, { status: 303, headers });
}

/**
 * Decide one HTTP request.
 * `null` means the route or server function may run.
 * Anything else is the full response (redirect, 401, or the login result).
 */
export async function handleGate(
  request: Request,
  ctx: { pathname: string; handlerType: "serverFn" | "router"; dev: boolean },
  deps: GateDeps,
): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const pathname = normalizePath(ctx.pathname);

  if (ctx.handlerType === "serverFn") {
    if (await sessionAllowed(request, deps)) return null;
    return unauthorized();
  }

  if (isPublicAsset(pathname, ctx.dev)) return null;

  if (isIngestApiPath(pathname)) return null;

  if (pathname === "/login") {
    if (method === "POST") return login(request, deps);
    if (method === "GET" || method === "HEAD") {
      if (await sessionAllowed(request, deps)) {
        const next = safeNextPath(new URL(request.url).searchParams.get("next"));
        return redirect(next ?? "/");
      }
      return null;
    }
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD, POST", "cache-control": "no-store" },
    });
  }

  if (await sessionAllowed(request, deps)) return null;

  if (method === "GET" || method === "HEAD") {
    const url = new URL(request.url);
    const next = safeNextPath(pathname + url.search);
    return redirect(loginLocation(undefined, next));
  }
  return unauthorized();
}

export async function changePassword(
  input: { current: string; next: string; ip: string },
  deps: GateDeps,
): Promise<PasswordChangeResult> {
  const now = deps.now();
  if (deps.rateLimit.isLimited(input.ip, now)) {
    return { ok: false, error: GATE_COPY.rate };
  }
  if (!deps.sessionSecret) return { ok: false, error: GATE_COPY.config };
  const security = await readSecurity(deps);
  const verdict = await checkPassword(input.current, security, deps.appPassword);
  if (verdict === "unconfigured") return { ok: false, error: GATE_COPY.config };
  if (verdict !== "match") {
    deps.rateLimit.recordFailure(input.ip, now);
    return { ok: false, error: GATE_COPY.wrong };
  }
  if (input.next.length < MIN_NEW_PASSWORD_LENGTH) {
    return { ok: false, error: GATE_COPY.tooShort };
  }
  if (input.next.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: GATE_COPY.tooLong };
  }
  const passwordHash = await hashPassword(input.next);
  let saved: SecurityState;
  try {
    saved = await deps.savePassword(passwordHash);
  } catch (err) {
    if (err instanceof PasswordStoreUnavailable) {
      return { ok: false, error: GATE_COPY.needsDatabase };
    }
    throw err;
  }
  deps.rateLimit.clear(input.ip);
  const token = signSession(
    { v: saved.sessionVersion, exp: now + SESSION_MAX_AGE * 1000 },
    deps.sessionSecret,
  );
  return { ok: true, token };
}
