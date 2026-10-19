#!/usr/bin/env node
/**
 * Phone width check in Playwright WebKit (not Chromium).
 * Asserts documentElement.scrollWidth <= innerWidth on the inbox, a thread
 * opened on a fictional long-tracking-link message, compose, and the drawer.
 * The dev server is opened with MAIL_LOCALHOST_GATE=open, which the gate
 * honors only when NODE_ENV=development and the host is loopback. This script
 * does not sign in.
 * Screenshots go to ~/mail-race-review/width-check and are not part of the repo.
 *
 *   node scripts/ios-width.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { webkit } from "playwright";
import { isMainModule, projectRoot } from "./with-app-env.mjs";

const INGEST_TOKEN = "width-check-ingest";
const STEP_MS = 15_000;
const BUDGET_MS = 110_000;

const DEVICES = [
  { name: "iphone-15", width: 393, height: 852 },
  { name: "iphone-16-pro-max", width: 440, height: 956 },
];

const PAGES = ["inbox", "thread", "compose", "drawer"];

const TRACK = `https://track.example.test/click?id=${"a".repeat(180)}`;
const TOKEN = `trk_${"b".repeat(240)}`;
const LINK_LABEL = "m".repeat(78);

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

async function measure(page) {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const root = document.documentElement;
    const offenders = [];
    for (const el of document.body.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right <= innerWidth + 1 && rect.left >= -1) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        className: String(el.className).replace(/\s+/g, " ").slice(0, 160),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      });
      if (offenders.length >= 8) break;
    }
    return {
      innerWidth,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      offenders,
    };
  });
}

async function shot(page, outDir, device, name) {
  const measured = await measure(page);
  await page.screenshot({ path: join(outDir, `${device}-${name}.png`), fullPage: false });
  return { device, page: name, ...measured };
}

const MOBILE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function openMailbox(page, origin) {
  page.setDefaultTimeout(STEP_MS);
  page.setDefaultNavigationTimeout(STEP_MS);
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: STEP_MS });
  if (new URL(page.url()).pathname === "/login") throw new Error("localhost gate did not open");
  await page.waitForFunction(() => window.__mailReady === true, null, { timeout: STEP_MS });
  await page.getByText(TRACK.slice(0, 40), { exact: false }).first().waitFor({ timeout: STEP_MS });
}

async function visit(page, origin, outDir, device) {
  await openMailbox(page, origin);
  const rows = [];
  rows.push(await shot(page, outDir, device, "inbox"));

  await page.locator(".row").first().click();
  await page.getByRole("button", { name: "Reply", exact: true }).waitFor({ timeout: STEP_MS });
  rows.push(await shot(page, outDir, device, "thread"));

  await page.getByRole("button", { name: "Back to list" }).click();
  await page.locator(".row").first().waitFor({ timeout: STEP_MS });
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Send", exact: true }).waitFor({ timeout: STEP_MS });
  rows.push(await shot(page, outDir, device, "compose"));

  await page.getByRole("button", { name: "Close and save draft" }).click();
  await page.getByRole("button", { name: "Mailbox" }).click();
  await page.getByRole("navigation", { name: "Mailbox" }).waitFor({ timeout: STEP_MS });
  rows.push(await shot(page, outDir, device, "drawer"));
  return rows;
}

export async function runWidthCheck() {
  const root = projectRoot();
  const outDir = join(homedir(), "mail-race-review", "width-check");
  mkdirSync(outDir, { recursive: true });
  const held = { child: null };
  const budget = setTimeout(() => {
    console.error("width check exceeded 110s");
    stopChild(held.child);
    process.exit(1);
  }, BUDGET_MS);
  const onStop = () => {
    clearTimeout(budget);
    stopChild(held.child);
    process.exit(1);
  };
  process.once("SIGTERM", onStop);
  process.once("SIGINT", onStop);
  process.once("SIGALRM", onStop);
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
  env.INGEST_TOKEN = INGEST_TOKEN;
  const logFd = openSync("/tmp/ios-width-vite.log", "w");
  const child = spawn(
    process.execPath,
    ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, env, detached: true, stdio: ["ignore", logFd, logFd] },
  );
  held.child = child;
  const results = [];
  let browser = null;
  try {
    await waitForHttp(`${origin}/`, child, 20_000);
    const seeded = await fetch(`${origin}/api/ingest`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${INGEST_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            kind: "message",
            id: "msg_width_track",
            messageId: "<width-track@example.test>",
            from: { name: "Ada", email: "ada@example.test" },
            to: [{ name: "You", email: "you@example.test" }],
            subject: TRACK,
            body: `Open [${LINK_LABEL}](${TRACK}) when you have a moment.\n\n${TOKEN}\n\n${TRACK}`,
            date: new Date().toISOString(),
            unread: true,
          },
        ],
      }),
    });
    if (!seeded.ok) throw new Error(`ingest failed (${seeded.status})`);

    browser = await webkit.launch({ headless: true });
    for (const device of DEVICES) {
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        userAgent: MOBILE_SAFARI,
      });
      const page = await context.newPage();
      results.push(...(await visit(page, origin, outDir, device.name)));
      await context.close();
    }
  } finally {
    clearTimeout(budget);
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    process.off("SIGALRM", onStop);
    if (browser) await browser.close();
    stopChild(child);
  }

  const failed = results.filter((row) => row.scrollWidth > row.innerWidth);
  return { outDir, results, failed };
}

async function main() {
  const { outDir, results, failed } = await runWidthCheck();
  for (const row of results) {
    const mark = row.scrollWidth <= row.innerWidth ? "ok" : "OVERFLOW";
    console.log(
      `${mark} ${row.device} ${row.page} scrollWidth=${row.scrollWidth} innerWidth=${row.innerWidth} clientWidth=${row.clientWidth}`,
    );
    for (const offender of row.offenders) {
      console.log(
        `  ${offender.tag}${offender.id ? "#" + offender.id : ""} ${offender.className} left=${offender.left} right=${offender.right} width=${offender.width}`,
      );
    }
  }
  console.log(`screenshots ${outDir}`);
  if (failed.length) process.exit(1);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : "width check failed");
    process.exit(1);
  });
}

export { DEVICES, PAGES };
