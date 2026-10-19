import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { projectRoot } from "./with-app-env.mjs";

test("settings closes the drawer and the toast clears the phone tab bar", () => {
  const root = projectRoot();
  const store = readFileSync(join(root, "src/lib/mail/store.ts"), "utf8");
  const overlays = readFileSync(join(root, "src/components/mail/overlays.tsx"), "utf8");
  const bits = readFileSync(join(root, "src/components/mail/bits.tsx"), "utf8");
  const compose = readFileSync(join(root, "src/components/mail/compose.tsx"), "utf8");

  assert.match(store, /setSettings:\s*\(settingsOpen\)\s*=>\s*\n\s*set\(settingsOpen \? \{ settingsOpen: true, drawer: false \}/);
  assert.match(overlays, /z-\[80\]/);
  assert.match(overlays, /bottom-\[calc\(6\.75rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.equal(compose.includes("font-serif"), false);
  assert.equal(store.includes("buildSeed("), false);
  const list = readFileSync(join(root, "src/components/mail/thread-list.tsx"), "utf8");
  assert.match(list, /No mail yet\. Your bot will deliver new mail here\./);
  assert.match(compose, /env\(safe-area-inset-top\)/);
  const shell = readFileSync(join(root, "src/components/mail/shell.tsx"), "utf8");
  const sidebar = readFileSync(join(root, "src/components/mail/sidebar.tsx"), "utf8");
  assert.match(shell, /placeholder="Search mail"/);
  assert.match(shell, /\{label\}/);
  assert.match(sidebar, /grokbot/);
  assert.equal(sidebar.includes("Add Gmail"), false);
  assert.equal(sidebar.includes("Gmail"), false);
  assert.equal(overlays.includes(">Gmail<"), false);
  assert.equal(shell.includes("GmailAsk"), false);
  assert.match(bits, /env\(safe-area-inset-bottom\)/);
});
