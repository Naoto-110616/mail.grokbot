import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getActiveBackend, setActiveBackend } from "@/lib/mail/active-backend";
import { demoFromAddress, demoMine, plusFallback } from "@/lib/mail/adapters/local-demo";
import type { AttachmentBody, BackendId, SendRequest } from "@/lib/mail/backend";
import { fetchPublicMailConfig, retryOutboxSend } from "@/lib/mail/mail-rpc";
import { needsBulkConfirm } from "@/lib/mail/batch";
import { applySenderRules, upsertSenderRule } from "@/lib/mail/bundles";
import { acceptStoredSenders, applyGate, blockDomain, decideSenders as decideSenderBook, gateBookOf, migrateSavedGate, type GateMode } from "@/lib/mail/gate";
import { buildQuickRequest, quickRepliesOf } from "@/lib/mail/quick";
import { recentSearchesOf, savedSearchesOf } from "@/lib/mail/search";
import { applyBackendData } from "@/lib/mail/merge";
import {
  type AccountId,
  type ActKind,
  type Attachment,
  type Category,
  type DraftMode,
  type Filter,
  type FolderId,
  type MailData,
  type Settings,
  type Swatch,
  type Thread,
  SWATCHES,
  QUEUED_TOAST,
  accountOf,
  activityIso,
  applyAct,
  clearDraftThread,
  emptyMailbox,
  hideThreadIds,
  parseAddressList,
  replyFields,
  savedDraftThreadId,
  shouldPersistDraft,
  snapshotOf,
  uid,
  visibleThreads,
  withSignature,
} from "@/lib/mail/model";
import { DONE_HOLD_MS, DONE_TOAST, popUndo, pushUndo, waitUntilOnline } from "@/lib/mail/done";

export type ComposeModel = {
  mode: DraftMode;
  threadId: string | null;
  draftThreadId: string | null;
  replyToId: string | null;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  showCc: boolean;
  showBcc: boolean;
  subject: string;
  body: string;
  attachments: Attachment[];
  minimized: boolean;
  expanded: boolean;
};

export type ToastModel = {
  text: string;
  snapshot: MailData | null;
  stack?: { text: string; snapshot: MailData }[];
  holdMs?: number;
} | null;

type UI = {
  folder: FolderId;
  category: Category | "all";
  query: string;
  openId: string | null;
  /** Message to expand when a /m/<id> link opened this thread. */
  focusMessageId: string | null;
  checked: string[];
  anchor: number | null;
  cursor: number;
  viewing: "list" | "thread";
  /** Inbox mixes threads marked done back into the list. */
  showDone: boolean;
  /** Ids chosen by a swipe when the row is not open or checked. */
  gestureIds: string[] | null;
  /** Full list of new senders, with accept-all and block-all. */
  gateList: boolean;
  /** Long-press Select mode. Not persisted. */
  selecting: boolean;
  /** Ids loaded for Cmd-A and the list checkbox. Not persisted. */
  listedIds: string[];
  /** Done is waiting for a confirm because the selection is over 500. */
  pendingDone: string[] | null;
  drawer: boolean;
  palette: boolean;
  help: boolean;
  settingsOpen: boolean;
  snoozeOpen: boolean;
  labelMenu: boolean;
  compose: ComposeModel | null;
  toast: ToastModel;
};

type State = MailData &
  UI & {
    backendId: BackendId;
    connect: () => Promise<void>;
    refresh: () => Promise<void>;
    loadAttachment: (attachment: Attachment) => Promise<AttachmentBody | null>;
    setFolder: (folder: FolderId) => void;
    setCategory: (category: Category | "all") => void;
    setQuery: (query: string) => void;
    openThread: (id: string) => void;
    focusMessage: (id: string | null) => void;
    backToList: () => void;
    setShowDone: (showDone: boolean) => void;
    toggleCheck: (id: string, index: number) => void;
    shiftCheck: (index: number, ids: string[]) => void;
    checkVisible: (ids: string[]) => void;
    selectUnread: (ids: string[]) => void;
    selectAll: (ids: string[]) => void;
    setSelecting: (selecting: boolean) => void;
    setListedIds: (ids: string[]) => void;
    clearChecks: () => void;
    dismissPendingDone: () => void;
    setCursor: (cursor: number) => void;
    setDrawer: (drawer: boolean) => void;
    setPalette: (palette: boolean) => void;
    setHelp: (help: boolean) => void;
    setSettings: (settingsOpen: boolean) => void;
    setSnooze: (snoozeOpen: boolean) => void;
    setLabelMenu: (labelMenu: boolean) => void;
    openSnoozeFor: (ids: string[]) => void;
    openLabelFor: (ids: string[]) => void;
    targetIds: () => string[];
    act: (kind: ActKind, ids?: string[], opts?: { confirmed?: boolean }) => void;
    snoozeFor: (at: number, ids?: string[]) => void;
    toggleLabel: (labelId: string, ids?: string[]) => void;
    createLabel: (name: string) => string | null;
    deleteLabel: (id: string) => void;
    openCompose: (mode: DraftMode, threadId?: string | null) => void;
    patchCompose: (partial: Partial<ComposeModel>) => void;
    addComposeFiles: (attachments: Attachment[]) => void;
    removeComposeFile: (id: string) => void;
    send: () => void;
    cancelOutbox: (id: string) => void;
    retryOutbox: (id: string) => void;
    sendQuick: (threadId: string, replyId: string, mode: "reply" | "replyAll") => void;
    dismissCompose: () => void;
    addFilter: (filter: Omit<Filter, "id">) => void;
    toggleFilter: (id: string) => void;
    deleteFilter: (id: string) => void;
    updateSettings: (partial: Partial<Settings>) => void;
    toggleSaved: (query: string) => void;
    rememberSearch: (query: string) => void;
    forgetSearch: (query: string) => void;
    moveSender: (email: string, category: Category) => void;
    decideSenders: (emails: string[], status: "accepted" | "blocked") => void;
    blockSenderDomain: (domain: string) => void;
    setGateMode: (mode: GateMode) => void;
    setGateList: (gateList: boolean) => void;
    undo: () => void;
    dismissToast: () => void;
    checkMail: () => void;
    emptyFolder: () => void;
    destroyForever: (id: string) => void;
    autosaveCompose: () => void;
    resetMailbox: () => void;
    data: () => MailData;
    account: AccountId;
    setAccount: (account: AccountId) => void;
    acceptGmail: () => void;
    dismissGmail: () => void;
    askGmail: () => void;
  };

const REMOVES = new Set<ActKind>(["archive", "trash", "spam"]);

const ACT_LABEL: Record<ActKind, string> = {
  archive: DONE_TOAST,
  trash: "Moved to trash",
  spam: "Reported as spam",
  inbox: "Moved to inbox",
  star: "Star updated",
  starOn: "Starred",
  starOff: "Star removed",
  important: "Importance updated",
  read: "Marked as read",
  unread: "Marked as unread",
  mute: "Mute updated",
};

function dataOf(s: MailData): MailData {
  return {
    threads: s.threads,
    labels: s.labels,
    filters: s.filters,
    settings: s.settings,
    aliases: s.aliases,
    demoCursor: s.demoCursor,
    gmail: s.gmail,
    hiddenThreadIds: s.hiddenThreadIds ?? [],
    outbox: s.outbox ?? [],
    dropOutboxIds: s.dropOutboxIds ?? [],
  };
}

function sliceOf(data: MailData) {
  return dataOf(data);
}

function blankCompose(from: string, _signature: string): ComposeModel {
  return {
    mode: "new",
    threadId: null,
    draftThreadId: null,
    replyToId: null,
    from,
    to: "",
    cc: "",
    bcc: "",
    showCc: false,
    showBcc: false,
    subject: "",
    body: "",
    attachments: [],
    minimized: false,
    expanded: false,
  };
}

function storage() {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return localStorage;
}

function viewAfter(before: State, threads: Thread[], kind: ActKind, chosen: string[]) {
  const setIds = new Set(chosen);
  const now = Date.now();
  const opts = {
    folder: before.folder,
    category: before.category,
    query: before.query,
    now,
    aliases: before.aliases,
    labels: before.labels,
    account: before.account,
    showDone: before.showDone,
  };
  let openId = before.openId;
  let viewing = before.viewing;
  let cursor = before.cursor;
  let checked = before.checked;
  if (REMOVES.has(kind) || kind === "inbox") {
    const prior = visibleThreads({ threads: before.threads, ...opts });
    const idx = Math.max(0, prior.findIndex((thread) => thread.id === (before.openId ?? prior[before.cursor]?.id)));
    const after = visibleThreads({ threads, ...opts });
    const next = after[Math.min(idx, Math.max(0, after.length - 1))] ?? null;
    if (openId && setIds.has(openId) && !after.some((thread) => thread.id === openId)) {
      openId = next?.id ?? null;
      if (!openId) viewing = "list";
    }
    cursor = Math.min(idx, Math.max(0, after.length - 1));
    checked = [];
  }
  return { openId, viewing, cursor, checked };
}

export const useMail = create<State>()(
  persist(
    (set, get) => {
      let chain = Promise.resolve();
      let actionGen = 0;
      const enqueue = (task: () => Promise<void>) => {
        const run = chain.then(task).catch(() => {
          set({ toast: { text: "Mail action failed", snapshot: null } });
        });
        chain = run.then(() => undefined);
        return run;
      };

      const commit = (incoming: MailData, extras: Partial<State> = {}, options?: { settingsFrom?: "server" }) => {
        const current = dataOf(get());
        const fromServer = options?.settingsFrom === "server";
        const merged =
          get().backendId === "bot-bridge"
            ? applyBackendData(current, incoming, fromServer ? { settingsFrom: "server" } : undefined)
            : { ...incoming, settings: fromServer ? incoming.settings : current.settings, gmail: current.gmail };
        set({ ...sliceOf(merged), ...extras });
      };

      const persistClearedDraft = async (id: string) => {
        const cleared = clearDraftThread(dataOf(get()), id);
        set({ ...sliceOf(cleared) });
        await getActiveBackend().setLabels(dataOf(get()), "", []);
      };

      const persistProduct = () =>
        enqueue(async () => {
          await getActiveBackend().setLabels(dataOf(get()), "", []);
        });

      return {
        ...emptyMailbox(),
        backendId: "bot-bridge",
        folder: "inbox",
        category: "all",
        query: "",
        openId: null,
        focusMessageId: null,
        checked: [],
        anchor: null,
        cursor: 0,
        viewing: "list",
        showDone: false,
        gestureIds: null,
        gateList: false,
        selecting: false,
        listedIds: [],
        pendingDone: null,
        drawer: false,
        palette: false,
        help: false,
        settingsOpen: false,
        snoozeOpen: false,
        labelMenu: false,
        compose: null,
        toast: null,
        account: "grokbot",

        data: () => dataOf(get()),

        connect: () =>
          enqueue(async () => {
            setActiveBackend("bot-bridge");
            try {
              await fetchPublicMailConfig();
              const current = dataOf(get());
              const incoming = await getActiveBackend().bootstrap(current);
              const merged = applyBackendData({ ...current, gmail: "off" }, incoming, { settingsFrom: "server" });
              set({ ...sliceOf(merged), backendId: "bot-bridge", account: "grokbot", gmail: "off" });
            } catch {
              set({ threads: [], gmail: "off", account: "grokbot", backendId: "bot-bridge" });
            }
          }),

        refresh: () =>
          enqueue(async () => {
            if (get().backendId !== "bot-bridge") return;
            const current = dataOf(get());
            const incoming = await getActiveBackend().bootstrap(current);
            commit(incoming, {}, { settingsFrom: "server" });
          }),

        loadAttachment: (attachment) => getActiveBackend().getAttachment(attachment),

        setAccount: (account) => {
          if (account !== "grokbot") return;
          set({
            account: "grokbot",
            folder: "inbox",
            category: "all",
            query: "",
            openId: null,
            focusMessageId: null,
            checked: [],
            cursor: 0,
            viewing: "list",
            drawer: false,
            selecting: false,
            pendingDone: null,
          });
        },
        acceptGmail: () => set({ gmail: "off", account: "grokbot" }),
        dismissGmail: () => set({ gmail: "off", account: "grokbot" }),
        askGmail: () => set({ gmail: "off", account: "grokbot" }),

        setFolder: (folder) =>
          set({
            folder,
            category: folder === "inbox" ? get().category : "all",
            checked: [],
            cursor: 0,
            viewing: "list",
            drawer: false,
            gateList: false,
            openId: null,
            focusMessageId: null,
            selecting: false,
            pendingDone: null,
          }),
        setCategory: (category) => set({ category, cursor: 0, checked: [], selecting: false, pendingDone: null }),
        setQuery: (query) => set({ query, cursor: 0, selecting: false, pendingDone: null }),
        openThread: (id) => {
          set({
            openId: id,
            focusMessageId: null,
            viewing: "thread",
            drawer: false,
            threads: get().threads.map((thread) => (thread.id === id ? { ...thread, unread: false } : thread)),
          });
          void enqueue(async () => {
            const data = await getActiveBackend().act(dataOf(get()), "read", [id]);
            commit(data);
          });
        },
        focusMessage: (id) => set({ focusMessageId: id }),
        backToList: () => set({ viewing: "list", focusMessageId: null }),
        setShowDone: (showDone) => set({ showDone }),
        toggleCheck: (id, index) => {
          const has = get().checked.includes(id);
          set({
            checked: has ? get().checked.filter((item) => item !== id) : [...get().checked, id],
            anchor: index,
          });
        },
        shiftCheck: (index, ids) => {
          const anchor = get().anchor ?? index;
          const [start, end] = anchor < index ? [anchor, index] : [index, anchor];
          const range = ids.slice(start, end + 1);
          set({ checked: [...new Set([...get().checked, ...range])], anchor: index });
        },
        checkVisible: (ids) => {
          const all = ids.length > 0 && ids.every((id) => get().checked.includes(id));
          set({ checked: all ? get().checked.filter((id) => !ids.includes(id)) : [...new Set([...get().checked, ...ids])] });
        },
        selectUnread: (ids) => set({ checked: ids, selecting: ids.length > 0 }),
        selectAll: (ids) => set({ checked: [...new Set(ids)], selecting: ids.length > 0, anchor: null }),
        setSelecting: (selecting) => set({ selecting }),
        setListedIds: (ids) => {
          const current = get().listedIds;
          if (current.length === ids.length && current.every((id, index) => id === ids[index])) return;
          set({ listedIds: ids });
        },
        clearChecks: () => set({ checked: [], anchor: null }),
        dismissPendingDone: () => set({ pendingDone: null }),
        setCursor: (cursor) => set({ cursor }),
        setDrawer: (drawer) => set({ drawer }),
        setPalette: (palette) => set({ palette }),
        setHelp: (help) => set({ help }),
        setSettings: (settingsOpen) =>
          set(settingsOpen ? { settingsOpen: true, drawer: false } : { settingsOpen: false }),
        setSnooze: (snoozeOpen) => set(snoozeOpen ? { snoozeOpen: true } : { snoozeOpen: false, gestureIds: null }),
        setLabelMenu: (labelMenu) => set(labelMenu ? { labelMenu: true } : { labelMenu: false, gestureIds: null }),
        openSnoozeFor: (ids) => set({ snoozeOpen: true, gestureIds: ids }),
        openLabelFor: (ids) => set({ labelMenu: true, gestureIds: ids }),

        targetIds: () => {
          const s = get();
          if (s.gestureIds?.length) return s.gestureIds;
          if (s.checked.length) return s.checked;
          if (s.openId) return [s.openId];
          return [];
        },

        act: (kind, ids, opts) => {
          const before = get();
          const chosen = ids ?? before.targetIds();
          if (!chosen.length) return;
          if (kind === "archive" && !opts?.confirmed && needsBulkConfirm(chosen.length)) {
            set({ pendingDone: chosen.slice() });
            return;
          }
          const snapshot = snapshotOf(dataOf(before));
          const optimisticThreads = before.threads.map((thread) =>
            chosen.includes(thread.id) ? applyAct(thread, kind) : thread,
          );
          const view = viewAfter(before, optimisticThreads, kind, chosen);
          const holdMs = kind === "archive" ? DONE_HOLD_MS : before.settings.undoSeconds * 1000;
          const gen = ++actionGen;
          set({
            threads: optimisticThreads,
            ...view,
            selecting: REMOVES.has(kind) ? false : before.selecting,
            pendingDone: null,
            toast: pushUndo(before.toast, ACT_LABEL[kind], snapshot, holdMs),
          });
          void enqueue(async () => {
            try {
              await waitUntilOnline();
              const data = await getActiveBackend().act(snapshot, kind, chosen);
              if (gen !== actionGen) return;
              commit(data, {});
            } catch {
              if (gen !== actionGen) return;
              set({ ...snapshot, toast: { text: "Mail action failed", snapshot: null } });
            }
          });
        },

        snoozeFor: (at, ids) => {
          const before = get();
          const chosen = ids ?? before.targetIds();
          if (!chosen.length) return;
          const snapshot = snapshotOf(dataOf(before));
          const setIds = new Set(chosen);
          void enqueue(async () => {
            const data = await getActiveBackend().snooze(dataOf(get()), at, chosen);
            const currentOpen = get().openId;
            const openId = currentOpen && setIds.has(currentOpen) ? null : currentOpen;
            commit(data, {
              checked: [],
              gestureIds: null,
              snoozeOpen: false,
              viewing: "list",
              openId,
              toast: { text: "Snoozed", snapshot },
            });
          });
        },

        toggleLabel: (labelId, ids) => {
          const before = get();
          const chosen = ids ?? before.targetIds();
          if (!chosen.length || !labelId) return;
          const snapshot = snapshotOf(dataOf(before));
          const name = before.labels.find((label) => label.id === labelId)?.name ?? "Label";
          void enqueue(async () => {
            const result = await getActiveBackend().setLabels(dataOf(get()), labelId, chosen);
            commit(result.data, { toast: { text: result.added ? `Labeled ${name}` : `Removed ${name}`, snapshot } });
          });
        },

        createLabel: (name) => {
          const trimmed = name.trim();
          if (!trimmed) return null;
          if (get().labels.some((label) => label.name.toLowerCase() === trimmed.toLowerCase())) return null;
          const label = {
            id: uid(),
            name: trimmed,
            swatch: SWATCHES[get().labels.length % SWATCHES.length] as Swatch,
          };
          set({ labels: [...get().labels, label] });
          void persistProduct();
          return label.id;
        },

        deleteLabel: (id) => {
          const snapshot = snapshotOf(dataOf(get()));
          set({
            labels: get().labels.filter((label) => label.id !== id),
            filters: get().filters.map((filter) => (filter.labelId === id ? { ...filter, labelId: null } : filter)),
            threads: get().threads.map((thread) => ({ ...thread, labels: thread.labels.filter((item) => item !== id) })),
            folder: get().folder === `label:${id}` ? "inbox" : get().folder,
            toast: { text: "Label deleted", snapshot },
          });
          void persistProduct();
        },

        openCompose: (mode, threadId) => {
          const s = get();
          const thread = s.threads.find((item) => item.id === (threadId ?? s.openId));
          if (mode !== "new" && thread?.draft && (mode === thread.draft.mode || mode === "reply")) {
            set({
              compose: {
                mode: thread.draft.mode,
                threadId: thread.messages.length ? thread.id : null,
                draftThreadId: thread.id,
                replyToId: thread.draft.replyToId,
                from: thread.draft.from,
                to: thread.draft.to,
                cc: thread.draft.cc,
                bcc: thread.draft.bcc,
                showCc: Boolean(thread.draft.cc),
                showBcc: Boolean(thread.draft.bcc),
                subject: thread.draft.subject,
                body: thread.draft.body,
                attachments: thread.draft.attachments,
                minimized: false,
                expanded: false,
              },
              palette: false,
            });
            return;
          }
          if (mode === "new" || !thread) {
            set({ compose: blankCompose(demoFromAddress(s, s.account), s.settings.signature), palette: false });
            return;
          }
          const message = [...thread.messages].reverse()[0];
          if (!message) {
            set({ compose: blankCompose(demoFromAddress(s, s.account), s.settings.signature), palette: false });
            return;
          }
          const fields = replyFields(message, mode, demoMine(s, s.account));
          const from = mode === "forward" ? demoFromAddress(s, s.account) : plusFallback(s, thread.plusTag, s.account);
          set({
            compose: {
              mode,
              threadId: thread.id,
              draftThreadId: thread.id,
              replyToId: message.id,
              from,
              to: fields.to,
              cc: fields.cc,
              bcc: "",
              showCc: Boolean(fields.cc),
              showBcc: false,
              subject: fields.subject,
              body: fields.body,
              attachments: mode === "forward" ? message.attachments.map((file) => ({ ...file, id: uid() })) : [],
              minimized: false,
              expanded: false,
            },
            palette: false,
          });
        },

        patchCompose: (partial) => {
          const compose = get().compose;
          if (!compose) return;
          set({ compose: { ...compose, ...partial } });
        },
        addComposeFiles: (attachments) => {
          const compose = get().compose;
          if (!compose) return;
          set({ compose: { ...compose, attachments: [...compose.attachments, ...attachments] } });
        },
        removeComposeFile: (id) => {
          const compose = get().compose;
          if (!compose) return;
          set({ compose: { ...compose, attachments: compose.attachments.filter((file) => file.id !== id) } });
        },

        send: () => {
          const s = get();
          const compose = s.compose;
          if (!compose) return;
          const to = parseAddressList(compose.to);
          if (!to.length || !to.some((address) => address.email.includes("@"))) {
            set({ toast: { text: "Add a recipient", snapshot: null } });
            return;
          }
          const snapshot = snapshotOf(dataOf(s));
          const thread = s.threads.find((item) => item.id === compose.threadId);
          const reply = thread?.messages.find((message) => message.id === compose.replyToId) ?? thread?.messages.at(-1);
          const request: SendRequest = {
            from: compose.from,
            to,
            cc: parseAddressList(compose.cc),
            bcc: parseAddressList(compose.bcc),
            subject: compose.subject.trim() || "(no subject)",
            body: withSignature(compose.body, s.settings.signature),
            attachments: compose.attachments,
            replyToId: compose.replyToId,
            replyToMessageId: reply?.messageId ?? null,
            threadId: compose.threadId,
            draftThreadId: compose.draftThreadId,
            mode: compose.mode,
            displayName: s.settings.displayName,
          };
          if (s.account === "gmail") {
            set({ toast: { text: "Gmail is not synced.", snapshot: null } });
            return;
          }
          set({
            compose: null,
            toast: { text: s.backendId === "bot-bridge" ? QUEUED_TOAST : "Message sent", snapshot },
          });
          void enqueue(async () => {
            const result = await getActiveBackend().send(dataOf(get()), request);
            commit(result.data, { toast: { text: result.notice, snapshot } });
          });
        },

        cancelOutbox: (id) => {
          void enqueue(async () => {
            const response = await fetch(`/api/outbox/${encodeURIComponent(id)}`, {
              method: "DELETE",
              credentials: "same-origin",
            });
            if (response.status === 409) {
              set({ toast: { text: "That send can no longer be cancelled", snapshot: null } });
              return;
            }
            if (!response.ok) {
              set({ toast: { text: "Could not cancel that send", snapshot: null } });
              return;
            }
            const incoming = await getActiveBackend().bootstrap(dataOf(get()));
            commit(incoming, { toast: { text: "Cancelled", snapshot: null } });
          });
        },

        retryOutbox: (id) => {
          const snapshot = snapshotOf(dataOf(get()));
          set({ toast: { text: QUEUED_TOAST, snapshot } });
          void enqueue(async () => {
            try {
              const incoming = await retryOutboxSend({ data: { data: dataOf(get()), id } });
              commit(incoming, { toast: { text: QUEUED_TOAST, snapshot } });
            } catch {
              set({ toast: { text: "Could not retry that send", snapshot: null } });
            }
          });
        },

        sendQuick: (threadId, replyId, mode) => {
          const s = get();
          const thread = s.threads.find((item) => item.id === threadId);
          const reply = quickRepliesOf(s.settings.quickReplies).find((item) => item.id === replyId);
          if (!thread || !reply) return;
          const request = buildQuickRequest({
            thread,
            reply,
            mode,
            from: plusFallback(s, thread.plusTag, s.account),
            mine: demoMine(s, s.account),
            signature: s.settings.signature,
            displayName: s.settings.displayName,
          });
          if (!request) return;
          if (s.account === "gmail") {
            set({ toast: { text: "Gmail is not synced.", snapshot: null } });
            return;
          }
          const snapshot = snapshotOf(dataOf(s));
          set({ toast: { text: QUEUED_TOAST, snapshot } });
          void enqueue(async () => {
            const result = await getActiveBackend().send(dataOf(get()), request);
            commit(result.data, { toast: { text: result.notice, snapshot } });
          });
        },

        dismissCompose: () => {
          const s = get();
          const compose = s.compose;
          if (!compose) return;
          if (!shouldPersistDraft(compose, s.settings.signature)) {
            const id = compose.draftThreadId;
            set({ compose: null });
            if (!id) return;
            void enqueue(async () => {
              await persistClearedDraft(id);
            });
            return;
          }
          const snapshot = snapshotOf(dataOf(s));
          const draft = {
            mode: compose.mode,
            replyToId: compose.replyToId,
            from: compose.from,
            to: compose.to,
            cc: compose.cc,
            bcc: compose.bcc,
            subject: compose.subject,
            body: compose.body,
            updatedAt: new Date().toISOString(),
            attachments: compose.attachments,
          };
          const threadId = compose.draftThreadId;
          set({ compose: null, toast: { text: "Draft saved", snapshot } });
          void enqueue(async () => {
            const data = await getActiveBackend().saveDraft(dataOf(get()), draft, threadId);
            commit(data);
          });
        },

        autosaveCompose: () => {
          void enqueue(async () => {
            const current = get();
            const compose = current.compose;
            if (!compose) return;
            const draft = {
              mode: compose.mode,
              replyToId: compose.replyToId,
              from: compose.from,
              to: compose.to,
              cc: compose.cc,
              bcc: compose.bcc,
              subject: compose.subject,
              body: compose.body,
              updatedAt: new Date().toISOString(),
              attachments: compose.attachments,
            };
            if (!shouldPersistDraft(compose, current.settings.signature)) {
              const id = compose.draftThreadId;
              if (!id) return;
              await persistClearedDraft(id);
              return;
            }
            const threadId = compose.draftThreadId;
            const data = await getActiveBackend().saveDraft(dataOf(get()), draft, threadId);
            const composeNow = get().compose;
            if (!composeNow) {
              commit(data);
              return;
            }
            const savedId = savedDraftThreadId(data.threads, draft, threadId);
            if (savedId && savedId !== composeNow.draftThreadId) {
              commit(data, { compose: { ...composeNow, draftThreadId: savedId } });
              return;
            }
            commit(data);
          });
        },

        addFilter: (filter) => {
          set({ filters: [...get().filters, { ...filter, id: uid() }] });
          void persistProduct();
        },
        toggleFilter: (id) => {
          set({ filters: get().filters.map((filter) => (filter.id === id ? { ...filter, enabled: !filter.enabled } : filter)) });
          void persistProduct();
        },
        deleteFilter: (id) => {
          set({ filters: get().filters.filter((filter) => filter.id !== id) });
          void persistProduct();
        },
        updateSettings: (partial) => {
          set({ settings: { ...get().settings, ...partial } });
          void persistProduct();
        },

        toggleSaved: (query) => {
          const text = query.trim();
          if (!text) return;
          const current = savedSearchesOf(get().settings.savedSearches);
          const existing = current.find((item) => item.query.toLowerCase() === text.toLowerCase());
          const savedSearches = existing
            ? current.filter((item) => item.id !== existing.id)
            : savedSearchesOf([...current, { id: uid(), query: text }]);
          set({ settings: { ...get().settings, savedSearches } });
          void persistProduct();
        },

        rememberSearch: (query) => {
          const text = query.trim();
          if (!text) return;
          const recentSearches = recentSearchesOf([text, ...recentSearchesOf(get().settings.recentSearches)]);
          set({ settings: { ...get().settings, recentSearches } });
          void persistProduct();
        },

        forgetSearch: (query) => {
          const text = query.trim().toLowerCase();
          const recentSearches = recentSearchesOf(get().settings.recentSearches).filter((item) => item.toLowerCase() !== text);
          set({ settings: { ...get().settings, recentSearches } });
          void persistProduct();
        },

        moveSender: (email, category) => {
          const key = email.trim().toLowerCase();
          if (!key.includes("@")) return;
          actionGen += 1;
          const before = get();
          const snapshot = snapshotOf(dataOf(before));
          const senderRules = upsertSenderRule(before.settings.senderRules, key, category);
          set({
            settings: { ...before.settings, senderRules },
            threads: applySenderRules(before.threads, senderRules),
            toast: pushUndo(before.toast, "Sender filed", snapshot, before.settings.undoSeconds * 1000),
          });
          void persistProduct();
        },

        decideSenders: (emails, status) => {
          const chosen = emails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@"));
          if (!chosen.length) return;
          actionGen += 1;
          const before = get();
          const snapshot = snapshotOf(dataOf(before));
          const book = decideSenderBook(gateBookOf(before.settings.gate), chosen, status);
          const gated = applyGate(before.threads, book, before.aliases);
          const text = status === "accepted" ? (chosen.length > 1 ? "Senders accepted" : "Sender accepted") : chosen.length > 1 ? "Senders blocked" : "Sender blocked";
          set({
            settings: { ...before.settings, gate: gated.book },
            threads: gated.threads,
            toast: pushUndo(before.toast, text, snapshot, before.settings.undoSeconds * 1000),
          });
          void persistProduct();
        },

        blockSenderDomain: (domain) => {
          const next = blockDomain(gateBookOf(get().settings.gate), domain);
          if (next.domains.length === gateBookOf(get().settings.gate).domains.length) return;
          actionGen += 1;
          const before = get();
          const snapshot = snapshotOf(dataOf(before));
          const gated = applyGate(before.threads, next, before.aliases);
          set({
            settings: { ...before.settings, gate: gated.book },
            threads: gated.threads,
            toast: pushUndo(before.toast, "Domain blocked", snapshot, before.settings.undoSeconds * 1000),
          });
          void persistProduct();
        },

        setGateMode: (mode) => {
          const before = get();
          const current = { ...gateBookOf(before.settings.gate), mode };
          const book = mode === "off" ? current : acceptStoredSenders(current, before.threads);
          const gated = applyGate(before.threads, book, before.aliases);
          set({ settings: { ...before.settings, gate: gated.book }, threads: gated.threads });
          void persistProduct();
        },

        setGateList: (gateList) => set({ gateList }),

        undo: () => {
          actionGen += 1;
          const popped = popUndo(get().toast);
          if (!popped.restore) {
            set({ toast: null });
            return;
          }
          set({ ...popped.restore, toast: popped.toast, checked: [], selecting: false, pendingDone: null });
          void persistProduct();
        },
        dismissToast: () => set({ toast: null }),

        checkMail: () => {
          const s = get();
          if (s.account === "gmail") {
            set({ toast: { text: "Gmail is not synced.", snapshot: null } });
            return;
          }
          const snapshot = snapshotOf(dataOf(s));
          void enqueue(async () => {
            const result = await getActiveBackend().sync(dataOf(get()));
            commit(result.data, { toast: { text: result.notice, snapshot } }, { settingsFrom: "server" });
          });
        },

        emptyFolder: () => {
          const s = get();
          if (s.folder !== "trash" && s.folder !== "spam") return;
          const snapshot = snapshotOf(dataOf(s));
          const location = s.folder;
          const ids = s.threads.filter((thread) => thread.location === location && accountOf(thread) === s.account).map((thread) => thread.id);
          const next = hideThreadIds(dataOf(s), ids);
          set({
            ...sliceOf(next),
            openId: null,
            viewing: "list",
            checked: [],
            toast: { text: location === "trash" ? "Trash emptied" : "Spam emptied", snapshot },
          });
          void persistProduct();
        },

        destroyForever: (id) => {
          const before = get();
          const thread = before.threads.find((item) => item.id === id);
          if (!thread || thread.location !== "trash") return;
          const snapshot = snapshotOf(dataOf(before));
          const next = hideThreadIds(dataOf(before), [id]);
          set({
            ...sliceOf(next),
            openId: before.openId === id ? null : before.openId,
            viewing: before.openId === id ? "list" : before.viewing,
            checked: before.checked.filter((item) => item !== id),
            toast: { text: "Deleted forever", snapshot },
          });
          void persistProduct();
        },

        resetMailbox: () => {
          void enqueue(async () => {
            setActiveBackend("bot-bridge");
            const incoming = await getActiveBackend().bootstrap(dataOf(get()));
            commit(
              incoming,
              {
                folder: "inbox",
                account: "grokbot",
                category: "all",
                query: "",
                openId: null,
                checked: [],
                viewing: "list",
                compose: null,
                toast: { text: "Mailbox reloaded", snapshot: null },
              },
              { settingsFrom: "server" },
            );
          });
        },
      };
    },
    {
      name: "grokbot-mail-v1",
      version: 4,
      skipHydration: true,
      storage: createJSONStorage(storage),
      partialize: (s) => ({
        threads: s.threads,
        labels: s.labels,
        filters: s.filters,
        settings: s.settings,
        aliases: s.aliases,
        demoCursor: s.demoCursor,
        gmail: "off" as const,
        hiddenThreadIds: s.hiddenThreadIds ?? [],
        account: "grokbot" as const,
      }),
      merge: (persistedState, currentState) => {
        const saved = persistedState && typeof persistedState === "object" ? (persistedState as Partial<State>) : {};
        return { ...currentState, ...saved, account: "grokbot", gmail: "off" };
      },
      migrate: (persisted: unknown, version: number) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const row = persisted as Partial<MailData> & { account?: AccountId };
        const staleVacation =
          "I'm away from this mailbox. Plus-addressed mail is still filed, and I'll reply when I'm back.";
        let next: Partial<MailData> & { account?: AccountId };
        if (version < 3) {
          const fresh = emptyMailbox();
          const settings = row.settings ?? fresh.settings;
          next = {
            ...fresh,
            settings: {
              ...settings,
              vacationText: settings.vacationText === staleVacation ? "I'm away from this mailbox." : settings.vacationText,
            },
            gmail: "off" as const,
            account: "grokbot" as const,
          };
        } else {
          next = { ...row, gmail: "off" as const, account: "grokbot" as const };
        }
        if (version < 4) {
          const settings = next.settings ?? emptyMailbox().settings;
          return {
            ...next,
            settings: { ...settings, gate: migrateSavedGate(settings.gate, next.threads ?? []) },
          };
        }
        return next;
      },
    },
  ),
);

export function rowsNow(now: number) {
  const s = useMail.getState();
  return visibleThreads({
    threads: s.threads,
    folder: s.folder,
    category: s.category,
    query: s.query,
    now,
    aliases: s.aliases,
    labels: s.labels,
    account: s.account,
    showDone: s.showDone,
  });
}

export function threadActivity(id: string): string {
  const thread = useMail.getState().threads.find((item) => item.id === id);
  return thread ? activityIso(thread) : "";
}
