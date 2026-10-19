import {
  Archive,
  Check,
  Bookmark,
  Clock,
  FileEdit,
  Inbox,
  Mail,
  OctagonAlert,
  Ban,
  PenLine,
  Send,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { addressLocal, folderLabel, type FolderId, unreadIn, visibleThreads } from "@/lib/mail/model";
import { savedSearchesOf } from "@/lib/mail/search";
import { useMail } from "@/lib/mail/store";
import { SwatchDot } from "@/components/mail/bits";

const FOLDERS: { id: FolderId; icon: typeof Inbox }[] = [
  { id: "inbox", icon: Inbox },
  { id: "done", icon: Check },
  { id: "starred", icon: Star },
  { id: "snoozed", icon: Clock },
  { id: "important", icon: Bookmark },
  { id: "sent", icon: Send },
  { id: "drafts", icon: FileEdit },
  { id: "all", icon: Archive },
  { id: "spam", icon: OctagonAlert },
  { id: "blocked", icon: Ban },
  { id: "trash", icon: Trash2 },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const folder = useMail((s) => s.folder);
  const threads = useMail((s) => s.threads);
  const aliases = useMail((s) => s.aliases);
  const labels = useMail((s) => s.labels);
  const setFolder = useMail((s) => s.setFolder);
  const setQuery = useMail((s) => s.setQuery);
  const query = useMail((s) => s.query);
  const saved = savedSearchesOf(useMail((s) => s.settings.savedSearches));
  const openCompose = useMail((s) => s.openCompose);
  const setSettings = useMail((s) => s.setSettings);
  const account = useMail((s) => s.account);
  const from = useMail((s) => s.settings.defaultFrom);
  const setAccount = useMail((s) => s.setAccount);
  const now = Date.now();

  function go(id: FolderId) {
    setFolder(id);
    onNavigate?.();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pb-3 pt-1">
        <div className="flex items-baseline gap-1 px-1">
          <span className="text-lg font-bold tracking-tight">grokbot</span>
          <span className="text-sm text-muted">mail</span>
        </div>
        <div className="mt-2 space-y-1">
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left",
              account === "grokbot" && "bg-accent/10",
            )}
            onClick={() => {
              setAccount("grokbot");
              onNavigate?.();
            }}
          >
            <Mail className={cn("size-5 shrink-0", account === "grokbot" && "text-accent")} strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{addressLocal(from)}@</span>
              <span className="block truncate text-xs font-normal text-muted">{from}</span>
            </span>
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          openCompose("new");
          onNavigate?.();
        }}
        className="mx-1 mb-3 flex h-12 items-center gap-3 rounded-full bg-accent pl-4 pr-5 text-sm font-semibold text-accent-fg"
      >
        <PenLine className="size-5" />
        Compose
      </button>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-auto px-1" aria-label="Mailbox">
        {FOLDERS.map((item) => {
          const count = unreadIn(threads, item.id, now, aliases, account);
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              data-active={folder === item.id}
              onClick={() => go(item.id)}
            >
              <Icon className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="flex-1 text-left">{folderLabel(item.id, labels)}</span>
              {count > 0 && <span className="text-xs font-semibold text-accent tabular-nums">{count}</span>}
            </button>
          );
        })}
        <p className="px-3 pb-1 pt-4 text-xs font-semibold tracking-wide text-muted">Labels</p>
        {labels.map((label) => (
          <button
            key={label.id}
            type="button"
            className="nav-item"
            data-active={folder === `label:${label.id}`}
            onClick={() => go(`label:${label.id}`)}
          >
            <SwatchDot swatch={label.swatch} />
            <span className="flex-1 truncate text-left">{label.name}</span>
          </button>
        ))}
        {saved.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-4 text-xs font-semibold tracking-wide text-muted">Saved</p>
            {saved.map((item) => {
              const count = visibleThreads({
                threads,
                folder: "all",
                category: "all",
                query: item.query,
                now,
                aliases,
                labels,
                account,
              }).length;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="nav-item"
                  data-active={query === item.query}
                  onClick={() => {
                    setQuery(item.query);
                    onNavigate?.();
                  }}
                >
                  <Star className="size-5 shrink-0" strokeWidth={1.75} />
                  <span className="flex-1 truncate text-left">{item.query}</span>
                  <span className="text-xs font-semibold tabular-nums">{count}</span>
                </button>
              );
            })}
          </>
        )}
        {account === "grokbot" && (
          <>
            <p className="px-3 pb-1 pt-4 text-xs font-bold tracking-wide text-muted">Plus addresses</p>
            {aliases
              .filter((a) => a.tag)
              .map((alias) => (
                <button
                  key={alias.email}
                  type="button"
                  className="nav-item"
                  data-active={folder === `plus:${alias.tag}`}
                  onClick={() => go(`plus:${alias.tag}`)}
                >
                  <Mail className="size-5 shrink-0" strokeWidth={1.75} />
                  <span className="flex-1 truncate text-left">+{alias.tag}</span>
                </button>
              ))}
          </>
        )}
      </nav>
      <button type="button" className="nav-item mx-1 mt-2" onClick={() => setSettings(true)}>
        <Settings className="size-5" strokeWidth={1.75} />
        <span className="flex-1 text-left">Settings</span>
      </button>
    </div>
  );
}
