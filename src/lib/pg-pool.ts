export interface NeonPoolConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
}

/** Vercel sets `VERCEL=1` in serverless functions. Local dev leaves it unset. */
export function isServerlessRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VERCEL === "1";
}

/**
 * One connection on serverless so a warm Neon (pgbouncer) instance does not
 * hold a pool. Local and dev keep node-postgres defaults.
 */
export function neonPoolConfig(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): NeonPoolConfig {
  if (!isServerlessRuntime(env)) return { connectionString };
  return { connectionString, max: 1, idleTimeoutMillis: 5000 };
}
