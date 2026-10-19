/** Fixed copy. Never interpolate a password into one of these. */
export const GATE_COPY = {
  wrong: "Wrong password.",
  rate: "Too many attempts. Try again later.",
  config: "Sign-in is not available.",
  tooShort: "Use at least 10 characters.",
  tooLong: "That password is too long.",
  changed: "Password changed.",
  changeFailed: "Could not change the password.",
  needsDatabase:
    "Connect a database to change your password here, or have your bot update APP_PASSWORD",
} as const;

const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  GATE_COPY.wrong,
  GATE_COPY.rate,
  GATE_COPY.config,
  GATE_COPY.tooShort,
  GATE_COPY.tooLong,
  GATE_COPY.needsDatabase,
]);

export function loginErrorMessage(code: string | undefined): string | null {
  if (code === "wrong") return GATE_COPY.wrong;
  if (code === "rate") return GATE_COPY.rate;
  if (code === "config") return GATE_COPY.config;
  return null;
}

/** Drop anything that is not one of the fixed sentences, so a password cannot be echoed. */
export function knownGateError(value: string | undefined): string | null {
  if (!value) return null;
  return KNOWN_ERRORS.has(value) ? value : null;
}
