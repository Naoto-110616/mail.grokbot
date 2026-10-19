import { Check, Clock, Inbox, MailOpen, Menu, PenLine, Search, Star, Tag, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/mail/bits";
import { Compose } from "@/components/mail/compose";
import { Overlays } from "@/components/mail/overlays";
import { Reader } from "@/components/mail/reader";
import { Sidebar } from "@/components/mail/sidebar";
import { ThreadList } from "@/components/mail/thread-list";
import { resolveDeepLink } from "@/lib/mail/deep-link";
import { readKind, starKind } from "@/lib/mail/batch";
import { unreadIn, resolveTheme, visibleThreads } from "@/lib/mail/model";
import { recentSearchesOf, savedSearchesOf, SEARCH_SUGGESTIONS } from "@/lib/mail/search";
import { rowsNow, useMail } from "@/lib/mail/store";

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setDesktop(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return desktop;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function MailShell({
  messageId = null,
  threadId = null,
}: {
  messageId?: string | null;
  threadId?: string | null;
}) {
  const desktop = useIsDesktop();
  const now = useNow();
  const folder = useMail((s) => s.folder);
  const category = useMail((s) => s.category);
  const query = useMail((s) => s.query);
  const threads = useMail((s) => s.threads);
  const labels = useMail((s) => s.labels);
  const aliases = useMail((s) => s.aliases);
  const settings = useMail((s) => s.settings);
  const account = useMail((s) => s.account);
  const viewing = useMail((s) => s.viewing);
  const openId = useMail((s) => s.openId);
  const drawer = useMail((s) => s.drawer);
  const toast = useMail((s) => s.toast);
  const checked = useMail((s) => s.checked);
  const pendingDone = useMail((s) => s.pendingDone);
  const act = useMail((s) => s.act);
  const setSnooze = useMail((s) => s.setSnooze);
  const setLabelMenu = useMail((s) => s.setLabelMenu);
  const dismissPendingDone = useMail((s) => s.dismissPendingDone);
  const setFolder = useMail((s) => s.setFolder);
  const setQuery = useMail((s) => s.setQuery);
  const toggleSaved = useMail((s) => s.toggleSaved);
  const rememberSearch = useMail((s) => s.rememberSearch);
  const forgetSearch = useMail((s) => s.forgetSearch);
  const setDrawer = useMail((s) => s.setDrawer);
  const [searchFocus, setSearchFocus] = useState(false);
  const saved = savedSearchesOf(settings.savedSearches);
  const recent = recentSearchesOf(settings.recentSearches);
  const trimmedQuery = query.trim();
  const savedOn = saved.some((item) => item.query.toLowerCase() === trimmedQuery.toLowerCase());
  const openCompose = useMail((s) => s.openCompose);
  const setPalette = useMail((s) => s.setPalette);
  const dismissToast = useMail((s) => s.dismissToast);

  const showDone = useMail((s) => s.showDone);
  const rows = visibleThreads({ threads, folder, category, query, now, aliases, labels, account, showDone });
  const split = desktop && settings.pane === "right";
  const showReader = Boolean(split || (viewing === "thread" && openId));
  const showList = split || !showReader;
  const inboxUnread = unreadIn(threads, "inbox", now, aliases, account);
  const checkedThreads = threads.filter((thread) => checked.includes(thread.id));
  const readAction = readKind(checkedThreads);
  const starAction = starKind(checkedThreads);
  const openedLink = useRef<string | null>(null);

  useEffect(() => {
    const key = messageId ? `m:${messageId}` : threadId ? `t:${threadId}` : "";
    if (!key || openedLink.current === key) return;
    const target = resolveDeepLink(threads, { messageId, threadId });
    if (!target) return;
    openedLink.current = key;
    const state = useMail.getState();
    state.openThread(target.threadId);
    if (target.focusMessageId) state.focusMessage(target.focusMessageId);
  }, [messageId, threadId, threads]);

  useEffect(() => {
    if (viewing === "thread" && openId && !threads.some((thread) => thread.id === openId)) {
      useMail.getState().backToList();
    }
  }, [threads, openId, viewing]);

  useEffect(() => {
    const root = document.documentElement;
    const mode = resolveTheme(settings.theme);
    root.classList.toggle("dark", mode === "lights-out");
    root.classList.toggle("dim", mode === "dim");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "lights-out" ? "#000000" : mode === "dim" ? "#15202b" : "#ffffff");
    root.style.setProperty("--glass-alpha", String(34 + settings.glass * 0.5));
    root.style.setProperty("--glass-blur", String(8 + settings.glass * 0.22));
    (window as unknown as { __mailReady?: boolean }).__mailReady = true;
    const count = unreadIn(useMail.getState().threads, "inbox", Date.now(), useMail.getState().aliases, useMail.getState().account);
    document.title = count ? `(${count}) Grokbot Mail` : "Grokbot Mail";
  }, [settings.theme, settings.glass, threads, aliases, account]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => dismissToast(), toast.holdMs ?? settings.undoSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [toast, settings.undoSeconds, dismissToast]);

  useEffect(() => {
    let gAt = 0;
    function closeLayers() {
      const s = useMail.getState();
      if (s.pendingDone?.length) return s.dismissPendingDone();
      if (s.palette) return s.setPalette(false);
      if (s.help) return s.setHelp(false);
      if (s.settingsOpen) return s.setSettings(false);
      if (s.snoozeOpen) return s.setSnooze(false);
      if (s.labelMenu) return s.setLabelMenu(false);
      if (s.drawer) return s.setDrawer(false);
      if (s.gateList) return s.setGateList(false);
      if (s.compose) return s.dismissCompose();
      if (s.selecting || s.checked.length) {
        s.clearChecks();
        s.setSelecting(false);
        return;
      }
      const splitNow = window.innerWidth >= 1024 && s.settings.pane === "right";
      if (!splitNow && s.viewing === "thread") s.backToList();
    }
    function idsForKey() {
      const s = useMail.getState();
      if (s.checked.length) return s.checked;
      if (s.viewing === "thread" && s.openId) return [s.openId];
      const vis = rowsNow(Date.now());
      const row = vis[s.cursor];
      return row ? [row.id] : s.openId ? [s.openId] : [];
    }
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useMail.getState().setPalette(!useMail.getState().palette);
        return;
      }
      if (meta && e.key === "Enter" && useMail.getState().compose) {
        e.preventDefault();
        useMail.getState().send();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeLayers();
        return;
      }
      const s = useMail.getState();
      if (s.palette || s.help || s.settingsOpen || s.snoozeOpen || s.labelMenu || s.compose) return;
      if (isTyping(e.target)) return;
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        s.selectAll(s.listedIds);
        return;
      }

      if (gAt && Date.now() - gAt < 1200) {
        gAt = 0;
        const jump: Record<string, typeof s.folder> = {
          i: "inbox",
          s: "starred",
          t: "sent",
          d: "drafts",
          a: "all",
          z: "snoozed",
          "#": "trash",
        };
        const next = jump[e.key];
        if (next) {
          s.setFolder(next);
          return;
        }
      }
      if (e.key === "g") {
        gAt = Date.now();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("mail-search")?.focus();
        return;
      }
      if (e.key === "?") {
        s.setHelp(true);
        return;
      }
      if (e.key === "c") {
        s.openCompose("new");
        return;
      }
      if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        const vis = rowsNow(Date.now());
        if (!vis.length) return;
        const delta = e.key === "j" || e.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(vis.length - 1, Math.max(0, s.cursor + delta));
        s.setCursor(next);
        const splitNow = window.innerWidth >= 1024 && s.settings.pane === "right";
        if (splitNow && vis[next]) s.openThread(vis[next].id);
        e.preventDefault();
        return;
      }
      if (e.key === "o" || e.key === "Enter") {
        const vis = rowsNow(Date.now());
        const row = vis[s.cursor];
        if (row) s.openThread(row.id);
        return;
      }
      if (e.key === "u") {
        s.backToList();
        return;
      }
      if (e.key === "x") {
        const vis = rowsNow(Date.now());
        const row = vis[s.cursor];
        if (row) s.toggleCheck(row.id, s.cursor);
        return;
      }
      const ids = idsForKey();
      if (e.key === "e") s.act("archive", ids);
      else if (e.key === "#") s.act("trash", ids);
      else if (e.key === "s") s.act("star", ids);
      else if (e.key === "!") s.act("spam", ids);
      else if (e.key === "m") s.act("mute", ids);
      else if (e.key === "I") s.act("read", ids);
      else if (e.key === "U") s.act("unread", ids);
      else if (e.key === "r") {
        if (ids[0]) s.openCompose("reply", ids[0]);
      } else if (e.key === "a") {
        if (ids[0]) s.openCompose("replyAll", ids[0]);
      } else if (e.key === "f") {
        if (ids[0]) s.openCompose("forward", ids[0]);
      } else if (e.key === "b") {
        if (ids.length) s.setSnooze(true);
      } else if (e.key === "l") {
        if (ids.length) s.setLabelMenu(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="stage flex h-dvh min-h-0 flex-col gap-2 px-1.5 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:gap-3 lg:p-3">
      <header className="glass flex h-14 shrink-0 items-center rounded-full pl-1 pr-1">
        <IconButton label="Mailbox" className="lg:hidden" onClick={() => setDrawer(true)}>
          <Menu className="size-5" />
        </IconButton>
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 pr-2">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            id="mail-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              rememberSearch(query);
              event.currentTarget.blur();
            }}
            placeholder="Search mail"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
          {trimmedQuery && (
            <button
              type="button"
              aria-label={savedOn ? "Remove saved search" : "Save search"}
              aria-pressed={savedOn}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggleSaved(query)}
            >
              <Star className={savedOn ? "size-4 fill-brass text-brass" : "size-4"} />
            </button>
          )}
          {query && (
            <button type="button" aria-label="Clear search" className="inline-flex size-8 items-center justify-center rounded-full" onClick={() => setQuery("")}>
              <X className="size-4" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="mr-1 hidden h-9 items-center gap-2 rounded-full bg-ink/5 px-3 text-xs font-medium text-muted sm:inline-flex"
        >
          Commands
          <kbd className="rounded-md bg-paper px-1.5 py-0.5 text-xs text-ink">⌘K</kbd>
        </button>
      </header>

      {searchFocus && (
        <div className="glass shrink-0 rounded-2xl p-2">
          <div className="flex gap-2 overflow-x-auto" aria-label="Search suggestions">
            {SEARCH_SUGGESTIONS.map((hint) => (
              <button
                key={hint}
                type="button"
                className="h-11 shrink-0 rounded-full border border-line bg-paper px-3 text-sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery(trimmedQuery ? `${trimmedQuery} ${hint}` : hint);
                  document.getElementById("mail-search")?.focus();
                }}
              >
                {hint}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <ul className="mt-2 space-y-1">
              {recent.map((item) => (
                <li key={item} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="h-11 min-w-0 flex-1 truncate rounded-xl px-3 text-left text-sm"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setQuery(item);
                      document.getElementById("mail-search")?.focus();
                    }}
                  >
                    {item}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => forgetSearch(item)}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2 lg:gap-3">
        <aside className="glass hidden w-64 shrink-0 flex-col overflow-hidden rounded-3xl p-2 lg:flex">
          <Sidebar />
        </aside>
        {showList && (
          <ThreadList
            rows={rows}
            now={now}
            onOpen={(id) => {
              const thread = threads.find((t) => t.id === id);
              if (thread && thread.messages.length === 0 && thread.draft) {
                useMail.getState().openCompose(thread.draft.mode, thread.id);
                return;
              }
              useMail.getState().openThread(id);
            }}
          />
        )}
        {showReader && <Reader split={split} onBack={() => useMail.getState().backToList()} />}
      </div>

      {!(viewing === "thread" && !desktop) && (
        <nav
          className="glass safe-bottom fixed inset-x-1.5 bottom-2 z-30 flex items-end justify-around rounded-full px-1 pt-1 lg:hidden"
          aria-label={checked.length > 0 ? "Batch" : "Primary"}
        >
          {checked.length > 0 ? (
            <>
              <BatchBtn label="Done" onClick={() => act("archive")}>
                <Check className="size-5" strokeWidth={1.75} />
              </BatchBtn>
              <BatchBtn label={readAction === "unread" ? "Unread" : "Read"} onClick={() => act(readAction)}>
                <MailOpen className="size-5" strokeWidth={1.75} />
              </BatchBtn>
              <BatchBtn label={starAction === "starOff" ? "Unstar" : "Star"} onClick={() => act(starAction)}>
                <Star className="size-5" strokeWidth={1.75} />
              </BatchBtn>
              <BatchBtn label="Snooze" onClick={() => setSnooze(true)}>
                <Clock className="size-5" strokeWidth={1.75} />
              </BatchBtn>
              <BatchBtn label="Label" onClick={() => setLabelMenu(true)}>
                <Tag className="size-5" strokeWidth={1.75} />
              </BatchBtn>
              <BatchBtn label="Delete" onClick={() => act("trash")}>
                <Trash2 className="size-5" strokeWidth={1.75} />
              </BatchBtn>
            </>
          ) : (
            <>
              <Tab label="Inbox" active={folder === "inbox" && viewing === "list"} count={inboxUnread} onClick={() => setFolder("inbox")}>
                <Inbox className="size-5" />
              </Tab>
              <Tab label="Starred" active={folder === "starred"} onClick={() => setFolder("starred")}>
                <Star className="size-5" />
              </Tab>
              <button
                type="button"
                onClick={() => openCompose("new")}
                className="mb-1 inline-flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg"
                aria-label="Compose"
              >
                <PenLine className="size-6" />
              </button>
              <Tab label="Snoozed" active={folder === "snoozed"} onClick={() => setFolder("snoozed")}>
                <Clock className="size-5" />
              </Tab>
              <Tab label="Menu" active={drawer} onClick={() => setDrawer(true)}>
                <Menu className="size-5" />
              </Tab>
            </>
          )}
        </nav>
      )}

      {pendingDone && pendingDone.length > 0 && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
          <button type="button" aria-label="Cancel" className="absolute inset-0 bg-ink/30" onClick={() => dismissPendingDone()} />
          <div role="dialog" aria-labelledby="bulk-done-title" className="glass relative w-full max-w-sm rounded-3xl p-4">
            <p id="bulk-done-title" className="text-base font-bold">
              Mark {pendingDone.length} conversations done?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="h-11 flex-1 rounded-full bg-accent text-sm font-semibold text-accent-fg"
                onClick={() => act("archive", pendingDone, { confirmed: true })}
              >
                Done
              </button>
              <button type="button" className="h-11 flex-1 rounded-full border border-line text-sm font-semibold" onClick={() => dismissPendingDone()}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/30" onClick={() => setDrawer(false)} />
          <div className="glass rise absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-1.5 top-[max(0.5rem,env(safe-area-inset-top))] flex w-72 flex-col overflow-hidden rounded-3xl p-2">
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <Compose />
      <Overlays rows={rows.map((t) => ({ id: t.id, subject: t.subject }))} />
    </div>
  );
}

function BatchBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center text-xs font-medium">
      {children}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function Tab({
  label,
  active,
  count,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="relative flex h-14 w-14 flex-col items-center justify-center text-xs font-medium">
      <span className={active ? "text-accent" : "text-ink"}>{children}</span>
      <span className={active ? "text-accent" : "text-muted"}>{label}</span>
      {!!count && count > 0 && (
        <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center text-xs font-semibold text-accent-fg tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}
