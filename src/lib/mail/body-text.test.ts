import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isMachineText, parseBody, plainSnippet, quotedControlLabel, type BodyBlock, type Inline, type ParsedBody } from "./body-text.ts";

function linksOf(blocks: BodyBlock[]): { href: string; label: string }[] {
  const found: { href: string; label: string }[] = [];
  const walk = (inlines: Inline[]) => {
    for (const part of inlines) if (part.kind === "link") found.push({ href: part.href, label: part.label });
  };
  for (const block of blocks) {
    if (block.kind === "p" || block.kind === "quote") walk(block.inlines);
    else if (block.kind === "list") block.items.forEach(walk);
    else if (block.kind === "links") found.push(...block.links);
  }
  return found;
}

function plain(blocks: BodyBlock[]): string {
  return blocks
    .map((block) => {
      const text = (inlines: Inline[]) => inlines.map((part) => (part.kind === "link" ? part.label : part.text)).join("");
      if (block.kind === "machine") return block.text;
      if (block.kind === "p" || block.kind === "quote") return text(block.inlines);
      if (block.kind === "list") return block.items.map(text).join("\n");
      if (block.kind === "links") return block.links.map((link) => link.label).join(" ");
      return "";
    })
    .join("\n");
}

function markup(parsed: ParsedBody): string {
  const node = (part: Inline) => {
    if (part.kind === "link") return createElement("a", { href: part.href }, part.label);
    if (part.kind === "strong") return createElement("strong", null, part.text);
    if (part.kind === "em") return createElement("em", null, part.text);
    return part.text;
  };
  const block = (item: BodyBlock, index: number) => {
    if (item.kind === "links") {
      return createElement(
        "p",
        { key: index },
        item.links.map((link, linkIndex) => createElement("a", { key: linkIndex, href: link.href }, link.label)),
      );
    }
    if (item.kind === "list") {
      return createElement(
        "ul",
        { key: index },
        item.items.map((inlines, itemIndex) => createElement("li", { key: itemIndex }, inlines.map(node))),
      );
    }
    if (item.kind === "machine") return createElement("pre", { key: index }, item.text);
    const tag = item.kind === "quote" ? "blockquote" : "p";
    return createElement(tag, { key: index }, item.inlines.map(node));
  };
  return renderToStaticMarkup(createElement(Fragment, null, parsed.blocks.map(block)));
}

describe("message body text", () => {
  it("turns bare, bracketed, and parenthetical URLs into short anchors", () => {
    const tracking = "https://track.example/c?utm_source=newsletter&utm_campaign=spring-launch-2026";
    const parsed = parseBody(
      [
        `Read the notes at ${tracking} please.`,
        `Board (https://www.example.com/board?id=99&utm_medium=email)`,
        "[Quarterly notes](https://notes.example/q3?utm_source=long)",
        "<https://files.example/a/b/c>",
      ].join("\n"),
    );
    const labels = linksOf(parsed.blocks).map((link) => link.label);
    assert.deepEqual(labels, ["track.example", "Board", "Quarterly notes", "files.example"]);
    const shown = plain(parsed.blocks);
    assert.equal(shown.includes("utm_"), false);
    assert.equal(shown.includes("://"), false);
    assert.match(shown, /Read the notes at/);
    assert.match(shown, /please/);
    const hrefs = linksOf(parsed.blocks).map((link) => link.href);
    assert.equal(hrefs.every((href) => href.startsWith("https://")), true);
    assert.match(hrefs[0] ?? "", /utm_source=newsletter/);
    assert.equal((hrefs[1] ?? "").includes("www."), true);
  });

  it("collapses a run of link-only lines into one group", () => {
    const parsed = parseBody(
      ["Intro", "", "https://www.example.com/a?utm_source=zzzzzzzz", "https://other.example/b?id=123", "", "Outro"].join(
        "\n",
      ),
    );
    const groups = parsed.blocks.filter((block) => block.kind === "links");
    assert.equal(groups.length, 1);
    assert.equal(parsed.blocks[0]?.kind, "p");
    assert.equal(parsed.blocks[2]?.kind, "p");
    assert.deepEqual(groups[0]?.kind === "links" ? groups[0].links.map((link) => link.label) : [], [
      "example.com",
      "other.example",
    ]);
    assert.equal(plain(parsed.blocks).includes("utm_"), false);
  });

  it("hides a trailing quote and signature behind the collapsed region", () => {
    const quoted = parseBody(
      ["Thanks for the note.", "", "On Mon, Oct 5, 2026, Ada wrote:", "> older line", "> second line"].join("\n"),
    );
    assert.match(plain(quoted.blocks), /Thanks for the note/);
    assert.equal(plain(quoted.blocks).includes("older line"), false);
    assert.match(plain(quoted.hidden ?? []), /older line/);
    assert.match(plain(quoted.hidden ?? []), /wrote:/);

    const signed = parseBody(["See you then.", "", "-- ", "Ada", "ada@example.test"].join("\n"));
    assert.match(plain(signed.blocks), /See you then/);
    assert.equal(plain(signed.blocks).includes("ada@example.test"), false);
    assert.match(plain(signed.hidden ?? []), /Ada/);

    const dash = parseBody(["OK", "", "—", "Ada"].join("\n"));
    assert.equal(plain(dash.blocks).trim(), "OK");
    assert.match(plain(dash.hidden ?? []), /Ada/);

    const phone = parseBody("OK\n\nSent from my phone");
    assert.equal(plain(phone.blocks).trim(), "OK");
    assert.match(plain(phone.hidden ?? []), /Sent from my phone/);

    const both = parseBody(["Hello", "", "> old", "", "-- ", "Ada"].join("\n"));
    assert.equal(plain(both.blocks).trim(), "Hello");
    assert.match(plain(both.hidden ?? []), /old/);
    assert.match(plain(both.hidden ?? []), /Ada/);

    const kept = parseBody(["> quoted", "", "After the quote"].join("\n"));
    assert.match(plain(kept.blocks), /quoted/);
    assert.match(plain(kept.blocks), /After the quote/);
    assert.equal(kept.hidden, null);

    const started = parseBody("--\nHello from the signature line\nYou");
    assert.match(plain(started.blocks), /Hello from the signature line/);
    assert.match(plain(started.blocks), /^--/m);
    assert.equal(started.hidden, null);

    const onlySig = parseBody("\n\n--\nYou\nyou@example.com");
    assert.match(plain(onlySig.blocks), /you@example.com/);
    assert.equal(onlySig.hidden, null);
  });

  it("escapes markup and refuses javascript or data links", () => {
    const nasty = [
      'Hello <script>alert("x")</script>',
      "javascript:alert(1)",
      "[click](javascript:alert(1))",
      "[click](data:text/html,hi)",
      "[ok](https://example.com/safe)",
    ].join("\n");
    const parsed = parseBody(nasty);
    const html = markup(parsed);
    assert.equal(html.includes("<script"), false);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.equal(linksOf(parsed.blocks).map((link) => link.label).join(","), "ok");
    assert.equal(
      linksOf(parsed.blocks).every((link) => link.href.startsWith("https://") || link.href.startsWith("http://")),
      true,
    );
    assert.equal(plainSnippet(nasty).includes("<script>"), true);
    assert.equal(plainSnippet(`Only ${"https://track.example/z?utm_campaign=secret-token"}`).includes("utm_"), false);
  });

  it("splits blank lines into paragraphs and keeps a short letter visible", () => {
    const parsed = parseBody("Hello,\n\nThe notes are ready.\n\nThanks");
    assert.equal(parsed.blocks.filter((block) => block.kind === "p").length, 3);
    assert.equal(parsed.hidden, null);
    assert.equal(quotedControlLabel(parsed.hidden, false), null);
  });

  it("detects machine text and groups each run into one wrapped block", () => {
    const long = `https://track.example.com/alerts/disk?host=web-1.example.com&token=${"a".repeat(40)}`;
    assert.equal(isMachineText(long), true);
    assert.equal(isMachineText(`Read the notes at ${long} please.`), false);
    assert.equal(isMachineText("select id, body from mail_message where id = 'm'"), true);
    assert.equal(isMachineText("Note: please review the attached notes today."), false);
    assert.equal(isMachineText("status: failed"), true);
    assert.equal(isMachineText("https://www.example.com/a?utm_source=zzzzzzzz"), false);
    const parsed = parseBody(
      [
        "The checker could not file this payload.",
        "",
        long,
        "",
        "{",
        '  "alert": "disk",',
        '  "host": "web-1.example.com"',
        "}",
        "",
        "host: web-1.example.com",
        "status: failed",
        "attempt: 3",
        "",
        "Please file this.",
      ].join("\n"),
    );
    const machines = parsed.blocks.filter((block) => block.kind === "machine");
    assert.equal(machines.length, 3);
    assert.equal(machines[0]?.kind === "machine" ? machines[0].text : "", long);
    assert.match(machines[1]?.kind === "machine" ? machines[1].text : "", /"alert": "disk"/);
    assert.match(machines[1]?.kind === "machine" ? machines[1].text : "", /"host": "web-1.example.com"/);
    assert.match(machines[2]?.kind === "machine" ? machines[2].text : "", /attempt: 3/);
    assert.equal(parsed.blocks[0]?.kind, "p");
    assert.equal(parsed.blocks.at(-1)?.kind, "p");
    assert.equal(plain(parsed.blocks).includes(long), true);
    const sql = parseBody("select id, body\nfrom mail_message\nwhere id = 'msg_1'");
    assert.equal(sql.blocks.length, 1);
    assert.equal(sql.blocks[0]?.kind, "machine");
  });

  it("names the quoted-text control and hides it when nothing is hidden", () => {
    assert.equal(quotedControlLabel(null, false), null);
    assert.equal(quotedControlLabel([], true), null);
    const quoted = parseBody("Thanks for the note.\n\nOn Mon, Oct 5, 2026, Ada wrote:\n> older line");
    assert.ok(quoted.hidden?.length);
    assert.equal(quotedControlLabel(quoted.hidden, false), "Show quoted text");
    assert.equal(quotedControlLabel(quoted.hidden, true), "Hide quoted text");
    const open = parseBody("Hello there.\n\nSecond paragraph.");
    assert.equal(open.hidden, null);
    assert.equal(quotedControlLabel(open.hidden, false), null);
  });
});

describe("reader rendering", () => {
  it("does not inject raw HTML", () => {
    const reader = readFileSync(new URL("../../components/mail/reader.tsx", import.meta.url), "utf8");
    assert.equal(reader.includes("dangerouslySetInnerHTML"), false);
    assert.match(reader, /parseBody/);
    assert.match(reader, /quotedControlLabel\(doc\.hidden, trimmed\)/);
    assert.match(reader, /quotedLabel \?/);
    assert.equal(reader.includes("Show trimmed content"), false);
    assert.equal(reader.includes("…"), false);
    assert.match(reader, /useState<string\[\]>\(\[\]\)/);
    assert.equal(reader.includes("plainSnippet"), false);
    assert.match(reader, /text-\[17px\]/);
    assert.match(reader, /leading-\[1\.5\]/);
    assert.match(reader, /mail-machine/);
    assert.equal(reader.includes("lg:hidden"), false);
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const machineAt = css.indexOf(".mail-machine {");
    const machine = css.slice(machineAt, css.indexOf("}", machineAt));
    assert.ok(machineAt > 0);
    assert.match(machine, /overflow-wrap:\s*anywhere/);
    assert.match(machine, /break-word/);
    assert.match(machine, /font-size:\s*16px/);
  });
});
