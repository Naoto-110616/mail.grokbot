import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolveDeepLink, safeDeepLinkId } from "./deep-link.ts";

const threads = [
  { id: "thr_a_example_test", messages: [{ id: "msg_1" }, { id: "msg_859543" }] },
  { id: "thr_other", messages: [{ id: "msg_2" }] },
];

describe("deep link routing", () => {
  it("opens a message id inside its thread and a thread id on its own", () => {
    assert.equal(safeDeepLinkId("msg_859543"), "msg_859543");
    assert.equal(safeDeepLinkId("thr_a_example_test"), "thr_a_example_test");
    assert.deepEqual(resolveDeepLink(threads, { messageId: "msg_859543" }), {
      threadId: "thr_a_example_test",
      focusMessageId: "msg_859543",
    });
    assert.deepEqual(resolveDeepLink(threads, { threadId: "thr_other" }), {
      threadId: "thr_other",
      focusMessageId: null,
    });
    assert.deepEqual(resolveDeepLink(threads, { messageId: "msg_859543", threadId: "thr_other" }), {
      threadId: "thr_a_example_test",
      focusMessageId: "msg_859543",
    });
  });

  it("drops unknown ids and anything that is not a single safe segment", () => {
    assert.equal(resolveDeepLink(threads, { messageId: "msg_missing" }), null);
    assert.equal(resolveDeepLink(threads, { threadId: "thr_missing" }), null);
    for (const bad of ["<script>", "../x", "msg 1", "https://evil.example", "//evil", "msg/859543", "", "a".repeat(129)]) {
      assert.equal(safeDeepLinkId(bad), null, bad);
      assert.equal(resolveDeepLink(threads, { messageId: bad }), null);
    }
  });

  it("registers /m/$messageId and /t/$threadId as real routes", () => {
    const tree = readFileSync(new URL("../../routeTree.gen.ts", import.meta.url), "utf8");
    const message = readFileSync(new URL("../../routes/m/$messageId.tsx", import.meta.url), "utf8");
    const thread = readFileSync(new URL("../../routes/t/$threadId.tsx", import.meta.url), "utf8");
    assert.match(tree, /\/m\/\$messageId/);
    assert.match(tree, /\/t\/\$threadId/);
    assert.match(message, /\/m\/\$messageId/);
    assert.match(message, /safeDeepLinkId/);
    assert.match(thread, /\/t\/\$threadId/);
    assert.match(thread, /safeDeepLinkId/);
    assert.equal(message.includes("dangerouslySetInnerHTML"), false);
    assert.equal(thread.includes("dangerouslySetInnerHTML"), false);
  });
});
