import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { webkit } from "playwright";
import { projectRoot } from "./with-app-env.mjs";

const STEP_MS = 20_000;
const MOBILE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, child, timeoutMs) {
  const started = Date.now();
  let last = "no response";
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode != null) throw new Error(`dev server exited (${child.exitCode}) before ${url} answered`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
      last = `status ${response.status}`;
    } catch (err) {
      last = err instanceof Error ? err.name : "fetch failed";
    }
    await sleep(250);
  }
  throw new Error(`dev server did not answer ${url} (${last})`);
}

function stopChild(child) {
  if (!child || child.exitCode != null || child.pid == null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

test("tapping an Outbox row opens the queued send at 393px", { timeout: 120000 }, async (t) => {
  let probe;
  try {
    probe = await webkit.launch({ headless: true });
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    t.skip(`Playwright WebKit is not runnable (${name})`);
    return;
  }
  await probe.close();

  const root = projectRoot();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.APP_PASSWORD;
  delete env.SESSION_SECRET;
  env.PATH = `${join(root, "node_modules", ".bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
  env.NODE_ENV = "development";
  env.MAIL_LOCALHOST_GATE = "open";
  env.DATABASE_URL = "";
  env.DATABASE_URL_UNPOOLED = "";
  env.INGEST_TOKEN = "outbox-view-check";
  const logFd = openSync("/tmp/outbox-view-vite.log", "w");
  const child = spawn(
    process.execPath,
    ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, env, detached: true, stdio: ["ignore", logFd, logFd] },
  );
  const held = { browser: null };
  const onAlarm = () => {
    stopChild(child);
    process.exit(1);
  };
  process.once("SIGALRM", onAlarm);
  t.after(() => {
    process.off("SIGALRM", onAlarm);
    stopChild(child);
  });

  try {
    await waitForHttp(`${origin}/`, child, 30_000);
    held.browser = await webkit.launch({ headless: true });
    const context = await held.browser.newContext({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      userAgent: MOBILE_SAFARI,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_MS);
    page.setDefaultNavigationTimeout(STEP_MS);
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname === "/login") throw new Error("localhost gate did not open");
    await page.waitForFunction(() => window.__mailReady === true, null, { timeout: STEP_MS });

    await page.getByRole("button", { name: "Compose", exact: true }).click();
    await page.getByRole("button", { name: "Send", exact: true }).waitFor();
    await page.locator("label").filter({ hasText: "To" }).locator("input").fill("ada@example.test");
    await page.locator("label").filter({ hasText: "Subject" }).locator("input").fill("Harbor note");
    await page.getByRole("textbox", { name: "Message" }).fill("The tide was quiet.");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await page.getByRole("button", { name: "Mailbox" }).click();
    const nav = page.getByRole("navigation", { name: "Mailbox" });
    await nav.waitFor();
    await nav.getByRole("button", { name: /^Outbox/ }).click();
    const row = page.getByRole("button", { name: /Harbor note/ });
    await row.waitFor();
    await row.click();

    const view = page.getByRole("region", { name: "Queued send" });
    await view.waitFor();
    const text = await view.innerText();
    assert.match(text, /From/);
    assert.match(text, /you@example\.test/);
    assert.match(text, /To/);
    assert.match(text, /ada@example\.test/);
    assert.match(text, /Cc/);
    assert.match(text, /Subject/);
    assert.match(text, /Harbor note/);
    assert.match(text, /The tide was quiet\./);
    assert.match(text, /Sending…/);
    await view.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await view.getByRole("button", { name: "Edit as draft", exact: true }).waitFor();
    assert.equal(await view.getByRole("button", { name: "Retry", exact: true }).count(), 0);

    const path = new URL(page.url()).pathname;
    assert.match(path, /^\/o\/send_/);
    await page.reload({ waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname === "/login") throw new Error("reload asked for a password");
    await page.getByRole("region", { name: "Queued send" }).waitFor();
    assert.equal(new URL(page.url()).pathname, path);
    await page.getByRole("region", { name: "Queued send" }).getByText("The tide was quiet.").waitFor();

    const measured = await page.evaluate(() => {
      const innerWidth = window.innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const offenders = [];
      for (const el of document.body.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (rect.right <= innerWidth + 1 && rect.left >= -1) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        offenders.push(
          `${el.tagName.toLowerCase()} ${String(el.className).replace(/\s+/g, " ").slice(0, 80)} right=${Math.round(rect.right)}`,
        );
        if (offenders.length >= 6) break;
      }
      return { innerWidth, scrollWidth, offenders };
    });
    assert.equal(measured.innerWidth, 393, JSON.stringify(measured));
    assert.equal(measured.scrollWidth, measured.innerWidth, JSON.stringify(measured));
  } finally {
    process.off("SIGALRM", onAlarm);
    if (held.browser) await held.browser.close();
    stopChild(child);
  }
});
