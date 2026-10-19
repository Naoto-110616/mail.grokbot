import type { Sql } from "@/lib/db";
import type { SendRequest } from "@/lib/mail/backend";
import { insertOutgoing, localDemo } from "@/lib/mail/adapters/local-demo";
import {
  type ActKind,
  type Alias,
  type Category,
  type Draft,
  type Filter,
  type Label,
  type Location,
  type MailData,
  type Message,
  type Swatch,
  type Thread,
  DEMO_ADDRESS,
  QUEUED_TOAST,
  aliasesFor,
  defaultAliases,
  defaultSettings,
  signatureFor,
  uid,
} from "@/lib/mail/model";
import { reopenDoneThread } from "@/lib/mail/done";
import { canonicalOutboxStatus, type OutboxItem } from "@/lib/mail/outbox";
import { replyWebhook, syncWebhook } from "@/lib/mail/webhook-body";
import { deliverConfigured } from "./bridge.server.ts";
import { loadMailConfig, type LoadedConfig } from "./config.server.ts";
import { loadStoredIngest } from "./ingest-api.server.ts";
import {
  applySendResults,
  deliveryForStatus,
  withOutboundOwner,
  type IngestIdentity,
  type SendResult,
} from "./ingest.server.ts";

const SWATCHES: Swatch[] = ["teal", "ink", "brass", "olive", "rose"];
const LOCATIONS = new Set<Location>(["inbox", "archive", "spam", "trash", "drafts"]);
const CATEGORIES = new Set<Category>(["primary", "social", "updates", "promotions"]);

type ThreadState = {
  location: Location;
  labels: string[];
  starred: boolean;
  important: boolean;
  unread: boolean;
  muted: boolean;
  snoozeUntil: string | null;
  category: Category;
  doneAt: string | null;
};

type OutboundRow = {
  clientSendId: string;
  threadId: string | null;
  message: Message;
  status: string;
  error: string | null;
  providerMessageId: string | null;
};

type Overlay = {
  threads: Map<string, ThreadState>;
  hidden: Set<string>;
  labels: Label[];
  filters: Filter[];
  drafts: Map<string, Draft>;
  outbound: OutboundRow[];
  outbox: OutboxItem[];
};

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "t" || value === "true";
}

function readJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function asLocation(value: string): Location {
  return LOCATIONS.has(value as Location) ? (value as Location) : "inbox";
}

function asCategory(value: string): Category {
  return CATEGORIES.has(value as Category) ? (value as Category) : "primary";
}

function asSwatch(value: string): Swatch {
  return SWATCHES.includes(value as Swatch) ? (value as Swatch) : "teal";
}

function resolveIdentity(
  account: IngestIdentity | null,
  config: LoadedConfig,
): { address: string; displayName: string; aliases: Alias[] } | null {
  if (account?.address) {
    const aliases = account.aliases.length > 0 ? account.aliases : aliasesFor(account.address, account.displayName || "You");
    return { address: account.address, displayName: account.displayName || "You", aliases };
  }
  if (config.configured) {
    return { address: config.address, displayName: config.displayName, aliases: config.aliases };
  }
  return null;
}

async function sqlOrNull(): Promise<Sql | null> {
  try {
    const { getSql } = await import("@/lib/db");
    return await getSql();
  } catch {
    return null;
  }
}

async function readOverlay(): Promise<Overlay | null> {
  const sql = await sqlOrNull();
  if (!sql) return null;
  try {
    const threads = new Map<string, ThreadState>();
    const stateRows = await sql<{
      thread_id: string;
      location: string;
      labels_json: string;
      starred: boolean;
      important: boolean;
      unread: boolean;
      muted: boolean;
      snooze_until: string | null;
      category: string;
      done_at: string | null;
    }>`select thread_id, location, labels_json, starred, important, unread, muted, snooze_until, category, done_at from mail_thread_state`;
    for (const row of stateRows) {
      const labels = readJson<unknown>(row.labels_json);
      threads.set(row.thread_id, {
        location: asLocation(row.location),
        labels: Array.isArray(labels) ? labels.filter((item): item is string => typeof item === "string") : [],
        starred: asBool(row.starred),
        important: asBool(row.important),
        unread: asBool(row.unread),
        muted: asBool(row.muted),
        snoozeUntil: row.snooze_until || null,
        category: asCategory(row.category),
        doneAt: row.done_at || null,
      });
    }

    const hiddenRows = await sql<{ thread_id: string }>`select thread_id from mail_hidden`;
    const hidden = new Set(hiddenRows.map((row) => row.thread_id));

    const labelRows = await sql<{ id: string; name: string; swatch: string }>`select id, name, swatch from mail_label`;
    const labelsOut: Label[] = labelRows.map((row) => ({ id: row.id, name: row.name, swatch: asSwatch(row.swatch) }));

    const filterRows = await sql<{ id: string; spec: string }>`select id, spec from mail_filter`;
    const filters: Filter[] = [];
    for (const row of filterRows) {
      const spec = readJson<Filter>(row.spec);
      if (spec && typeof spec === "object") filters.push({ ...spec, id: row.id });
    }

    const draftRows = await sql<{ thread_id: string; spec: string }>`select thread_id, spec from mail_draft`;
    const drafts = new Map<string, Draft>();
    for (const row of draftRows) {
      const spec = readJson<Draft>(row.spec);
      if (spec && typeof spec === "object") drafts.set(row.thread_id, spec);
    }

    const outboundRows = await sql<{
      client_send_id: string;
      thread_id: string | null;
      spec: string;
      status: string;
      error: string | null;
      provider_message_id: string | null;
      created_at: string;
    }>`select client_send_id, thread_id, spec, status, error, provider_message_id, created_at from mail_outbound order by created_at asc`;
    const outbound: OutboundRow[] = [];
    const outbox: OutboxItem[] = [];
    for (const row of outboundRows) {
      const message = readJson<Message>(row.spec);
      if (!message) continue;
      const stored: OutboundRow = {
        clientSendId: row.client_send_id,
        threadId: row.thread_id,
        message: { ...message, clientSendId: row.client_send_id },
        status: row.status,
        error: row.error,
        providerMessageId: row.provider_message_id,
      };
      outbound.push(stored);
      const status = canonicalOutboxStatus(row.status);
      if (!status) continue;
      outbox.push({
        id: row.client_send_id,
        fromAddress: message.from?.email ?? "",
        to: (message.to ?? []).map((address) => address.email).filter((email) => email.includes("@")),
        cc: (message.cc ?? []).map((address) => address.email).filter((email) => email.includes("@")),
        subject: message.subject ?? "",
        text: message.body ?? "",
        status,
        error: row.error,
        createdAt: row.created_at || message.date,
      });
    }

    return { threads, hidden, labels: labelsOut, filters, drafts, outbound, outbox };
  } catch {
    return null;
  }
}

function applyState(thread: Thread, state: ThreadState | undefined): Thread {
  if (!state) return thread;
  return {
    ...thread,
    location: state.location,
    labels: state.labels,
    starred: state.starred,
    important: state.important,
    unread: state.unread,
    muted: state.muted,
    snoozeUntil: state.snoozeUntil,
    category: state.category,
    doneAt: state.doneAt,
  };
}

function mergeOutbound(threads: Thread[], outbound: OutboundRow[], results: SendResult[], hidden: Set<string>): Thread[] {
  const next = threads.map((thread) => ({ ...thread, messages: thread.messages.map((message) => ({ ...message })) }));
  for (const row of outbound) {
    if (canonicalOutboxStatus(row.status) === "sent") {
      const sentId = row.providerMessageId ? `msg_${row.providerMessageId}` : null;
      const present = next.some((thread) =>
        thread.messages.some(
          (item) =>
            item.clientSendId === row.clientSendId ||
            (sentId !== null && item.id === sentId) ||
            (row.providerMessageId !== null && item.messageId === row.providerMessageId),
        ),
      );
      if (present) continue;
    }
    let message = applySendResults([row.message], results)[0] ?? row.message;
    if (!results.some((result) => result.clientSendId === row.clientSendId)) {
      message = { ...message, delivery: deliveryForStatus(row.status), clientSendId: row.clientSendId };
    }
    const carrier = next.find((thread) =>
      thread.messages.some(
        (item) => item.clientSendId === row.clientSendId || (message.messageId && item.messageId === message.messageId),
      ),
    );
    if (carrier) {
      carrier.messages = carrier.messages.map((item) =>
        item.clientSendId === row.clientSendId || (message.messageId && item.messageId === message.messageId)
          ? { ...item, ...message, clientSendId: row.clientSendId }
          : item,
      );
      continue;
    }
    if (row.threadId && hidden.has(row.threadId)) continue;
    const host = row.threadId ? next.find((thread) => thread.id === row.threadId) : undefined;
    if (host) {
      host.messages = [...host.messages, message].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      continue;
    }
    const id = row.threadId || `thr_${row.clientSendId}`;
    if (hidden.has(id)) continue;
    next.unshift({
      id,
      subject: message.subject || "(no subject)",
      category: "primary",
      location: "archive",
      labels: [],
      plusTag: null,
      starred: false,
      important: false,
      unread: false,
      muted: false,
      snoozeUntil: null,
      messages: [message],
      draft: null,
      account: "grokbot",
    });
  }
  return next;
}

export async function loadBridgeMailbox(current: MailData | null, root = process.cwd()): Promise<MailData> {
  const config = await loadMailConfig(root);
  let ingest;
  try {
    ingest = await loadStoredIngest();
  } catch (err) {
    console.error("[mail] load failed", err instanceof Error ? err.name : "error");
    ingest = { identity: null, threads: [] as Thread[], messages: [], sendResults: [] as SendResult[] };
  }
  const identity = resolveIdentity(ingest.identity, config);
  const overlay = await readOverlay();
  const hidden = overlay?.hidden ?? new Set<string>();
  let threads = ingest.threads
    .map((thread) => reopenDoneThread(applyState(thread, overlay?.threads.get(thread.id))))
    .filter((thread) => !hidden.has(thread.id));
  threads = mergeOutbound(threads, overlay?.outbound ?? [], ingest.sendResults, hidden);
  const owner = {
    name: identity?.displayName || current?.settings.displayName || defaultSettings().displayName,
    email: identity?.address || current?.settings.defaultFrom || defaultSettings().defaultFrom,
  };
  threads = threads.map((thread) => ({
    ...thread,
    messages: thread.messages.map((message) => withOutboundOwner(message, owner)),
  }));

  const drafts = overlay?.drafts ?? new Map<string, Draft>();
  threads = threads.map((thread) => (drafts.has(thread.id) ? { ...thread, draft: drafts.get(thread.id) ?? thread.draft } : thread));
  for (const [id, draft] of drafts) {
    if (hidden.has(id) || threads.some((thread) => thread.id === id)) continue;
    const state = overlay?.threads.get(id);
    const tag = (identity?.aliases ?? current?.aliases ?? []).find((alias) => alias.email === draft.from)?.tag ?? null;
    threads.unshift({
      id,
      subject: draft.subject.trim() || "(no subject)",
      category: state?.category ?? "primary",
      location: state?.location ?? "drafts",
      labels: state?.labels ?? [],
      plusTag: tag,
      starred: state?.starred ?? false,
      important: state?.important ?? false,
      unread: false,
      muted: state?.muted ?? false,
      snoozeUntil: state?.snoozeUntil ?? null,
      messages: [],
      draft,
      account: "grokbot",
    });
  }

  const prefs = current?.settings ?? defaultSettings();
  const aliases = identity?.aliases?.length
    ? identity.aliases
    : current?.aliases?.length
      ? current.aliases
      : defaultAliases();
  const signatureIsCustom =
    prefs.signature.trim() !== "" && prefs.signature !== signatureFor(prefs.displayName, prefs.defaultFrom);
  const settings = identity
    ? {
        ...prefs,
        displayName: identity.displayName,
        defaultFrom: identity.address,
        signature: signatureIsCustom ? prefs.signature : signatureFor(identity.displayName, identity.address),
      }
    : prefs;
  return {
    threads,
    labels: overlay?.labels ?? current?.labels ?? [],
    filters: overlay?.filters ?? current?.filters ?? [],
    aliases,
    demoCursor: 0,
    gmail: "off",
    hiddenThreadIds: [...hidden],
    settings,
    outbox: overlay?.outbox ?? current?.outbox ?? [],
  };
}

async function persistMailbox(data: MailData): Promise<void> {
  const sql = await sqlOrNull();
  if (!sql) return;
  try {
    const threads = data.threads.filter((thread) => thread.account !== "gmail");
    for (const thread of threads) {
      await sql`insert into mail_thread_state (
        thread_id, location, labels_json, starred, important, unread, muted, snooze_until, category, done_at
      ) values (
        ${thread.id},
        ${thread.location},
        ${JSON.stringify(thread.labels)},
        ${thread.starred},
        ${thread.important},
        ${thread.unread},
        ${thread.muted},
        ${thread.snoozeUntil},
        ${thread.category},
        ${thread.doneAt ?? null}
      )
      on conflict (thread_id) do update set
        location = excluded.location,
        labels_json = excluded.labels_json,
        starred = excluded.starred,
        important = excluded.important,
        unread = excluded.unread,
        muted = excluded.muted,
        snooze_until = excluded.snooze_until,
        category = excluded.category,
        done_at = excluded.done_at`;
    }

    await sql`delete from mail_hidden`;
    for (const id of data.hiddenThreadIds ?? []) {
      await sql`insert into mail_hidden (thread_id) values (${id}) on conflict (thread_id) do nothing`;
    }

    await sql`delete from mail_label`;
    for (const label of data.labels) {
      await sql`insert into mail_label (id, name, swatch) values (${label.id}, ${label.name}, ${label.swatch})`;
    }

    await sql`delete from mail_filter`;
    for (const filter of data.filters) {
      await sql`insert into mail_filter (id, spec) values (${filter.id}, ${JSON.stringify(filter)})`;
    }

    await sql`delete from mail_draft`;
    for (const thread of threads) {
      if (!thread.draft) continue;
      await sql`insert into mail_draft (thread_id, spec, updated_at) values (
        ${thread.id},
        ${JSON.stringify(thread.draft)},
        ${thread.draft.updatedAt}
      )`;
    }

    for (const thread of threads) {
      for (const message of thread.messages) {
        if (!message.clientSendId) continue;
        const status = message.delivery === "failed" ? "failed" : message.delivery === "sent" ? "sent" : "queued";
        await sql`insert into mail_outbound (client_send_id, thread_id, spec, status, created_at, updated_at) values (
          ${message.clientSendId},
          ${thread.id},
          ${JSON.stringify(message)},
          ${status},
          ${message.date},
          ${message.date}
        ) on conflict (client_send_id) do update set
          thread_id = excluded.thread_id,
          spec = case
            when mail_outbound.status in ('sent', 'declined', 'failed', 'cancelled', 'awaiting_approval') then mail_outbound.spec
            else excluded.spec
          end`;
      }
    }
  } catch {
    // Product state stays in memory for this process. Do not log the driver error.
  }
}

function assertMail(data: MailData): MailData {
  if (!data || !Array.isArray(data.threads) || !data.settings || !Array.isArray(data.aliases)) {
    throw new Error("invalid mail data");
  }
  return data;
}

export async function actMailbox(data: MailData, kind: ActKind, ids: string[]): Promise<MailData> {
  const next = await localDemo.act(assertMail(data), kind, ids);
  await persistMailbox(next);
  return next;
}

export async function snoozeMailbox(data: MailData, at: number, ids: string[]): Promise<MailData> {
  const next = await localDemo.snooze(assertMail(data), at, ids);
  await persistMailbox(next);
  return next;
}

export async function setLabelMailbox(data: MailData, labelId: string, ids: string[]): Promise<{ data: MailData; added: boolean }> {
  const current = assertMail(data);
  if (!labelId || ids.length === 0) {
    await persistMailbox(current);
    return { data: current, added: false };
  }
  const next = await localDemo.setLabels(current, labelId, ids);
  await persistMailbox(next.data);
  return next;
}

export async function saveDraftMailbox(data: MailData, draft: Draft, threadId: string | null): Promise<MailData> {
  const next = await localDemo.saveDraft(assertMail(data), draft, threadId);
  await persistMailbox(next);
  return next;
}

function latestIngestCursor(data: MailData): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const thread of data.threads) {
    if (thread.account === "gmail") continue;
    for (const message of thread.messages) {
      if (message.clientSendId) continue;
      const ms = Date.parse(message.date);
      if (Number.isNaN(ms) || ms <= bestMs) continue;
      bestMs = ms;
      best = message.date;
    }
  }
  return best;
}

export async function syncMailbox(data: MailData, root = process.cwd()): Promise<{ data: MailData; notice: string; delivery: "sent" | "failed" }> {
  const current = assertMail(data);
  const woke = await deliverConfigured(syncWebhook(latestIngestCursor(current)), root);
  const loaded = await loadBridgeMailbox(current, root);
  if (!woke.ok) {
    return { data: loaded, notice: "Could not reach the bot.", delivery: "failed" };
  }
  return { data: loaded, notice: "Checked for new mail.", delivery: "sent" };
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "example.test";
}

function waitingMessage(data: MailData, request: SendRequest, clientSendId: string): Message {
  const id = uid();
  const fromEmail = request.from || data.settings.defaultFrom || DEMO_ADDRESS;
  const reply = request.threadId
    ? data.threads.find((thread) => thread.id === request.threadId)?.messages.find((message) => message.id === request.replyToId)
    : undefined;
  const prior = reply?.references ?? [];
  const inReplyTo = request.replyToMessageId ?? reply?.messageId ?? null;
  return {
    id,
    messageId: `<${id}@${domainOf(fromEmail)}>`,
    inReplyTo,
    references: inReplyTo ? [...prior, inReplyTo] : prior,
    deliveredTo: null,
    account: "primary",
    from: { name: request.displayName || data.settings.displayName, email: fromEmail },
    to: request.to,
    cc: request.cc,
    bcc: request.bcc,
    subject: request.subject,
    body: request.body,
    date: new Date().toISOString(),
    attachments: request.attachments,
    delivery: "waiting",
    clientSendId,
  };
}

async function stampOutbound(clientSendId: string, replyToMessageId: string | null, threadKey: string | null): Promise<void> {
  const sql = await sqlOrNull();
  if (!sql) return;
  try {
    await sql.query(
      `update mail_outbound
       set reply_to_message_id = $2, thread_key = $3, updated_at = $4
       where client_send_id = $1`,
      [clientSendId, replyToMessageId, threadKey, new Date().toISOString()],
    );
  } catch {
    // The queued row is still listed. The bot falls back to an empty reply target.
  }
}

function withOutboxItem(data: MailData, request: SendRequest, clientSendId: string): MailData {
  const item: OutboxItem = {
    id: clientSendId,
    fromAddress: request.from,
    to: request.to.map((address) => address.email),
    cc: request.cc.map((address) => address.email),
    subject: request.subject,
    text: request.body,
    status: "queued",
    error: null,
    createdAt: new Date().toISOString(),
  };
  return { ...data, outbox: [item, ...(data.outbox ?? []).filter((row) => row.id !== clientSendId)] };
}

export async function sendMailbox(data: MailData, request: SendRequest, root = process.cwd()) {
  const current = assertMail(data);
  const clientSendId = `send_${uid()}`;
  const message = waitingMessage(current, request, clientSendId);
  const next = withOutboxItem(insertOutgoing(current, request, message), request, clientSendId);
  await persistMailbox(next);
  await stampOutbound(clientSendId, request.replyToId, request.threadId);
  const woke = await deliverConfigured(
    replyWebhook({
      clientSendId,
      from: message.from.email,
      to: request.to.map((address) => address.email),
      cc: request.cc.map((address) => address.email),
      bcc: [],
      subject: request.subject,
      text: request.body,
      replyToMessageId: request.replyToMessageId,
      threadId: request.threadId,
      attachments: request.attachments,
    }),
    root,
  );
  if (!woke.ok && woke.error !== "unconfigured") {
    return { data: next, notice: "Grok Bot did not wake. This reply was not sent.", delivery: "waiting" as const };
  }
  return { data: next, notice: QUEUED_TOAST, delivery: "waiting" as const };
}
