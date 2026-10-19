import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertInput } from "./convert-ingest.mjs";
import {
  canonicalInboxId,
  idsMapPath,
  inboxIdFromIngestId,
  mergeIdsMap,
  replyInboxId,
} from "./reply-id.mjs";

const script = fileURLToPath(new URL("./reply-id.mjs", import.meta.url));
const convertScript = fileURLToPath(new URL("./convert-ingest.mjs", import.meta.url));

function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
}

test("msg_<n> is the bot inbox id, and the map is only a fallback", () => {
  assert.equal(inboxIdFromIngestId("msg_42"), "42");
  assert.equal(inboxIdFromIngestId("msg_0"), "0");
  assert.equal(inboxIdFromIngestId("msg_00"), null);
  assert.equal(inboxIdFromIngestId("msg_01"), null);
  assert.equal(inboxIdFromIngestId("msg_deadbeef"), null);
  assert.equal(canonicalInboxId(42), "42");
  assert.equal(canonicalInboxId("42"), "42");
  assert.equal(canonicalInboxId("042"), null);
  assert.equal(canonicalInboxId(-1), null);

  assert.equal(replyInboxId("msg_42"), "42");
  assert.equal(replyInboxId({ ingestId: "msg_7", subject: "Parent" }), "7");
  assert.equal(
    replyInboxId({ id: "send_1", replyTo: { ingestId: "msg_7", subject: "Parent" } }),
    "7",
  );
  assert.equal(replyInboxId("msg_42", { msg_42: "99" }), "42");
  assert.equal(replyInboxId("msg_deadbeef", { msg_deadbeef: 15 }), "15");
  assert.equal(replyInboxId("msg_deadbeef", { msg_deadbeef: "015" }), null);
  assert.equal(replyInboxId("msg_missing", {}), null);
  assert.equal(replyInboxId(""), null);
});

test("the converter uses msg_<n> and writes a fallback only for a custom id", () => {
  const numeric = convertInput(
    JSON.stringify({
      id: 42,
      from: "ada@example.com",
      subject: "Notes",
      body: "Hello",
      deliveredTo: "you+ops@example.com",
      account: "primary",
    }),
  );
  assert.equal(numeric.items[0].id, "msg_42");
  assert.equal(numeric.items[0].deliveredTo, "you+ops@example.com");
  assert.equal(numeric.items[0].account, "primary");
  assert.deepEqual(numeric.ids, {});

  const prefixed = convertInput(
    JSON.stringify({
      id: "msg_9",
      from: "ada@example.com",
      subject: "Notes",
      body: "Hello",
    }),
  );
  assert.equal(prefixed.items[0].id, "msg_9");
  assert.deepEqual(prefixed.ids, {});

  const custom = convertInput(
    JSON.stringify({
      id: "msg_custom",
      inboxId: 15,
      from: "ada@example.com",
      subject: "Notes",
      body: "Hello",
      deliveredTo: "you+books@example.com",
      account: "books",
    }),
  );
  assert.equal(custom.items[0].id, "msg_custom");
  assert.equal(custom.items[0].deliveredTo, "you+books@example.com");
  assert.deepEqual(custom.ids, { msg_custom: "15" });
  assert.equal(replyInboxId({ replyTo: { ingestId: "msg_custom" } }, custom.ids), "15");

  const renamed = convertInput(
    JSON.stringify({
      id: "msg_42",
      inboxId: "99",
      from: "ada@example.com",
      subject: "Notes",
      body: "Hello",
    }),
  );
  assert.equal(renamed.items[0].id, "msg_99");
  assert.deepEqual(renamed.ids, {});
  assert.equal(replyInboxId(renamed.items[0].id), "99");
});

test("idsMapPath follows GBM_IDS_MAP and otherwise the config directory", () => {
  assert.equal(idsMapPath({ GBM_IDS_MAP: "  ids.json  " }, "/tmp/unused"), "ids.json");
  assert.equal(
    idsMapPath({}, "/tmp/home"),
    join("/tmp/home", ".config", "grokbot-mail", "ids.json"),
  );
});

test("the CLI prints n for msg_<n> and reads the map the converter writes", async () => {
  const direct = run(["msg_42"]);
  assert.equal(direct.status, 0);
  assert.equal(direct.stdout, "42\n");
  assert.equal(direct.stderr, "");

  const item = run([JSON.stringify({ replyTo: { ingestId: "msg_0", subject: "Parent" } })]);
  assert.equal(item.status, 0);
  assert.equal(item.stdout, "0\n");

  const usage = run([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage/);
  assert.equal(usage.stdout, "");

  const emptyHome = mkdtempSync(join(tmpdir(), "reply-empty-"));
  const missing = run(["msg_custom"], { HOME: emptyHome });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /not found/);

  const dir = mkdtempSync(join(tmpdir(), "reply-id-"));
  const mapPath = join(dir, "ids.json");
  await mergeIdsMap(mapPath, { msg_custom: 15, skip: "nope" });
  assert.equal(statSync(mapPath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(mapPath, "utf8")), { msg_custom: "15" });

  const looked = run(["--map", mapPath, "msg_custom"]);
  assert.equal(looked.status, 0);
  assert.equal(looked.stdout, "15\n");
  assert.equal(looked.stderr, "");

  const home = mkdtempSync(join(tmpdir(), "reply-home-"));
  const source = join(dir, "message.json");
  writeFileSync(
    source,
    JSON.stringify({
      id: "msg_custom",
      botMessageId: 15,
      from: "ada@example.com",
      to: "you+ops@example.com",
      subject: "Notes",
      body: "Hello",
      deliveredTo: "you+ops@example.com",
      account: "primary",
    }),
  );
  const converted = spawnSync(process.execPath, [convertScript, source], {
    env: { PATH: process.env.PATH, HOME: home },
    encoding: "utf8",
  });
  assert.equal(converted.status, 0, converted.stderr);
  const printed = JSON.parse(converted.stdout);
  assert.deepEqual(Object.keys(printed), ["items"]);
  assert.equal(printed.items[0].id, "msg_custom");
  assert.equal(printed.items[0].deliveredTo, "you+ops@example.com");
  assert.equal(printed.items[0].account, "primary");
  const written = join(home, ".config", "grokbot-mail", "ids.json");
  assert.equal(statSync(written).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(written, "utf8")), { msg_custom: "15" });

  const fromHome = run(["msg_custom"], { HOME: home });
  assert.equal(fromHome.status, 0);
  assert.equal(fromHome.stdout, "15\n");

  const override = join(dir, "override.json");
  const again = spawnSync(process.execPath, [convertScript, source], {
    env: { PATH: process.env.PATH, HOME: home, GBM_IDS_MAP: override },
    encoding: "utf8",
  });
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(JSON.parse(readFileSync(override, "utf8")), { msg_custom: "15" });
  assert.equal(statSync(override).mode & 0o777, 0o600);

  const prior = join(dir, "prior.json");
  writeFileSync(prior, `${JSON.stringify({ msg_old: "3" })}\n`, { mode: 0o600 });
  const second = join(dir, "second.json");
  writeFileSync(
    second,
    JSON.stringify({
      id: "msg_other",
      inboxId: 8,
      from: "ada@example.com",
      subject: "Other",
      body: "Hi",
    }),
  );
  await mergeIdsMap(prior, { msg_other: "8" });
  assert.deepEqual(JSON.parse(readFileSync(prior, "utf8")), { msg_old: "3", msg_other: "8" });

  const badMap = join(dir, "bad.json");
  writeFileSync(badMap, "{", { mode: 0o600 });
  const broken = run(["--map", badMap, "msg_custom"]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /^map\n$/);
  assert.equal(broken.stdout, "");
});
