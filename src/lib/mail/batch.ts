/** True when a bulk Done should ask before it runs. The threshold is above 500. */
export function needsBulkConfirm(count: number): boolean {
  return count > 500;
}

/** Fewer than half starred stars the set. A tie or a majority removes the star. */
export function starKind(threads: { starred: boolean }[]): "starOn" | "starOff" {
  const starred = threads.filter((thread) => thread.starred).length;
  return starred * 2 < threads.length ? "starOn" : "starOff";
}

/** Fewer than half unread marks the set unread. Otherwise mark it read. */
export function readKind(threads: { unread: boolean }[]): "read" | "unread" {
  const unread = threads.filter((thread) => thread.unread).length;
  return unread * 2 < threads.length ? "unread" : "read";
}
