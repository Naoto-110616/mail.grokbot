/**
 * Runtime hints for serverless / edge deploys where Node fs and long-lived pools
 * are unavailable. Vercel sets VERCEL=1; Cloudflare Workers set CF_PAGES or the
 * deploy can set NITRO_PRESET=cloudflare_module at build time (inlined below).
 */
type ImportMetaWithCf = ImportMeta & { env?: { __CLOUDFLARE_DEPLOY__?: string } };

export function isCloudflareWorkers(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.CF_PAGES === "1") return true;
  if (env.CLOUDFLARE_WORKERS === "1") return true;
  const preset = (env.NITRO_PRESET ?? "").toLowerCase();
  if (preset === "cloudflare_module" || preset === "cloudflare_pages") return true;
  if (
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMetaWithCf).env?.__CLOUDFLARE_DEPLOY__ === "true"
  ) {
    return true;
  }
  return false;
}

/** True when the process should not rely on a writable local data/ tree. */
export function lacksWritableLocalData(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VERCEL === "1" || isCloudflareWorkers(env);
}
