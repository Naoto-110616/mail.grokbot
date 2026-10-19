/** Gesture math for inbox rows. The left screen edge stays with Safari's back swipe. */
export const SWIPE_EDGE_PX = 16;
export const SWIPE_COMMIT_PX = 72;
export const SWIPE_LONG_PX = 140;

export type SwipeLock = "undecided" | "scroll" | "swipe";
export type SwipeSide = "left" | "right";
export type SwipeDepth = "short" | "long";

export type SwipeReveal = {
  side: SwipeSide;
  depth: SwipeDepth;
  commit: boolean;
};

export function ignoreSwipeStart(clientX: number, originX = 0): boolean {
  return clientX - originX <= SWIPE_EDGE_PX;
}

/** Horizontal intent has to beat vertical movement, or the row scrolls instead. */
export function lockSwipe(dx: number, dy: number): SwipeLock {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 8 && ady < 8) return "undecided";
  if (adx > ady * 1.15 && adx >= 8) return "swipe";
  if (ady > adx) return "scroll";
  return "undecided";
}

export function revealSwipe(dx: number): SwipeReveal | null {
  const distance = Math.abs(dx);
  if (distance < 8) return null;
  return {
    side: dx > 0 ? "right" : "left",
    depth: distance >= SWIPE_LONG_PX ? "long" : "short",
    commit: distance >= SWIPE_COMMIT_PX,
  };
}

export const SWIPE_ACTIONS = ["done", "snooze", "star", "read", "delete", "label"] as const;
export type SwipeAction = (typeof SWIPE_ACTIONS)[number];
export type SwipeSlot = "rightShort" | "rightLong" | "leftShort" | "leftLong";
export type SwipePrefs = Record<SwipeSlot, SwipeAction>;

export const SWIPE_SLOTS: { id: SwipeSlot; label: string }[] = [
  { id: "rightShort", label: "Swipe right" },
  { id: "rightLong", label: "Swipe right further" },
  { id: "leftShort", label: "Swipe left" },
  { id: "leftLong", label: "Swipe left further" },
];

/** Keys already bound in the mailbox. Swipe slots stay on this same set. */
export const SWIPE_KEYS: Record<SwipeAction, string> = {
  done: "e",
  snooze: "b",
  star: "s",
  read: "I",
  delete: "#",
  label: "l",
};

export function defaultSwipePrefs(): SwipePrefs {
  return {
    rightShort: "done",
    rightLong: "done",
    leftShort: "snooze",
    leftLong: "snooze",
  };
}

export function swipePrefsOf(prefs: Partial<SwipePrefs> | null | undefined): SwipePrefs {
  const base = defaultSwipePrefs();
  if (!prefs) return base;
  const next = { ...base };
  for (const slot of Object.keys(base) as SwipeSlot[]) {
    const value = prefs[slot];
    if (value && (SWIPE_ACTIONS as readonly string[]).includes(value)) next[slot] = value;
  }
  return next;
}

export function actionForReveal(prefs: SwipePrefs, reveal: SwipeReveal): SwipeAction {
  if (reveal.side === "right") return reveal.depth === "long" ? prefs.rightLong : prefs.rightShort;
  return reveal.depth === "long" ? prefs.leftLong : prefs.leftShort;
}

export function swipeActionLabel(action: SwipeAction, unread = true): string {
  switch (action) {
    case "done":
      return "Done";
    case "snooze":
      return "Snooze";
    case "star":
      return "Star";
    case "read":
      return unread ? "Read" : "Unread";
    case "delete":
      return "Delete";
    case "label":
      return "Label";
  }
}

/** Tone classes stay on our own palette in Light, Dim, and Lights out. */
export function swipeTone(action: SwipeAction): string {
  switch (action) {
    case "done":
      return "bg-accent text-accent-fg";
    case "snooze":
      return "bg-ink text-paper";
    case "star":
      return "bg-brass text-[#0f1419]";
    case "read":
      return "bg-olive text-[#04240f]";
    case "delete":
      return "bg-danger text-white";
    case "label":
      return "bg-ink text-paper";
  }
}
