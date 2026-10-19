import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { projectRoot } from "./with-app-env.mjs";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".vercel" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test("iOS fields stay at least 16px and the viewport still scales", () => {
  const root = projectRoot();
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  assert.match(css, /@supports\s*\(-webkit-touch-callout:\s*none\)\s*\{/);
  assert.match(
    css,
    /input,\s*\n\s*select,\s*\n\s*textarea,\s*\n\s*\[contenteditable\]\s*\{[^}]*font-size:\s*max\(16px,\s*1em\)/s,
  );
  assert.match(css, /--font-x:\s*"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif/);
  assert.match(css, /font-family:\s*var\(--font-x\)/);
  assert.equal(css.includes("Source Serif"), false);
  assert.equal(css.includes("Instrument Sans"), false);
  assert.equal(css.includes("@font-face"), false);
  assert.equal(css.includes("@fontsource"), false);
  const compose = readFileSync(join(root, "src/components/mail/compose.tsx"), "utf8");
  assert.equal(compose.includes("font-serif"), false);
  assert.match(compose, /text-base/);

  const files = walk(join(root, "src")).filter((path) => /\.(tsx|css|html)$/.test(path));
  files.push(join(root, "scripts/install-page.html"));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(/user-scalable\s*=\s*no/i.test(text), false, file);
    assert.equal(/maximum-scale/i.test(text), false, file);
    assert.equal(text.includes("font-serif"), false, file);
    assert.equal(text.includes("@fontsource"), false, file);
  }
});
