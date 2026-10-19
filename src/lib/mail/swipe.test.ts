import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyBackendData } from "./merge.ts";
import { defaultSettings, emptyMailbox, type MailData } from "./model.ts";
import {
  actionForReveal,
  defaultSwipePrefs,
  revealSwipe,
  SWIPE_ACTIONS,
  SWIPE_KEYS,
  swipeActionLabel,
  swipePrefsOf,
  swipeTone,
} from "./swipe.ts";

function mail(partial: Partial<MailData> = {}): MailData {
  return { ...emptyMailbox(), ...partial };
}

describe("swipe preferences", () => {
  it("defaults right to done and left to snooze", () => {
    const prefs = defaultSwipePrefs();
    assert.equal(actionForReveal(prefs, revealSwipe(80)!), "done");
    assert.equal(actionForReveal(prefs, revealSwipe(160)!), "done");
    assert.equal(actionForReveal(prefs, revealSwipe(-80)!), "snooze");
    assert.equal(actionForReveal(prefs, revealSwipe(-160)!), "snooze");
  });

  it("runs the action stored in each slot and drops unknown values", () => {
    const prefs = swipePrefsOf({
      rightShort: "star",
      rightLong: "delete",
      leftShort: "read",
      leftLong: "label",
    });
    assert.equal(actionForReveal(prefs, revealSwipe(80)!), "star");
    assert.equal(actionForReveal(prefs, revealSwipe(160)!), "delete");
    assert.equal(actionForReveal(prefs, revealSwipe(-80)!), "read");
    assert.equal(actionForReveal(prefs, revealSwipe(-160)!), "label");
    const dirty = swipePrefsOf({ rightShort: "pin" as "done", leftLong: "snooze" });
    assert.equal(dirty.rightShort, "done");
    assert.equal(dirty.leftLong, "snooze");
    assert.equal(swipeActionLabel("read", false), "Unread");
    assert.equal(swipeActionLabel("delete"), "Delete");
    for (const action of SWIPE_ACTIONS) {
      assert.equal(swipeTone(action).length > 0, true);
      assert.equal(SWIPE_KEYS[action].length > 0, true);
    }
  });

  it("keeps swipe prefs when a server mailbox replaces threads", () => {
    const current = mail({
      settings: { ...defaultSettings(), swipePrefs: { ...defaultSwipePrefs(), rightShort: "delete", leftShort: "star" } },
    });
    const incoming = mail({ threads: [], settings: defaultSettings() });
    const merged = applyBackendData(current, incoming);
    assert.equal(merged.settings.swipePrefs?.rightShort, "delete");
    assert.equal(merged.settings.swipePrefs?.leftShort, "star");
    assert.equal(merged.settings.density, current.settings.density);
  });
});
