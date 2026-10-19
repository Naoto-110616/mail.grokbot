export type DeepLinkTarget = {
  threadId: string;
  /** Set for /m/<message id> so that message opens even when it is not the latest. */
  focusMessageId: string | null;
};

/** Ingest message ids and thread ids are a single safe path segment. */
export function safeDeepLinkId(value: string | null | undefined): string | null {
  if (!value || value.length > 128) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return null;
  return value;
}

export function resolveDeepLink(
  threads: { id: string; messages: { id: string }[] }[],
  target: { messageId?: string | null; threadId?: string | null },
): DeepLinkTarget | null {
  const messageId = safeDeepLinkId(target.messageId);
  if (messageId) {
    const thread = threads.find((item) => item.messages.some((message) => message.id === messageId));
    if (!thread) return null;
    return { threadId: thread.id, focusMessageId: messageId };
  }
  const threadId = safeDeepLinkId(target.threadId);
  if (threadId && threads.some((item) => item.id === threadId)) {
    return { threadId, focusMessageId: null };
  }
  return null;
}
