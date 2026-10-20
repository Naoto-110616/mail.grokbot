export interface NeonPoolConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
}

import { isCloudflareWorkers } from "./runtime.server.ts";

/** Vercel and Cloudflare Workers should use a single short-lived DB connection. */
export function isServerlessRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VERCEL === "1" || isCloudflareWorkers(env);
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
