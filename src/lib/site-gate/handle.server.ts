import { env } from "../env.server.ts";
import { sessionVersionFromEnv } from "./env-security.ts";
import {
  createRateLimiter,
  handleGate,
  sessionAllowed,
  type GateDeps,
} from "./gate.ts";
import { isIngestApiPath } from "./paths.ts";
import { loadSecurity, savePasswordHash } from "./store.server.ts";

const rateLimit = createRateLimiter();

export function liveDeps(): GateDeps {
  return {
    now: () => Date.now(),
    appPassword: env("APP_PASSWORD"),
    sessionSecret: env("SESSION_SECRET"),
    getSecurity: loadSecurity,
    savePassword: savePasswordHash,
    rateLimit,
    fallbackVersion: sessionVersionFromEnv(env("SESSION_VERSION")),
  };
}

export async function handleSiteRequest(input: {
  request: Request;
  pathname: string;
  handlerType: "serverFn" | "router";
}): Promise<Response | null> {
  try {
    if (input.handlerType !== "serverFn" && isIngestApiPath(input.pathname)) {
      const { handleIngestApi } = await import("../../server/mail/ingest-api.server.ts");
      return await handleIngestApi(input.request);
    }
    return await handleGate(
      input.request,
      {
        pathname: input.pathname,
        handlerType: input.handlerType,
        dev: process.env.NODE_ENV !== "production",
      },
      liveDeps(),
    );
  } catch (err) {
    console.error("[site-gate] request failed", err instanceof Error ? err.name : "error");
    return new Response("Unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

export async function assertSiteSession(): Promise<void> {
  const { getRequest } = await import("@tanstack/react-start/server");
  let request: Request;
  try {
    request = getRequest();
  } catch {
    throw unauthorized();
  }
  let allowed = false;
  try {
    allowed = await sessionAllowed(request, liveDeps());
  } catch {
    allowed = false;
  }
  if (!allowed) throw unauthorized();
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
