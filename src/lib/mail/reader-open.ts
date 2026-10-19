/**
 * Which message headers show From, To, and the date.
 * A single message stays collapsed. A thread opens that block on the latest message.
 * Message bodies are not gated on this list.
 */
export function initialHeaderOpenIds(ids: readonly string[]): string[] {
  if (ids.length < 2) return [];
  const last = ids[ids.length - 1];
  return last ? [last] : [];
}
