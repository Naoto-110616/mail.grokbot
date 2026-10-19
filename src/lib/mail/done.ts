import { isDone, type MailData, type Thread } from "./model.ts";

export const DONE_TOAST = "Marked done";
export const DONE_TOAST_LABEL = "Marked done · Undo";
export const DONE_HOLD_MS = 5_000;

export type UndoFrame = { text: string; snapshot: MailData };

export type UndoToast = {
  text: string;
  snapshot: MailData | null;
  stack?: UndoFrame[];
  holdMs?: number;
} | null;

/** New inbound mail after Done puts the thread back in the inbox. */
export function reopenDoneThread(thread: Thread): Thread {
  if (!isDone(thread) || !thread.doneAt) return thread;
  const at = Date.parse(thread.doneAt);
  if (Number.isNaN(at)) return thread;
  const fresh = thread.messages.some((message) => {
    if (message.direction === "outbound") return false;
    const when = Date.parse(message.date);
    return !Number.isNaN(when) && when > at;
  });
  if (!fresh) return thread;
  return { ...thread, location: "inbox", unread: true, doneAt: null, snoozeUntil: null };
}

export function toastLabel(text: string): string {
  return text === DONE_TOAST ? DONE_TOAST_LABEL : text;
}

/** Latest action stays on the toast. Older ones remain underneath for undo. */
export function pushUndo(current: UndoToast, text: string, snapshot: MailData, holdMs: number): Exclude<UndoToast, null> {
  const stack = [...(current?.stack ?? [])];
  if (stack.length === 0 && current?.snapshot) stack.push({ text: current.text, snapshot: current.snapshot });
  stack.push({ text, snapshot });
  const trimmed = stack.slice(-20);
  const top = trimmed[trimmed.length - 1];
  if (!top) return { text, snapshot, stack: [{ text, snapshot }], holdMs };
  return { text: top.text, snapshot: top.snapshot, stack: trimmed, holdMs };
}

export function popUndo(toast: UndoToast): { restore: MailData | null; toast: UndoToast } {
  if (!toast?.snapshot) return { restore: null, toast: null };
  const stack = toast.stack?.length ? toast.stack : [{ text: toast.text, snapshot: toast.snapshot }];
  const restore = stack[stack.length - 1]?.snapshot ?? null;
  const rest = stack.slice(0, -1);
  const top = rest[rest.length - 1];
  if (!top) return { restore, toast: null };
  return {
    restore,
    toast: { text: top.text, snapshot: top.snapshot, stack: rest, holdMs: toast.holdMs },
  };
}

/** Resolve immediately when the browser is online. Otherwise wait for `online`. */
export function waitUntilOnline(
  online: () => boolean = () => typeof navigator === "undefined" || navigator.onLine !== false,
  listen: (onOnline: () => void) => () => void = (onOnline) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  },
): Promise<void> {
  if (online()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = listen(() => {
      stop();
      resolve();
    });
  });
}
