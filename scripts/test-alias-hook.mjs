import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

/**
 * Resolve `@/` for node:test. `OUTBOX_STUB_DB=1` keeps sendMailbox from
 * opening PGLite when the webhook-unset test imports the server module.
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/db" && process.env.OUTBOX_STUB_DB === "1") {
    return nextResolve(new URL("./test-stub-db.mjs", import.meta.url).href, context);
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const candidates = [rel];
    if (!/\.(ts|tsx|mts|js|mjs|cjs|json)$/.test(rel)) {
      candidates.push(`${rel}.ts`, `${rel}.tsx`, `${rel}.js`, `${rel}.mjs`);
    }
    for (const candidate of candidates) {
      const full = join(srcRoot, candidate);
      if (existsSync(full)) return nextResolve(pathToFileURL(full).href, context);
    }
  }
  return nextResolve(specifier, context);
}
