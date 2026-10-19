/** Delays before each of the five wake attempts: immediately, 30s, 2m, 10m, 1h. */
export const WAKE_ATTEMPT_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000] as const;

export const WAKE_ATTEMPT_LIMIT = WAKE_ATTEMPT_DELAYS_MS.length;

/** While a POST is in flight, or after a crash, another request waits out this lease. */
export const WAKE_LEASE_MS = 120_000;

/** One request posts at most this many due wakes. Each POST times out at 8s. */
export const DUE_WAKE_CAP = 5;

export type WakePlan = { kind: "retry"; delayMs: number } | { kind: "failed" };

/**
 * `attemptCount` is how many wakes have already failed (1-based).
 * The first failure waits 30s. The fifth failure exhausts the row.
 */
export function planAfterFailure(attemptCount: number): WakePlan {
  if (!Number.isFinite(attemptCount) || attemptCount < 1) {
    return { kind: "retry", delayMs: WAKE_ATTEMPT_DELAYS_MS[1] };
  }
  if (attemptCount >= WAKE_ATTEMPT_LIMIT) return { kind: "failed" };
  return { kind: "retry", delayMs: WAKE_ATTEMPT_DELAYS_MS[attemptCount] };
}

/** Short reason stored on the row. No URL, key, or send-status wording. */
export function wakeErrorText(result: { status: number | null; error: string }): string {
  if (result.error === "timeout") return "Timed out";
  if (result.error === "unconfigured") return "Webhook is not set";
  if (result.status != null) return `HTTP ${result.status}`;
  return "Network error";
}
