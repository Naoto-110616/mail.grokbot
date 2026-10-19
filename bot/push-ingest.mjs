#!/usr/bin/env node
/**
 * POST an ingest JSON file to the app.
 * The URL comes from GBM_INGEST_URL, or GBM_APP_ORIGIN plus GBM_INGEST_PATH.
 * The bearer token comes from GBM_INGEST_TOKEN or INGEST_TOKEN.
 * The bot keeps it in ~/.config/grokbot-mail/ with chmod 600 and never prints it.
 *
 *   node bot/push-ingest.mjs items.json
 */
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REQUEST_MAX_BYTES } from "./ingest-shape.mjs";

export function ingestUrl(env) {
  const direct = String(env.GBM_INGEST_URL ?? "").trim();
  if (direct) return direct;
  const origin = String(env.GBM_APP_ORIGIN ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!origin) return "";
  let path = String(env.GBM_INGEST_PATH ?? "").trim();
  if (!path) path = "/api/ingest";
  if (!path.startsWith("/")) path = `/${path}`;
  return `${origin}${path}`;
}

export function bearerToken(env) {
  const named = String(env.GBM_INGEST_TOKEN ?? "").trim();
  if (named) return named;
  return String(env.INGEST_TOKEN ?? "").trim();
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * Post `body`. Prints nothing. Rejects with code `usage`, `no_token`, `too_large`, or `network`.
 * The returned error string is the API error code, when the response has one.
 */
export async function pushIngest(body, env, fetchImpl = globalThis.fetch) {
  const url = ingestUrl(env);
  if (!url) throw fail("usage");
  const token = bearerToken(env);
  if (!token) throw fail("no_token");
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bytes.byteLength > REQUEST_MAX_BYTES) throw fail("too_large");
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: bytes,
    });
  } catch {
    throw fail("network");
  }
  let error = "";
  try {
    const parsed = JSON.parse(await response.text());
    if (parsed && typeof parsed.error === "string") error = parsed.error.slice(0, 80);
  } catch {
    error = "";
  }
  return { status: response.status, error };
}

function inputPath(argv, env) {
  const positional = argv.filter((arg) => arg && !arg.startsWith("-"));
  return positional[0] || String(env.GBM_INGEST_FILE ?? "").trim();
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

function usage() {
  console.error("Usage: node bot/push-ingest.mjs <file>");
  console.error(
    "Set GBM_INGEST_URL, or GBM_APP_ORIGIN and optional GBM_INGEST_PATH (default /api/ingest).",
  );
  console.error(
    "Set GBM_INGEST_TOKEN or INGEST_TOKEN. The bot keeps it in ~/.config/grokbot-mail/ with chmod 600 and never prints it.",
  );
}

async function main() {
  const env = process.env;
  if (!ingestUrl(env)) {
    usage();
    process.exit(2);
  }
  const file = inputPath(process.argv.slice(2), env);
  if (!file || !bearerToken(env)) {
    usage();
    process.exit(2);
  }
  let body;
  try {
    body = await readFile(file);
  } catch {
    console.error("invalid");
    process.exit(1);
  }
  if (body.byteLength > REQUEST_MAX_BYTES) {
    console.error("too large");
    process.exit(1);
  }
  try {
    const result = await pushIngest(body, env);
    console.log(result.error ? `${result.status} ${result.error}` : String(result.status));
    process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
  } catch {
    console.error("network");
    process.exit(1);
  }
}

if (isDirectRun()) {
  main();
}
