#!/usr/bin/env node
/**
 * Map an outbox replyTo.ingestId to the bot inbox message id.
 * msg_<n> (n is 0 or a decimal integer without leading zeros) is n.
 * Any other id is looked up in the ids map the converter writes.
 * The path is --map, else GBM_IDS_MAP, else ~/.config/grokbot-mail/ids.json.
 * This script never prints the ingest token.
 *
 *   node bot/reply-id.mjs msg_42
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const INTEGER = /^(0|[1-9]\d*)$/;

/** A bot inbox id: 0 or a decimal integer with no leading zeros. */
export function canonicalInboxId(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return String(value);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!INTEGER.test(text)) return null;
  return text;
}

/** The n in msg_<n>, or null when the ingest id is not that form. */
export function inboxIdFromIngestId(ingestId) {
  if (typeof ingestId !== "string") return null;
  const match = /^msg_(0|[1-9]\d*)$/.exec(ingestId.trim());
  return match ? match[1] : null;
}

/** Pull replyTo.ingestId from a string, a replyTo object, or an outbox item. */
export function readIngestId(input) {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("{")) {
      try {
        return readIngestId(JSON.parse(trimmed));
      } catch {
        return "";
      }
    }
    return trimmed;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  if (typeof input.ingestId === "string") return input.ingestId.trim();
  const nested = input.replyTo;
  if (nested && typeof nested === "object" && typeof nested.ingestId === "string") {
    return nested.ingestId.trim();
  }
  return "";
}

/**
 * Bot inbox message id for an outbox replyTo.
 * The msg_<n> form wins. The map is only the fallback.
 * Returns the id string, or null when it cannot be resolved.
 */
export function replyInboxId(input, map = {}) {
  const ingestId = readIngestId(input);
  if (!ingestId) return null;
  const direct = inboxIdFromIngestId(ingestId);
  if (direct !== null) return direct;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  return canonicalInboxId(map[ingestId]);
}

/** Flat object of ingest id → bot inbox id. Other values are dropped. */
export function normalizeIdsMap(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    const name = key.trim();
    const id = canonicalInboxId(entry);
    if (!name || name.includes("\0") || id === null) continue;
    out[name] = id;
  }
  return out;
}

export function idsMapPath(env = process.env, home = homedir()) {
  const set = String(env.GBM_IDS_MAP ?? "").trim();
  if (set) return set;
  return join(home, ".config", "grokbot-mail", "ids.json");
}

export async function loadIdsMap(path) {
  if (!path) return {};
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw Object.assign(new Error("map"), { code: "map" });
  }
  try {
    return normalizeIdsMap(JSON.parse(text));
  } catch {
    throw Object.assign(new Error("map"), { code: "map" });
  }
}

/** Merge entries into the map file. Mode 600. No-op when there is nothing to add. */
export async function mergeIdsMap(path, entries) {
  const incoming = normalizeIdsMap(entries);
  if (!path || Object.keys(incoming).length === 0) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let prior = {};
  try {
    const text = await readFile(path, "utf8");
    try {
      prior = normalizeIdsMap(JSON.parse(text));
    } catch {
      throw Object.assign(new Error("map"), { code: "map" });
    }
  } catch (err) {
    if (err && err.code === "ENOENT") prior = {};
    else throw err && err.code === "map" ? err : Object.assign(new Error("map"), { code: "map" });
  }
  const merged = { ...prior, ...incoming };
  const tmp = join(dirname(path), `.ids-${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(tmp, path);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // The temp file is the only leftover. The destination is unchanged.
    }
    throw Object.assign(new Error("map"), { code: "map", cause: err });
  }
  await chmod(path, 0o600);
}

function takeArgs(argv) {
  let mapPath = "";
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--map") {
      const next = argv[i + 1] ?? "";
      if (!next || next.startsWith("-")) return { error: "usage" };
      mapPath = next;
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }
  return { mapPath, value: positional[0] ?? "" };
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
  console.error("Usage: node bot/reply-id.mjs [--map <file>] <ingestId or JSON>");
  console.error("Prints the bot inbox message id for an outbox replyTo.ingestId.");
  console.error("msg_<n> is n. Any other id is looked up in the ids map.");
  console.error("The map path is --map, GBM_IDS_MAP, or ~/.config/grokbot-mail/ids.json.");
}

async function main() {
  const args = takeArgs(process.argv.slice(2));
  if (args.error || !args.value) {
    usage();
    process.exit(2);
  }
  const direct = inboxIdFromIngestId(readIngestId(args.value));
  if (direct !== null) {
    console.log(direct);
    return;
  }
  const path = args.mapPath || idsMapPath(process.env);
  let map;
  try {
    map = await loadIdsMap(path);
  } catch {
    console.error("map");
    process.exit(1);
  }
  const found = replyInboxId(args.value, map);
  if (!found) {
    console.error("not found");
    process.exit(1);
  }
  console.log(found);
}

if (isDirectRun()) {
  main();
}
