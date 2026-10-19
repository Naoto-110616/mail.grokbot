import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { webkit } from "playwright";
import { projectRoot } from "./with-app-env.mjs";

const INGEST_TOKEN = "compose-phone-ingest";
const STEP_MS = 12_000;
const LOG = "/tmp/compose-phone-vite.log";
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
    if (child.exitCode != null) {
      throw new Error(`dev server exited (${child.exitCode}) before ${url} answered\n${tail()}`);
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
      last = `status ${response.status}`;
    } catch (err) {
      last = err instanceof Error ? err.name : "fetch failed";
    }
    await sleep(250);
  }
  throw new Error(`dev server did not answer ${url} (${last})\n${tail()}`);
}

function tail() {
  try {
    const text = readFileSync(LOG, "utf8");
    return text.slice(-1500);
  } catch {
    return "";
  }
}

function stopChild(child) {
  if (!child || child.exitCode != null || child.pid == null) return;
  child.kill("SIGTERM");
}

test("iPhone 393 compose signature, focus, and discard", { timeout: 180000 }, async (t) => {
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
  env.PATH = `${join(root, "node_modules", ".bin")}:${process.env.PATH ?? ""}`;
  env.NODE_ENV = "development";
  env.CI = "1";
  env.MAIL_LOCALHOST_GATE = "open";
  env.DATABASE_URL = "";
  env.DATABASE_URL_UNPOOLED = "";
  env.GBM_DEMO = "0";
  env.INGEST_TOKEN = INGEST_TOKEN;
  const logFd = openSync(LOG, "w");
  const child = spawn(
    process.execPath,
    [
      "scripts/with-app-env.mjs",
      "vite",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, env, stdio: ["ignore", logFd, logFd] },
  );
  const onStop = () => {
    stopChild(child);
    process.exit(1);
  };
  process.once("SIGTERM", onStop);
  process.once("SIGINT", onStop);

  let browser = null;
  try {
    await waitForHttp(`${origin}/`, child, 60_000);
    const seeded = await fetch(`${origin}/api/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${INGEST_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          message("msg_p0l_notes", "Notes for the reply", "Please review the notes."),
          message("msg_p0l_sig", "Signature only", "-- \nPat\npat@example.test"),
          message("msg_p0l_bare", "Bare dash", "--\nHello from the signature line\nYou"),
          message("msg_p0l_nospace", "Dash without space", "Hello\n\n--\nThis line stays visible"),
          message("msg_p0l_signed", "Signed note", "See you then.\n\n-- \nPat\npat@example.test"),
          message(
            "msg_p0l_prose",
            "Quote then prose",
            "See you then.\n\nOn Tue, Oct 13, 2026, Ada wrote:\n> The disk was fine yesterday.\n\nPlease keep this paragraph.",
          ),
        ],
      }),
    });
    if (!seeded.ok) throw new Error(`ingest failed (${seeded.status})`);

    browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: MOBILE_SAFARI,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_MS);
    page.setDefaultNavigationTimeout(STEP_MS);
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: STEP_MS });
    if (new URL(page.url()).pathname === "/login") throw new Error("localhost gate did not open");
    await page.waitForFunction(() => window.__mailReady === true, null, { timeout: STEP_MS });
    await page.getByText("Notes for the reply").first().waitFor({ timeout: STEP_MS });

    await t.test("new mail shows the signature in the body", async () => {
      await openNew(page);
      const body = await page.getByRole("textbox", { name: "Message" }).inputValue();
      assert.match(body, /^\n\n--\nYou\nyou@example\.test\n?/);
      assert.match(body, /you@example\.test/);
      const width = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      assert.ok(width.scrollWidth <= width.innerWidth, `scrollWidth ${width.scrollWidth}`);
      await page.getByRole("button", { name: "Discard" }).waitFor();
    });

    await t.test("focuses To, and a tap focuses the field again", async () => {
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "To");
      const to = await fieldStyle(page, "To");
      const message = await fieldStyle(page, "Message");
      assert.ok(to.fontSize >= 16, `To font ${to.fontSize}`);
      assert.ok(message.fontSize >= 16, `Message font ${message.fontSize}`);
      assert.match(to.fontFamily, /TwitterChirp/);
      assert.match(message.fontFamily, /TwitterChirp/);
      assert.equal(
        await page.locator("#compose-key").evaluate((el) => getComputedStyle(el).fontSize),
        "16px",
      );
      await page.evaluate(() => {
        window.__focusLog = [];
        const note = (kind, event) => {
          const target = event.target;
          const name = target.getAttribute?.("aria-label") || target.id || target.tagName;
          window.__focusLog.push(`${kind}:${name}`);
        };
        document.addEventListener("focusout", (event) => note("out", event), true);
        document.addEventListener("focusin", (event) => note("in", event), true);
      });
      await page.getByRole("textbox", { name: "To" }).click();
      const log = await page.evaluate(() => window.__focusLog);
      assert.ok(log.includes("out:To") && log.includes("in:To"), log.join(","));
      await page.getByRole("textbox", { name: "Message" }).click();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Message",
      );
      await page.getByRole("textbox", { name: "To" }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "To");
    });

    await t.test("close keeps an untouched new message out of drafts", async () => {
      await page.getByRole("button", { name: "Close and save draft" }).click();
      await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await draftSaved(page), false);
      await openFolder(page, "Drafts");
      await page.getByText("No messages").waitFor();
    });

    await t.test("close saves a draft after typing above the signature", async () => {
      await openNew(page);
      await typeAtStart(page, "Hello");
      const body = await page.getByRole("textbox", { name: "Message" }).inputValue();
      assert.match(body, /^Hello\n\n--\nYou\n/);
      await page.getByRole("button", { name: "Close and save draft" }).click();
      await page.getByRole("status", { name: "Draft saved" }).waitFor();
      await openFolder(page, "Drafts");
      await page.locator(".row").filter({ hasText: "Hello" }).waitFor();
    });

    await t.test("discard throws away the new draft", async () => {
      await page.locator(".row").filter({ hasText: "Hello" }).click();
      await page.getByRole("textbox", { name: "Message" }).waitFor();
      const reopened = await page.getByRole("textbox", { name: "Message" }).inputValue();
      assert.match(reopened, /^Hello\n\n--\nYou\n/);
      assert.equal(
        reopened.split("you@example.test").length,
        2,
        "the signature appears once in a reopened draft",
      );
      await page.getByRole("button", { name: "Discard" }).click();
      await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "hidden" });
      await page.getByText("No messages").waitFor();
    });

    await t.test("reply and forward put the signature above the quote", async () => {
      await page.getByRole("button", { name: "Inbox" }).click();
      await page.locator(".row").filter({ hasText: "Notes for the reply" }).click();
      await page.getByRole("button", { name: "Reply", exact: true }).click();
      await page.waitForFunction(() => {
        const field = document.activeElement;
        return (
          field instanceof HTMLTextAreaElement &&
          field.getAttribute("aria-label") === "Message" &&
          field.selectionStart === 0
        );
      });
      const reply = await page.getByRole("textbox", { name: "Message" }).inputValue();
      assert.match(reply, /^\n\n--\nYou\nyou@example\.test\n?/);
      assert.ok(reply.indexOf("you@example.test") < reply.indexOf("wrote:"));
      assert.ok(reply.includes("Please review the notes."));
      await dismissToast(page);
      await page.getByRole("button", { name: "Close and save draft" }).click();
      await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await draftSaved(page), false);

      await page.getByRole("button", { name: "Forward", exact: true }).click();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Message",
      );
      const forward = await page.getByRole("textbox", { name: "Message" }).inputValue();
      assert.match(forward, /^\n\n--\nYou\nyou@example\.test\n?/);
      assert.ok(forward.indexOf("you@example.test") < forward.indexOf("Forwarded message"));
      await page.getByRole("button", { name: "Close and save draft" }).click();
      await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Back to list" }).click();
    });

    await t.test("reader keeps a signature-only body and a bare dash", async () => {
      await showList(page);
      await page.getByRole("button", { name: "Inbox" }).click();
      await openThread(page, "Signature only");
      await page.getByText("pat@example.test").waitFor();
      assert.equal(await page.getByRole("button", { name: "Show quoted text" }).count(), 0);
      await page.getByRole("button", { name: "Back to list" }).click();

      await openThread(page, "Bare dash");
      await page.getByText("Hello from the signature line").waitFor();
      assert.equal(await page.getByRole("button", { name: "Show quoted text" }).count(), 0);
      await page.getByRole("button", { name: "Back to list" }).click();

      await openThread(page, "Dash without space");
      await page.getByText("This line stays visible").waitFor();
      assert.equal(await page.getByRole("button", { name: "Show quoted text" }).count(), 0);
      await page.getByRole("button", { name: "Back to list" }).click();

      await openThread(page, "Quote then prose");
      await page.getByText("Please keep this paragraph.").waitFor();
      await page.getByText("The disk was fine yesterday.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Show quoted text" }).count(), 0);
      await page.getByRole("button", { name: "Back to list" }).click();

      await openThread(page, "Signed note");
      await page.getByText("See you then.").waitFor();
      assert.equal(await page.getByText("pat@example.test").count(), 0);
      await page.getByRole("button", { name: "Show quoted text" }).click();
      await page.getByText("pat@example.test").waitFor();
      await page.getByRole("button", { name: "Back to list" }).click();
    });

    await t.test("send uses the editor text once", async () => {
      await showList(page);
      await openNew(page);
      await page.getByRole("textbox", { name: "To" }).fill("ada@example.test");
      await page.getByRole("textbox", { name: "Subject" }).fill("Sent hello");
      await typeAtStart(page, "Hello");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "hidden" });
      await openFolder(page, "Sent");
      await page.locator(".row").filter({ hasText: "Sent hello" }).click();
      const letter = page.locator("div.text-\\[17px\\]");
      await letter.getByText("Hello", { exact: true }).waitFor();
      // Like iPhone Mail, the signature stays on screen under the letter, once.
      await letter.getByText("you@example.test").waitFor();
      assert.equal(await letter.getByText("you@example.test").count(), 1);
      assert.equal(await letter.getByText("Hello", { exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Show quoted text" }).count(), 0);
    });
  } finally {
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    if (browser) await browser.close();
    stopChild(child);
  }
});

function message(id, subject, body) {
  return {
    kind: "message",
    id,
    messageId: `<${id}@example.test>`,
    from: { name: "Ada", email: "ada@example.test" },
    to: [{ name: "You", email: "you@example.test" }],
    subject,
    body,
    date: "2026-10-18T12:00:00.000Z",
    unread: true,
  };
}

async function openNew(page) {
  const send = page.getByRole("button", { name: "Send", exact: true });
  if (await send.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await send.waitFor();
}

async function openFolder(page, name) {
  await page.getByRole("button", { name: "Menu" }).click();
  const nav = page.getByRole("navigation", { name: "Mailbox" });
  await nav.waitFor();
  await nav.getByRole("button", { name, exact: true }).click();
}

async function openThread(page, subject) {
  await page.locator(".row").filter({ hasText: subject }).click();
  await page.getByRole("button", { name: "Back to list" }).waitFor();
}

async function dismissToast(page) {
  const button = page.getByRole("button", { name: "Dismiss" });
  if (await button.isVisible().catch(() => false)) await button.click();
}

async function showList(page) {
  const close = page.getByRole("button", { name: "Close and save draft" });
  if (await close.isVisible().catch(() => false)) {
    await dismissToast(page);
    await close.click();
    await page.getByRole("button", { name: "Send", exact: true }).waitFor({ state: "hidden" });
  }
  const back = page.getByRole("button", { name: "Back to list" });
  if (await back.isVisible().catch(() => false)) await back.click();
}

async function draftSaved(page) {
  return page
    .getByRole("status", { name: "Draft saved" })
    .waitFor({ state: "visible", timeout: 800 })
    .then(() => true)
    .catch(() => false);
}

async function fieldStyle(page, name) {
  return page.getByRole("textbox", { name }).evaluate((el) => {
    const style = getComputedStyle(el);
    return { fontSize: Number.parseFloat(style.fontSize), fontFamily: style.fontFamily };
  });
}

async function typeAtStart(page, text) {
  const message = page.getByRole("textbox", { name: "Message" });
  await message.click();
  await message.evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 0);
  });
  await page.keyboard.type(text);
  await page.waitForFunction((value) => {
    const field = document.querySelector("textarea[aria-label='Message']");
    return field instanceof HTMLTextAreaElement && field.value.startsWith(value);
  }, text);
}
