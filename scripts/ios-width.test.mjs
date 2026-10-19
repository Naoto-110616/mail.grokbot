import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { webkit } from "playwright";
import { DEVICES, PAGES, runWidthCheck } from "./ios-width.mjs";
import { projectRoot } from "./with-app-env.mjs";

test("reader wraps long urls and the viewport does not lock scale", () => {
  const root = projectRoot();
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.mail-body img,\s*\n\s*\.mail-body video \{\s*\n\s*max-width:\s*100%;/);
  assert.match(css, /\.mail-body table \{[^}]*table-layout:\s*fixed;/s);
  assert.match(css, /font-size:\s*max\(16px,\s*1em\)/);
  const viewport = readFileSync(join(root, "src/routes/__root.tsx"), "utf8");
  assert.match(viewport, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.equal(viewport.includes("maximum-scale"), false);
  assert.equal(viewport.includes("user-scalable"), false);
});

test("iPhone WebKit pages stay within the screen", { timeout: 120000 }, async (t) => {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    t.skip(`Playwright WebKit is not runnable (${name})`);
    return;
  }
  await browser.close();

  const { results, failed } = await runWidthCheck();
  assert.equal(results.length, DEVICES.length * PAGES.length);
  for (const row of results) {
    assert.ok(
      row.scrollWidth <= row.innerWidth,
      `${row.device} ${row.page} scrollWidth ${row.scrollWidth} > innerWidth ${row.innerWidth}`,
    );
  }
  assert.equal(failed.length, 0);
});
