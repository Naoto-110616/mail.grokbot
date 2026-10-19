import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanSnippet, snippetOf, WAITING_COPY, type Thread } from "./model.ts";

describe("snippet cleaning", () => {
  it("strips tracking urls, bare links, and header noise without eating prose", () => {
    const cleaned = cleanSnippet(
      [
        "From: Ada <ada@example.test>",
        "Subject: Quarterly notes",
        "Notes from the meeting are ready.",
        "Board (https://track.example/board?utm_source=newsletter&utm_campaign=spring)",
        "See [the deck](https://files.example/deck?utm_medium=email) today.",
        "https://www.example.com/only?utm_source=zzzz",
        "On Mon, Oct 5, 2026, Ada wrote:",
        "> older quoted line",
        "-- ",
        "Sent from my phone",
      ].join("\n"),
    );
    assert.equal(cleaned.includes("utm_"), false);
    assert.equal(cleaned.includes("://"), false);
    assert.equal(cleaned.includes("From:"), false);
    assert.equal(cleaned.includes("Subject:"), false);
    assert.equal(cleaned.includes("older quoted"), false);
    assert.equal(cleaned.includes("Sent from"), false);
    assert.match(cleaned, /Notes from the meeting are ready/);
    assert.match(cleaned, /Board/);
    assert.match(cleaned, /the deck/);
    assert.match(cleaned, /today/);
    assert.equal(cleaned.includes("\n"), false);
  });

  it("keeps a waiting notice and cleans the latest body", () => {
    const waiting = { messages: [{ body: "hidden", delivery: "waiting" }], draft: null } as Thread;
    assert.equal(snippetOf(waiting), WAITING_COPY);
    const noisy = {
      messages: [{ body: "Hello\nhttps://track.example/z?utm_campaign=secret", delivery: null }],
      draft: null,
    } as Thread;
    assert.equal(snippetOf(noisy), "Hello");
  });
});
