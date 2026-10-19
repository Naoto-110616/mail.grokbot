/** A message key that can point back at the outbound row's thread id. */
export type ThreadLinkMessage = {
  id: string;
  clientSendId?: string | null;
  messageId?: string | null;
};

function linkKeys(message: ThreadLinkMessage): string[] {
  const keys = [message.clientSendId, message.id, message.messageId];
  return keys.filter((key): key is string => typeof key === "string" && key.length > 0);
}

/**
 * Own thread state wins. Otherwise the outbound row's thread id, found by
 * client send id, message id, or RFC message id, carries trash, done, and the rest.
 */
export function linkedThreadState<T>(
  threadId: string,
  messages: readonly ThreadLinkMessage[],
  states: ReadonlyMap<string, T>,
  outboundThreadIds: ReadonlyMap<string, string>,
): T | undefined {
  if (states.has(threadId)) return states.get(threadId);
  for (const message of messages) {
    for (const key of linkKeys(message)) {
      const linked = outboundThreadIds.get(key);
      if (!linked || linked === threadId || !states.has(linked)) continue;
      return states.get(linked);
    }
  }
  return undefined;
}

/** True when this thread, or the outbound thread it reloaded from, was hidden. */
export function threadIsHidden(
  threadId: string,
  messages: readonly ThreadLinkMessage[],
  hidden: ReadonlySet<string>,
  outboundThreadIds: ReadonlyMap<string, string>,
): boolean {
  if (hidden.has(threadId)) return true;
  for (const message of messages) {
    for (const key of linkKeys(message)) {
      const linked = outboundThreadIds.get(key);
      if (linked && hidden.has(linked)) return true;
    }
  }
  return false;
}
