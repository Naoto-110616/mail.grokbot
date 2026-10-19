export type ThreadableMessage = {
  id: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  date: string;
  deliveredTo: string | null;
  threadHint?: string | null;
};

const REPLY_PREFIX = /^(re|fwd|fw|aw|sv|antw)\s*:\s*/i;

export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return trimmed || null;
}

export function normalizeSubject(subject: string): string {
  let current = subject.trim().toLowerCase();
  let previous = "";
  while (current && current !== previous) {
    previous = current;
    current = current.replace(REPLY_PREFIX, "").trim();
  }
  return current;
}

export function isReplySubject(subject: string): boolean {
  return REPLY_PREFIX.test(subject.trim());
}

export function plusTagFromDeliveredTo(deliveredTo: string | null | undefined): string | null {
  if (!deliveredTo) return null;
  const email = (deliveredTo.match(/<([^>]+)>/)?.[1] ?? deliveredTo).trim().toLowerCase();
  const local = email.split("@")[0] ?? "";
  const plusAt = local.indexOf("+");
  if (plusAt < 0) return null;
  const tag = local.slice(plusAt + 1).replace(/\.+$/, "");
  if (!tag) return null;
  try {
    return decodeURIComponent(tag) || null;
  } catch {
    return tag;
  }
}

export function threadPlusTag(messages: { date: string; deliveredTo: string | null }[]): string | null {
  const ordered = messages.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  for (const message of ordered) {
    const tag = plusTagFromDeliveredTo(message.deliveredTo);
    if (tag) return tag;
  }
  return null;
}

function dateValue(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function hintKey(message: ThreadableMessage): string | null {
  const raw = message.threadHint;
  if (typeof raw !== "string") return null;
  const hint = raw.trim().toLowerCase();
  return hint || null;
}

/**
 * Group messages by threadHint, then In-Reply-To / References / Message-ID,
 * then a single normalized-subject fallback.
 * A reply-shaped message with no header match joins the single best thread
 * that shares its normalized subject. Same-subject mail that is not a reply
 * stays separate. Two messages with different thread hints do not merge.
 */
export function groupByHeaders<T extends ThreadableMessage>(messages: T[]): T[][] {
  const parent = new Map<string, string>();
  for (const message of messages) parent.set(message.id, message.id);

  const find = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current) ?? current;
    return current;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const hintOf = new Map(messages.map((message) => [message.id, hintKey(message)]));
  const byHint = new Map<string, string>();
  for (const message of messages) {
    const hint = hintOf.get(message.id);
    if (!hint) continue;
    const prior = byHint.get(hint);
    if (prior) union(prior, message.id);
    else byHint.set(hint, message.id);
  }
  const hintsConflict = (a: string, b: string): boolean => {
    const left = hintOf.get(a);
    const right = hintOf.get(b);
    return Boolean(left && right && left !== right);
  };

  const byMessageId = new Map<string, string>();
  for (const message of messages) {
    const messageId = normalizeMessageId(message.messageId);
    if (messageId && !byMessageId.has(messageId)) byMessageId.set(messageId, message.id);
  }

  const headerLinked = new Set<string>();
  for (const message of messages) {
    const refs = [message.inReplyTo, ...message.references];
    for (const ref of refs) {
      const other = byMessageId.get(normalizeMessageId(ref) ?? "");
      if (!other || other === message.id || hintsConflict(message.id, other)) continue;
      union(message.id, other);
      headerLinked.add(message.id);
      headerLinked.add(other);
    }
  }

  const components = () => {
    const groups = new Map<string, T[]>();
    for (const message of messages) {
      const root = find(message.id);
      const list = groups.get(root) ?? [];
      list.push(message);
      groups.set(root, list);
    }
    return groups;
  };

  const initial = components();
  for (const [root, list] of initial) {
    if (list.some((message) => headerLinked.has(message.id))) continue;
    if (!list.some((message) => isReplySubject(message.subject))) continue;
    const subject = normalizeSubject(list.find((message) => isReplySubject(message.subject))?.subject ?? "");
    if (!subject) continue;
    const leftHint = list.map((message) => hintOf.get(message.id)).find((hint) => hint) ?? null;
    const matches = [...initial.entries()].filter(([other, msgs]) => {
      if (other === root) return false;
      const rightHint = msgs.map((message) => hintOf.get(message.id)).find((hint) => hint) ?? null;
      if (leftHint && rightHint && leftHint !== rightHint) return false;
      return msgs.some((message) => normalizeSubject(message.subject) === subject);
    });
    const headerMatches = matches.filter(([, msgs]) => msgs.some((message) => headerLinked.has(message.id)));
    const pool = headerMatches.length > 0 ? headerMatches : matches;
    if (pool.length !== 1) continue;
    union(root, pool[0][0]);
  }

  return [...components().values()].map((list) => list.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date)));
}
