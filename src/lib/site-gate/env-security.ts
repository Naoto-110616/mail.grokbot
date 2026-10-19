import type { SecurityState } from "./gate.ts";

/** Empty or whitespace `DATABASE_URL` means this deploy has no database. */
export function databaseConfigured(databaseUrl: string | undefined): boolean {
  return Boolean(databaseUrl?.trim());
}

/**
 * Non-negative integer from `SESSION_VERSION`.
 * Missing or invalid values use 1 so cookies can be revoked by bumping the env var.
 */
export function sessionVersionFromEnv(raw: string | undefined): number {
  if (typeof raw !== "string") return 1;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 1;
  const version = Number(trimmed);
  if (!Number.isSafeInteger(version)) return 1;
  return version;
}

/** `APP_PASSWORD` auth with no stored hash. */
export function securityWithoutDatabase(sessionVersionRaw: string | undefined): SecurityState {
  return {
    passwordHash: null,
    sessionVersion: sessionVersionFromEnv(sessionVersionRaw),
  };
}

/** A password change was requested where no database is configured. */
export class PasswordStoreUnavailable extends Error {
  constructor() {
    super("password store unavailable");
    this.name = "PasswordStoreUnavailable";
  }
}
