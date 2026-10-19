import { Command } from "cmdk";
import { useEffect, useState, type FormEvent } from "react";
import { Field, Sheet, SwatchDot } from "@/components/mail/bits";
import { HEADER_MODE_OPTIONS, type HeaderMode } from "@/lib/mail/bot-connection";
import { fetchBotConnection, pingBotConnection, saveBotConnection } from "@/lib/mail/mail-rpc";
import { pingFailureText } from "@/lib/mail/wake-retry";
import { GATE_COPY, knownGateError } from "@/lib/site-gate/messages";
import { changeSitePassword, logoutSite, sitePasswordEditable } from "@/lib/site-gate/rpc";
import { toastLabel } from "@/lib/mail/done";
import { gateBookOf, type GateMode } from "@/lib/mail/gate";
import { SWIPE_ACTIONS, SWIPE_SLOTS, swipeActionLabel, swipePrefsOf, type SwipeAction } from "@/lib/mail/swipe";
import { defaultQuickReplies } from "@/lib/mail/quick";
import { listSender, mineSet, resolveTheme, snoozePresets, snippetOf, uid, type FolderId } from "@/lib/mail/model";
import { useMail } from "@/lib/mail/store";

export function Overlays({ rows }: { rows: { id: string; subject: string }[] }) {
  const palette = useMail((s) => s.palette);
  const help = useMail((s) => s.help);
  const settingsOpen = useMail((s) => s.settingsOpen);
  const snoozeOpen = useMail((s) => s.snoozeOpen);
  const labelMenu = useMail((s) => s.labelMenu);
  const toast = useMail((s) => s.toast);
  const setPalette = useMail((s) => s.setPalette);
  const setHelp = useMail((s) => s.setHelp);
  const undo = useMail((s) => s.undo);
  const dismissToast = useMail((s) => s.dismissToast);

  return (
    <>
      {palette && <Palette onClose={() => setPalette(false)} rowIds={rows} />}
      {help && <Help onClose={() => setHelp(false)} />}
      {settingsOpen && <Settings />}
      {snoozeOpen && <Snooze />}
      {labelMenu && <Labels />}
      {toast && (
        <div role="status" aria-label={toastLabel(toast.text)} className="glass fixed bottom-[calc(6.75rem+env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-[80] mx-auto flex w-fit max-w-[min(17rem,calc(100%-1.5rem))] min-w-0 items-center gap-2 overflow-hidden rounded-full py-1.5 pl-4 pr-1.5 lg:bottom-6">
          <span className="min-w-0 truncate text-sm">{toast.text}</span>
          {toast.snapshot && (
            <button type="button" className="h-9 rounded-full bg-accent px-3 text-sm font-semibold text-accent-fg" onClick={undo}>
              Undo
            </button>
          )}
          <button type="button" className="h-9 rounded-full px-3 text-sm text-muted" onClick={dismissToast}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

function Palette({ onClose, rowIds }: { onClose: () => void; rowIds: { id: string; subject: string }[] }) {
  const threads = useMail((s) => s.threads);
  const labels = useMail((s) => s.labels);
  const aliases = useMail((s) => s.aliases);
  const setFolder = useMail((s) => s.setFolder);
  const openThread = useMail((s) => s.openThread);
  const openCompose = useMail((s) => s.openCompose);
  const act = useMail((s) => s.act);
  const setHelp = useMail((s) => s.setHelp);
  const setSettings = useMail((s) => s.setSettings);
  const checkMail = useMail((s) => s.checkMail);
  const updateSettings = useMail((s) => s.updateSettings);
  const theme = useMail((s) => s.settings.theme);
  const selectUnread = useMail((s) => s.selectUnread);
  const selectAll = useMail((s) => s.selectAll);
  const mine = mineSet(aliases);

  function go(folder: FolderId) {
    setFolder(folder);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close commands" className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <Command
        label="Commands"
        className="glass rise absolute left-3 right-3 top-[10%] mx-auto max-w-xl overflow-hidden rounded-3xl"
      >
        <Command.Input
          autoFocus
          placeholder="Search"
          className="w-full border-b border-line bg-transparent px-4 py-4 text-base outline-none"
        />
        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matching command.</Command.Empty>
          <Command.Group heading="Go" className="px-2 pb-1 text-xs font-semibold text-muted">
            {(
              [
                ["inbox", "Inbox"],
                ["starred", "Starred"],
                ["snoozed", "Snoozed"],
                ["sent", "Sent"],
                ["drafts", "Drafts"],
                ["all", "All mail"],
                ["spam", "Spam"],
                ["blocked", "Blocked"],
                ["trash", "Trash"],
              ] as const
            ).map(([id, label]) => (
              <Command.Item key={id} value={`go ${label}`} className="menu-item" onSelect={() => go(id)}>
                {label}
              </Command.Item>
            ))}
            {labels.map((label) => (
              <Command.Item
                key={label.id}
                value={`label ${label.name}`}
                className="menu-item"
                onSelect={() => go(`label:${label.id}`)}
              >
                <SwatchDot swatch={label.swatch} /> {label.name}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Actions" className="px-2 pb-1 text-xs font-semibold text-muted">
            <Command.Item value="compose new message" className="menu-item" onSelect={() => { openCompose("new"); onClose(); }}>
              Compose
            </Command.Item>
            <Command.Item value="check for new mail" className="menu-item" onSelect={() => { checkMail(); onClose(); }}>
              Check mail
            </Command.Item>
            <Command.Item value="done archive selected" className="menu-item" onSelect={() => { act("archive"); onClose(); }}>
              Done
            </Command.Item>
            <Command.Item value="delete trash selected" className="menu-item" onSelect={() => { act("trash"); onClose(); }}>
              Delete
            </Command.Item>
            <Command.Item
              value="select all conversations"
              className="menu-item"
              onSelect={() => {
                selectAll(rowIds.map((r) => r.id));
                onClose();
              }}
            >
              Select all in view
            </Command.Item>
            <Command.Item
              value="select unread"
              className="menu-item"
              onSelect={() => {
                const ids = rowIds
                  .map((r) => threads.find((t) => t.id === r.id))
                  .filter((t) => t?.unread)
                  .map((t) => t!.id);
                selectUnread(ids);
                onClose();
              }}
            >
              Select unread
            </Command.Item>
            <Command.Item
              value="cycle theme light dim lights out"
              className="menu-item"
              onSelect={() => {
                const order = ["light", "dim", "lights-out"] as const;
                const current = resolveTheme(theme);
                const next = order[(order.indexOf(current) + 1) % order.length];
                updateSettings({ theme: next });
                onClose();
              }}
            >
              {resolveTheme(theme) === "lights-out" ? "Use light" : resolveTheme(theme) === "dim" ? "Use lights out" : "Use dim"}
            </Command.Item>
            <Command.Item value="keyboard shortcuts help" className="menu-item" onSelect={() => { setHelp(true); onClose(); }}>
              Keyboard shortcuts
            </Command.Item>
            <Command.Item value="open settings" className="menu-item" onSelect={() => { setSettings(true); onClose(); }}>
              Settings
            </Command.Item>
          </Command.Group>
          <Command.Group heading="Conversations" className="px-2 pb-1 text-xs font-semibold text-muted">
            {threads.slice(0, 40).map((thread) => (
              <Command.Item
                key={thread.id}
                value={`${thread.subject} ${listSender(thread, mine)} ${snippetOf(thread)} ${thread.plusTag ?? ""}`}
                className="menu-item"
                onSelect={() => {
                  openThread(thread.id);
                  onClose();
                }}
              >
                <span className="truncate">{thread.subject || "(no subject)"}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["C", "Compose"],
  ["⌘K", "Commands"],
  ["/", "Search"],
  ["J / K", "Next / previous"],
  ["O or Enter", "Open"],
  ["U", "Back to the list"],
  ["X", "Select"],
  ["E", "Done"],
  ["#", "Delete"],
  ["S", "Star"],
  ["R / A / F", "Reply / all / forward"],
  ["!", "Spam"],
  ["M", "Mute"],
  ["B", "Snooze"],
  ["L", "Label"],
  ["Shift I / U", "Read / unread"],
  ["G then I", "Inbox"],
  ["G then S / T / D", "Starred / sent / drafts"],
  ["?", "This cheat sheet"],
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard" onClose={onClose}>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {KEYS.map(([key, label]) => (
          <li key={key} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2">
            <span className="text-sm">{label}</span>
            <kbd className="rounded-lg bg-ink/5 px-2 py-1 text-xs font-medium tabular-nums">{key}</kbd>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Swipes use the same actions: E done, B snooze, S star, I read, # delete, L label.</p>
      <p className="mt-1 text-xs text-muted">In the composer, ⌘Enter or Ctrl+Enter sends.</p>
    </Sheet>
  );
}

function Snooze() {
  const setSnooze = useMail((s) => s.setSnooze);
  const snoozeFor = useMail((s) => s.snoozeFor);
  return (
    <Sheet title="Snooze" onClose={() => setSnooze(false)}>
      <ul>
        {snoozePresets().map((item) => (
          <li key={item.id}>
            <button type="button" className="menu-item" onClick={() => snoozeFor(item.at)}>
              <span className="flex-1 text-left">{item.label}</span>
              <span className="text-xs text-muted">{item.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function Labels() {
  const labels = useMail((s) => s.labels);
  const threads = useMail((s) => s.threads);
  const targetIds = useMail((s) => s.targetIds);
  const toggleLabel = useMail((s) => s.toggleLabel);
  const createLabel = useMail((s) => s.createLabel);
  const setLabelMenu = useMail((s) => s.setLabelMenu);
  const [name, setName] = useState("");
  const ids = targetIds();
  return (
    <Sheet title="Labels" onClose={() => setLabelMenu(false)}>
      <ul>
        {labels.map((label) => {
          const count = ids.filter((id) => threads.find((t) => t.id === id)?.labels.includes(label.id)).length;
          const on = ids.length > 0 && count === ids.length;
          return (
            <li key={label.id}>
              <button type="button" className="menu-item" onClick={() => toggleLabel(label.id, ids)}>
                <SwatchDot swatch={label.swatch} />
                <span className="flex-1 text-left">{label.name}</span>
                <span className="text-xs text-muted">{on ? "On" : count > 0 ? "Mixed" : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const id = createLabel(name);
          if (id && ids.length) toggleLabel(id, ids);
          setName("");
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New label"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-paper-2 px-3 text-sm outline-none"
        />
        <button type="submit" className="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg">
          Add
        </button>
      </form>
    </Sheet>
  );
}

function SiteAddress() {
  const host = typeof window === "undefined" ? "" : window.location.host;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Site address</h3>
      <p className="flex h-11 items-center rounded-xl border border-line bg-paper-2 px-3 text-base">
        {host || "—"}
      </p>
    </section>
  );
}

function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editable, setEditable] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    sitePasswordEditable()
      .then((result) => {
        if (live) setEditable(result.enabled);
      })
      .catch(() => {
        if (live) setEditable(false);
      });
    return () => {
      live = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (next.length < 10) {
      setError(GATE_COPY.tooShort);
      return;
    }
    setPending(true);
    try {
      const result = await changeSitePassword({ data: { current, next } });
      if (result.ok) {
        setCurrent("");
        setNext("");
        setMessage(GATE_COPY.changed);
      } else {
        setError(knownGateError(result.error) ?? GATE_COPY.changeFailed);
      }
    } catch {
      setError(GATE_COPY.changeFailed);
    } finally {
      setPending(false);
    }
  }

  async function onLogout() {
    setPending(true);
    try {
      await logoutSite();
    } catch {
      // Leave anyway. The cookie clear is best-effort from the browser's side.
    }
    window.location.assign("/login");
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Security</h3>
      {editable === false ? (
        <p className="text-sm text-pretty text-muted">{GATE_COPY.needsDatabase}</p>
      ) : null}
      {editable === true ? (
        <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
          />
          <p className="text-xs text-muted">At least 10 characters.</p>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          {message ? <p className="text-xs text-olive">{message}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="h-11 min-h-11 rounded-full bg-ink px-4 text-sm font-bold text-paper disabled:opacity-40"
          >
            Change password
          </button>
        </form>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => void onLogout()}
        className="h-11 min-h-11 rounded-full border border-line px-4 text-sm font-bold disabled:opacity-40"
      >
        Log out
      </button>
    </section>
  );
}

function BotConnection() {
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [senderKey, setSenderKey] = useState("");
  const [headerMode, setHeaderMode] = useState<HeaderMode>("bearer");
  const [keySet, setKeySet] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pingText, setPingText] = useState<string | null>(null);
  const canPing = savedUrl.trim() !== "";

  useEffect(() => {
    let live = true;
    void fetchBotConnection()
      .then((view) => {
        if (!live) return;
        setUrl(view.webhookUrl);
        setSavedUrl(view.webhookUrl);
        setHeaderMode(view.headerMode);
        setKeySet(view.keySet);
      })
      .catch(() => {
        // Leave the fields empty. The key line stays "not set".
      });
    return () => {
      live = false;
    };
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const view = await saveBotConnection({ data: { webhookUrl: url, webhookKey: senderKey, headerMode } });
      setUrl(view.webhookUrl);
      setSavedUrl(view.webhookUrl);
      setHeaderMode(view.headerMode);
      setKeySet(view.keySet);
      setSenderKey("");
      setNotice("Saved");
    } catch {
      setNotice("Could not save");
    } finally {
      setPending(false);
    }
  }

  async function onPing() {
    setPending(true);
    setPingText(null);
    try {
      const result = await pingBotConnection();
      setPingText(
        result.reason
          ? pingFailureText({ status: result.status, reason: result.reason })
          : result.status == null
            ? "No response"
            : `HTTP ${result.status}`,
      );
    } catch {
      setPingText(pingFailureText({ status: null, reason: "Network error" }));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Grok Bot connection</h3>
      <form onSubmit={(event) => void onSave(event)} className="space-y-3">
        <Field label="Webhook URL" value={url} onChange={setUrl} autoComplete="off" />
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Sender key</span>
          <span className="flex items-center gap-2">
            <input
              type="password"
              value={senderKey}
              autoComplete="off"
              onChange={(event) => setSenderKey(event.target.value)}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-paper-2 px-3 text-base text-ink outline-none"
            />
            <span className="shrink-0 text-base text-muted">{keySet ? "saved" : "not set"}</span>
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Auth header</span>
          <select
            value={headerMode}
            onChange={(event) => setHeaderMode(event.target.value === "x-webhook-key" ? "x-webhook-key" : "bearer")}
            className="h-11 w-full rounded-xl border border-line bg-paper-2 px-3 text-base text-ink outline-none"
          >
            {HEADER_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-full bg-ink px-4 text-base font-semibold text-paper disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            disabled={pending || !canPing}
            onClick={() => void onPing()}
            className="h-11 rounded-full bg-ink/5 px-4 text-base font-semibold disabled:opacity-40"
          >
            Send test ping
          </button>
        </div>
        {pingText ? (
          <p role="status" className="text-base text-ink">
            {pingText}
          </p>
        ) : null}
      </form>
      {notice ? <p className="text-base text-muted">{notice}</p> : null}
    </section>
  );
}

function Settings() {
  const setSettingsOpen = useMail((s) => s.setSettings);
  const settings = useMail((s) => s.settings);
  const update = useMail((s) => s.updateSettings);
  const aliases = useMail((s) => s.aliases);
  const filters = useMail((s) => s.filters);
  const labels = useMail((s) => s.labels);
  const addFilter = useMail((s) => s.addFilter);
  const toggleFilter = useMail((s) => s.toggleFilter);
  const deleteFilter = useMail((s) => s.deleteFilter);
  const deleteLabel = useMail((s) => s.deleteLabel);
  const reset = useMail((s) => s.resetMailbox);
  const setGateMode = useMail((s) => s.setGateMode);
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [labelId, setLabelId] = useState<string>("");
  const [archive, setArchive] = useState(true);
  const [star, setStar] = useState(false);
  const [markRead, setMarkRead] = useState(true);

  return (
    <Sheet title="Settings" onClose={() => setSettingsOpen(false)} wide solid>
      <div className="space-y-8 pb-4">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Profile</h3>
          <Field label="Display name" value={settings.displayName} onChange={(displayName) => update({ displayName })} />
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Signature</span>
            <textarea
              value={settings.signature}
              onChange={(e) => update({ signature: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-line bg-paper-2 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Default from</span>
            <select
              value={settings.defaultFrom}
              onChange={(e) => update({ defaultFrom: e.target.value })}
              className="h-11 w-full rounded-xl border border-line bg-paper-2 px-3 text-sm"
            >
              {aliases.map((alias) => (
                <option key={alias.email} value={alias.email}>
                  {alias.email}
                </option>
              ))}
            </select>
          </label>
        </section>

        <BotConnection />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Appearance</h3>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Background</p>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ["light", "Default"],
                  ["dim", "Dim"],
                  ["lights-out", "Lights out"],
                  ["system", "Device"],
                ] as const
              ).map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ theme: id })}
                  className={
                    settings.theme === id
                      ? "h-11 rounded-full bg-ink text-xs font-bold text-paper"
                      : "h-11 rounded-full bg-ink/5 text-xs font-medium text-muted"
                  }
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <Segment
            label="Density"
            value={settings.density}
            options={[
              ["comfortable", "Comfortable"],
              ["cozy", "Cozy"],
              ["compact", "Compact"],
            ]}
            onChange={(density) => update({ density: density as typeof settings.density })}
          />
          <Segment
            label="Reading pane"
            value={settings.pane}
            options={[
              ["right", "Right"],
              ["none", "List only"],
            ]}
            onChange={(pane) => update({ pane: pane as typeof settings.pane })}
          />
          <label className="block text-sm">
            <span className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
              Glass
              <span className="tabular-nums">{settings.glass}</span>
            </span>
            <input
              type="range"
              min={20}
              max={100}
              value={settings.glass}
              onChange={(e) => update({ glass: Number(e.target.value) })}
              className="w-full"
            />
          </label>
        </section>

        <SiteAddress />
        <SecuritySettings />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Plus addresses</h3>
          <ul className="space-y-1">
            {aliases.map((alias) => (
              <li key={alias.email} className="flex h-11 items-center justify-between rounded-xl bg-ink/5 px-3 text-sm">
                <span className="truncate">{alias.email}</span>
                <span className="text-xs text-muted">{alias.tag ? `+${alias.tag}` : "Primary"}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Vacation</h3>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Vacation reply</span>
            <input type="checkbox" checked={settings.vacationOn} onChange={(e) => update({ vacationOn: e.target.checked })} />
          </label>
          <textarea
            value={settings.vacationText}
            onChange={(e) => update({ vacationText: e.target.value })}
            rows={3}
            className="w-full rounded-xl border border-line bg-paper-2 px-3 py-2 text-sm outline-none"
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Filters</h3>
          <ul className="space-y-2">
            {filters.map((filter) => (
              <li key={filter.id} className="rounded-2xl border border-line p-3 text-sm">
                <p>
                  {filter.fromIncludes ? `From contains “${filter.fromIncludes}”` : "Any sender"}
                  {filter.subjectIncludes ? ` · subject “${filter.subjectIncludes}”` : ""}
                </p>
                <p className="text-xs text-muted">
                  {[
                    filter.labelId ? labels.find((l) => l.id === filter.labelId)?.name : null,
                    filter.archive ? "Done" : null,
                    filter.star ? "Star" : null,
                    filter.markRead ? "Mark read" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No actions"}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="text-xs font-medium text-accent" onClick={() => toggleFilter(filter.id)}>
                    {filter.enabled ? "Turn off" : "Turn on"}
                  </button>
                  <button type="button" className="text-xs font-medium text-danger" onClick={() => deleteFilter(filter.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="space-y-2 rounded-2xl bg-ink/5 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!from && !subject) return;
              addFilter({
                fromIncludes: from,
                subjectIncludes: subject,
                labelId: labelId || null,
                archive,
                star,
                markRead,
                enabled: true,
              });
              setFrom("");
              setSubject("");
            }}
          >
            <Field label="From contains" value={from} onChange={setFrom} placeholder="receipts@" />
            <Field label="Subject contains" value={subject} onChange={setSubject} />
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">Apply label</span>
              <select value={labelId} onChange={(e) => setLabelId(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-paper-2 px-3 text-sm">
                <option value="">None</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Done
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={star} onChange={(e) => setStar(e.target.checked)} /> Star
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={markRead} onChange={(e) => setMarkRead(e.target.checked)} /> Mark read
              </label>
            </div>
            <button type="submit" className="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg">
              Save filter
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            {labels.map((label) => (
              <button key={label.id} type="button" className="h-8 rounded-full bg-ink/5 px-3 text-xs" onClick={() => deleteLabel(label.id)}>
                Remove {label.name}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">New senders</h3>
          <p className="text-sm text-muted">Accept or block stays on this device. The sender is not told.</p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Screening</span>
            <select
              value={gateBookOf(settings.gate).mode}
              onChange={(event) => setGateMode(event.target.value as GateMode)}
              className="h-11 w-full rounded-xl border border-line bg-paper-2 px-3 text-base"
            >
              <option value="off">Off</option>
              <option value="before">Screen before the inbox</option>
              <option value="inside">Screen inside the message</option>
            </select>
          </label>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Quick replies</h3>
          <p className="text-sm text-muted">A tap builds a reply for approval in Grok Bot. Nothing sends on its own.</p>
          {(settings.quickReplies ?? defaultQuickReplies()).map((reply, index) => (
            <div key={reply.id} className="space-y-2 rounded-2xl border border-line p-3">
              <Field
                label="Name"
                value={reply.name}
                onChange={(name) => {
                  const next = [...(settings.quickReplies ?? defaultQuickReplies())];
                  const current = next[index];
                  if (!current) return;
                  next[index] = { ...current, name };
                  update({ quickReplies: next });
                }}
              />
              <Field
                label="Text"
                value={reply.text}
                onChange={(text) => {
                  const next = [...(settings.quickReplies ?? defaultQuickReplies())];
                  const current = next[index];
                  if (!current) return;
                  next[index] = { ...current, text };
                  update({ quickReplies: next });
                }}
              />
              <Field
                label="Emoji"
                value={reply.emoji}
                placeholder="Optional"
                onChange={(emoji) => {
                  const next = [...(settings.quickReplies ?? defaultQuickReplies())];
                  const current = next[index];
                  if (!current) return;
                  next[index] = { ...current, emoji };
                  update({ quickReplies: next });
                }}
              />
              <button
                type="button"
                className="h-11 rounded-full border border-line px-4 text-sm font-medium"
                onClick={() => update({ quickReplies: (settings.quickReplies ?? defaultQuickReplies()).filter((_, item) => item !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
          {(settings.quickReplies ?? defaultQuickReplies()).length < 5 && (
            <button
              type="button"
              className="h-11 rounded-full border border-line px-4 text-sm font-bold"
              onClick={() =>
                update({
                  quickReplies: [
                    ...(settings.quickReplies ?? defaultQuickReplies()),
                    { id: uid(), name: "New reply", text: "Thanks for the note.", emoji: "" },
                  ],
                })
              }
            >
              Add reply
            </button>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Swipes</h3>
          <p className="text-sm text-muted">Saved on this device. A short swipe and a longer swipe can differ.</p>
          {SWIPE_SLOTS.map((slot) => (
            <label key={slot.id} className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{slot.label}</span>
              <select
                value={swipePrefsOf(settings.swipePrefs)[slot.id]}
                onChange={(event) => {
                  const swipePrefs = swipePrefsOf(settings.swipePrefs);
                  update({ swipePrefs: { ...swipePrefs, [slot.id]: event.target.value as SwipeAction } });
                }}
                className="h-11 w-full rounded-xl border border-line bg-paper-2 px-3 text-base"
              >
                {SWIPE_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {swipeActionLabel(action)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Mailbox</h3>
          <button type="button" className="h-11 rounded-full border border-line px-4 text-sm font-bold" onClick={() => reset()}>
            Reload
          </button>
        </section>
      </div>
    </Sheet>
  );
}

function Segment({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      <div className="flex rounded-full bg-ink/5 p-1">
        {options.map(([id, name]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={
              value === id
                ? "h-9 flex-1 rounded-full bg-paper-2 text-xs font-semibold shadow-border"
                : "h-9 flex-1 rounded-full text-xs font-medium text-muted"
            }
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
