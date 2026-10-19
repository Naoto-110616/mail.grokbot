import { Bookmark, Check, Clock, MailOpen, RefreshCw, Star, Tag, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconButton, LabelChip, Monogram, PlusChip } from "@/components/mail/bits";
import { SwipeRow } from "@/components/mail/swipe-row";
import { readKind, starKind } from "@/lib/mail/batch";
import { inboundSenders } from "@/lib/mail/bundles";
import { unreadBadgeLabel, visibleCategoryTabs } from "@/lib/mail/category";
import { emailDomain, gateBookOf, pendingCards, type SenderCard } from "@/lib/mail/gate";
import { pictureInbox } from "@/lib/mail/inbox-zero";
import {
  categoryCount,
  folderLabel,
  formatWhen,
  isDone,
  listSender,
  mineSet,
  snippetOf,
  type Label,
  type Thread,
  activityIso,
} from "@/lib/mail/model";
import { outboxStatusLabel, type OutboxItem } from "@/lib/mail/outbox";
import { actionForReveal, revealSwipe, swipeActionLabel, swipePrefsOf, swipeTone, type SwipeAction } from "@/lib/mail/swipe";
import { useMail } from "@/lib/mail/store";

export function ThreadList({
  rows,
  now,
  onOpen,
  onOpenOutbox,
}: {
  rows: Thread[];
  now: number;
  onOpen: (id: string) => void;
  onOpenOutbox: (id: string) => void;
}) {
  const folder = useMail((s) => s.folder);
  const category = useMail((s) => s.category);
  const setCategory = useMail((s) => s.setCategory);
  const labels = useMail((s) => s.labels);
  const aliases = useMail((s) => s.aliases);
  const account = useMail((s) => s.account);
  const threads = useMail((s) => s.threads);
  const density = useMail((s) => s.settings.density);
  const checked = useMail((s) => s.checked);
  const openId = useMail((s) => s.openId);
  const cursor = useMail((s) => s.cursor);
  const query = useMail((s) => s.query);
  const toggleCheck = useMail((s) => s.toggleCheck);
  const shiftCheck = useMail((s) => s.shiftCheck);
  const checkVisible = useMail((s) => s.checkVisible);
  const act = useMail((s) => s.act);
  const setSnooze = useMail((s) => s.setSnooze);
  const setLabelMenu = useMail((s) => s.setLabelMenu);
  const openSnoozeFor = useMail((s) => s.openSnoozeFor);
  const openLabelFor = useMail((s) => s.openLabelFor);
  const swipePrefs = swipePrefsOf(useMail((s) => s.settings.swipePrefs));
  const checkMail = useMail((s) => s.checkMail);
  const setFolder = useMail((s) => s.setFolder);
  const address = useMail((s) => s.settings.defaultFrom);
  const gate = gateBookOf(useMail((s) => s.settings.gate));
  const gateList = useMail((s) => s.gateList);
  const setGateList = useMail((s) => s.setGateList);
  const decideSenders = useMail((s) => s.decideSenders);
  const blockSenderDomain = useMail((s) => s.blockSenderDomain);
  const pullY = useRef<number | null>(null);
  const emptyFolder = useMail((s) => s.emptyFolder);
  const clearChecks = useMail((s) => s.clearChecks);
  const showDone = useMail((s) => s.showDone);
  const setShowDone = useMail((s) => s.setShowDone);
  const selecting = useMail((s) => s.selecting);
  const setSelecting = useMail((s) => s.setSelecting);
  const setListedIds = useMail((s) => s.setListedIds);
  const outbox = useMail((s) => s.outbox ?? []);
  const cancelOutbox = useMail((s) => s.cancelOutbox);
  const retryOutbox = useMail((s) => s.retryOutbox);
  const destroyForever = useMail((s) => s.destroyForever);
  const [foreverId, setForeverId] = useState<string | null>(null);
  const showChecks = selecting || checked.length > 0;
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const skipClick = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const mine = mineSet(aliases);
  const labelById = new Map(labels.map((l) => [l.id, l]));

  useEffect(() => {
    const id = rows[cursor]?.id;
    if (!id) return;
    document.getElementById(`thread-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, rows]);

  function clearPress() {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  }

  function armPress(event: ReactPointerEvent<HTMLDivElement>, id: string, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearPress();
    const timer = window.setTimeout(() => {
      press.current = null;
      skipClick.current = true;
      setSelecting(true);
      if (!checked.includes(id)) toggleCheck(id, index);
    }, 450);
    press.current = { x: event.clientX, y: event.clientY, timer };
  }

  function movePress(event: ReactPointerEvent<HTMLDivElement>) {
    const current = press.current;
    if (!current) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) clearPress();
  }

  const picture = pictureInbox({
    threads,
    folder,
    category,
    query,
    now,
    aliases,
    account,
    address,
    visible: rows,
  });
  const ids = rows.map((thread) => thread.id);
  const listedKey = ids.join("\n");
  useEffect(() => {
    setListedIds(listedKey ? listedKey.split("\n") : []);
  }, [listedKey, setListedIds]);
  useEffect(() => () => setListedIds([]), [setListedIds]);
  const visibleTabs = visibleCategoryTabs(threads, now, aliases, account);
  const visibleTabKey = visibleTabs.map((tab) => tab.id).join("\n");
  useEffect(() => {
    if (category !== "all" && !visibleTabKey.split("\n").includes(category)) setCategory("all");
  }, [category, visibleTabKey, setCategory]);
  const allOn = ids.length > 0 && ids.every((id) => checked.includes(id));
  const chosen = threads.filter((thread) => checked.includes(thread.id));
  const readAction = readKind(chosen);
  const starAction = starKind(chosen);
  const conversationCount = rows.length;
  const senderCards = pendingCards(threads.filter((thread) => (thread.account ?? "grokbot") === account));
  const showStrip = folder === "inbox" && !query && !gateList && gate.mode === "before" && senderCards.length > 0;

  if (folder === "outbox") {
    return <OutboxList items={outbox} onOpen={onOpenOutbox} onCancel={cancelOutbox} onRetry={retryOutbox} onCheck={checkMail} />;
  }

  return (
    <section className="paper flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-none lg:w-96 lg:flex-none lg:rounded-3xl">
      <header className="flex min-w-0 max-w-full items-center gap-1 border-b border-line py-1 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{query ? "Search" : folderLabel(folder, labels)}</h1>
          <p className="truncate text-sm text-muted">
            {conversationCount} conversation{conversationCount === 1 ? "" : "s"}
            {query ? ` · ${query}` : ""}
          </p>
        </div>
        {checked.length > 0 && (
          <div className="hidden items-center lg:flex">
            <IconButton label="Done" onClick={() => act("archive")}>
              <Check className="size-5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label={readAction === "unread" ? "Unread" : "Read"} onClick={() => act(readAction)}>
              <MailOpen className="size-5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label={starAction === "starOff" ? "Unstar" : "Star"} onClick={() => act(starAction)}>
              <Star className="size-5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Snooze" onClick={() => setSnooze(true)}>
              <Clock className="size-5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Label" onClick={() => setLabelMenu(true)}>
              <Tag className="size-5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Delete" onClick={() => act("trash")}>
              <Trash2 className="size-5" strokeWidth={1.75} />
            </IconButton>
          </div>
        )}
        {checked.length === 0 && folder === "trash" && (
          <button type="button" className="h-11 rounded-full px-3 text-base font-medium text-danger" onClick={emptyFolder}>
            Empty
          </button>
        )}
        {checked.length === 0 && folder === "spam" && (
          <button type="button" className="h-11 rounded-full px-3 text-base font-medium text-danger" onClick={emptyFolder}>
            Empty
          </button>
        )}
        {showChecks && (
          <label className="inline-flex size-11 items-center justify-center">
            <input
              type="checkbox"
              aria-label={allOn ? "Deselect all" : "Select all"}
              checked={allOn}
              onChange={() => checkVisible(ids)}
            />
          </label>
        )}
        {showChecks ? (
          <button
            type="button"
            className="h-11 shrink-0 rounded-full px-3 text-base font-medium text-muted"
            onClick={() => {
              setSelecting(false);
              clearChecks();
            }}
          >
            Cancel
          </button>
        ) : (
          <button type="button" className="h-11 shrink-0 rounded-full px-3 text-base font-semibold text-accent" onClick={() => setSelecting(true)}>
            Select
          </button>
        )}
        {checked.length === 0 && (
          <IconButton label="Check mail" onClick={checkMail}>
            <RefreshCw className="size-5" strokeWidth={1.75} />
          </IconButton>
        )}
      </header>
      {folder === "inbox" && !query && (
        <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto py-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          {!showChecks && (
            <button
              type="button"
              aria-pressed={showDone}
              className={
                showDone
                  ? "h-11 shrink-0 whitespace-nowrap rounded-full bg-paper-2 px-3 text-base font-semibold text-ink shadow-border"
                  : "h-11 shrink-0 whitespace-nowrap rounded-full px-3 text-base font-medium text-muted"
              }
              onClick={() => setShowDone(!showDone)}
            >
              {showDone ? "Showing done" : "Show done"}
            </button>
          )}
          <div className="flex shrink-0 gap-1" role="tablist" aria-label="Categories">
            {visibleTabs.map((tab) => {
              const count = categoryCount(threads, tab.id, now, aliases, account);
              const badge = unreadBadgeLabel(count);
              const on = category === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setCategory(on ? "all" : tab.id)}
                  className={
                    on
                      ? "h-11 shrink-0 whitespace-nowrap rounded-full bg-paper-2 px-3 text-base font-semibold text-ink shadow-border"
                      : "h-11 shrink-0 whitespace-nowrap rounded-full px-3 text-base font-medium text-muted"
                  }
                >
                  {tab.label}
                  {badge && (
                    <span
                      className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-accent-fg"
                      aria-label={badge}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {showStrip && (
        <NewSenderStrip
          cards={senderCards}
          onSeeAll={() => setGateList(true)}
          onAccept={(email) => decideSenders([email], "accepted")}
          onBlock={(email) => decideSenders([email], "blocked")}
          onDomain={blockSenderDomain}
        />
      )}
      <div
        ref={box}
        className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pb-[calc(5.375rem+env(safe-area-inset-bottom))] lg:pb-2"
        onPointerDown={(event) => {
          if (!box.current || box.current.scrollTop > 0) return;
          if (event.target instanceof Element && event.target.closest(".row, button, a, input, label")) return;
          pullY.current = event.clientY;
        }}
        onPointerUp={(event) => {
          if (pullY.current == null) return;
          const pulled = event.clientY - pullY.current;
          pullY.current = null;
          if (pulled > 64) checkMail();
        }}
      >
        {gateList ? (
          <SenderReview
            cards={senderCards}
            onBack={() => setGateList(false)}
            onAccept={(email) => decideSenders([email], "accepted")}
            onBlock={(email) => decideSenders([email], "blocked")}
            onDomain={blockSenderDomain}
            onAcceptAll={() => decideSenders(senderCards.map((card) => card.email), "accepted")}
            onBlockAll={() => decideSenders(senderCards.map((card) => card.email), "blocked")}
          />
        ) : picture.kind === "fresh" ? (
          <FreshAddress address={picture.address} />
        ) : picture.kind === "clear" ? (
          <InboxClear
            handled={picture.handled}
            snoozeAt={picture.snoozeAt}
            onSnoozed={() => setFolder("snoozed")}
            onDone={() => setFolder("done")}
          />
        ) : rows.length === 0 ? (
          <Empty query={query} fresh={false} />
        ) : (
          <ul>
            {rows.map((thread, index) => {
              const sender = listSender(thread, mine);
              const when = formatWhen(thread.draft?.updatedAt && thread.messages.length === 0 ? thread.draft.updatedAt : activityIso(thread));
              const chips = thread.labels.map((id) => labelById.get(id)).filter((l) => l != null);
              const snippet = snippetOf(thread);
              const draftMark = Boolean(thread.draft && thread.messages.length > 0);
              const rowPad = density === "compact" ? "h-14 items-center" : density === "cozy" ? "h-[76px] items-center" : "items-start py-1.5";
              const done = isDone(thread);
              return (
                <li key={thread.id}>
                  <SwipeRow
                    enabled={!showChecks}
                    preview={(dx) => {
                      const reveal = revealSwipe(dx);
                      const action = reveal ? actionForReveal(swipePrefs, reveal) : "done";
                      return { label: swipeActionLabel(action, thread.unread), className: swipeTone(action) };
                    }}
                    onSwipeLock={() => {
                      clearPress();
                      skipClick.current = true;
                    }}
                    onCommit={(reveal) => {
                      if (!reveal.commit) return false;
                      skipClick.current = true;
                      return runSwipeAction(actionForReveal(swipePrefs, reveal), thread, {
                        act,
                        openSnoozeFor,
                        openLabelFor,
                      });
                    }}
                  >
                  <div
                    id={`thread-${thread.id}`}
                    role="button"
                    tabIndex={0}
                    data-active={openId === thread.id}
                    data-cursor={cursor === index}
                    data-done={done}
                    className={`row group flex w-full min-w-0 max-w-full gap-2 border-b border-line text-left pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] ${rowPad}`}
                    onPointerDown={(event) => armPress(event, thread.id, index)}
                    onPointerMove={movePress}
                    onPointerUp={clearPress}
                    onPointerCancel={clearPress}
                    onPointerLeave={clearPress}
                    onContextMenu={(event) => event.preventDefault()}
                    onClick={() => {
                      if (skipClick.current) {
                        skipClick.current = false;
                        return;
                      }
                      if (showChecks) {
                        toggleCheck(thread.id, index);
                        return;
                      }
                      onOpen(thread.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onOpen(thread.id);
                    }}
                  >
                    {showChecks && (
                      <label className="inline-flex size-9 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${thread.subject || "conversation"}`}
                          checked={checked.includes(thread.id)}
                          onChange={(e) => {
                            if (e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey) shiftCheck(index, ids);
                            else toggleCheck(thread.id, index);
                          }}
                        />
                      </label>
                    )}
                    {density !== "compact" && (
                      <Monogram
                        className="size-10"
                        name={sender.replace(/^To:\s*/, "")}
                        email={thread.messages[0]?.from.email ?? "draft"}
                      />
                    )}
                    {density === "compact" ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                        {thread.unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                        <span className="min-w-0 flex-1 truncate text-sm font-bold leading-5">
                          {thread.draft && thread.messages.length === 0 ? "Draft" : sender}
                          {thread.subject ? <span className="font-normal text-muted"> · {thread.subject}</span> : null}
                        </span>
                        <span className="max-w-[7rem] shrink-0 truncate text-xs leading-4 text-muted tabular-nums">{when}</span>
                        <RowActions
                          thread={thread}
                          chips={chips}
                          folder={folder}
                          onAccept={() => {
                            const email = inboundSenders(thread).at(-1);
                            if (email) decideSenders([email], "accepted");
                          }}
                          onStar={() => act("star", [thread.id])}
                          onDone={() => act("archive", [thread.id])}
                          onForever={() => setForeverId(thread.id)}
                        />
                      </span>
                    ) : density === "cozy" ? (
                      <span className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
                        <span className="flex min-w-0 items-center gap-1.5 leading-5">
                          {thread.unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                          <span className="min-w-0 truncate text-sm font-bold leading-5">
                            {thread.draft && thread.messages.length === 0 ? "Draft" : sender}
                          </span>
                          <span className="ml-auto max-w-[7rem] shrink-0 truncate text-xs leading-4 text-muted tabular-nums">{when}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                          <span className="min-w-0 flex-1 truncate text-sm font-bold leading-5">{thread.subject || "(no subject)"}</span>
                          <RowActions
                            thread={thread}
                            chips={chips}
                            folder={folder}
                            onAccept={() => {
                              const email = inboundSenders(thread).at(-1);
                              if (email) decideSenders([email], "accepted");
                            }}
                            onStar={() => act("star", [thread.id])}
                            onDone={() => act("archive", [thread.id])}
                            onForever={() => setForeverId(thread.id)}
                          />
                        </span>
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="flex min-w-0 items-center gap-1.5 leading-5">
                          {thread.unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                          <span className="min-w-0 truncate text-sm font-bold leading-5">
                            {thread.draft && thread.messages.length === 0 ? "Draft" : sender}
                          </span>
                          <span className="ml-auto max-w-[7rem] shrink-0 truncate text-xs leading-4 text-muted tabular-nums">{when}</span>
                        </span>
                        <span className="block max-w-full truncate text-sm font-bold leading-5">{thread.subject || "(no subject)"}</span>
                        <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                          <span className="min-w-0 flex-1 truncate text-xs leading-4 text-muted">
                            {draftMark && <span className="text-accent">Draft · </span>}
                            {snippet}
                          </span>
                          <RowActions
                            thread={thread}
                            chips={chips}
                            folder={folder}
                            onAccept={() => {
                              const email = inboundSenders(thread).at(-1);
                              if (email) decideSenders([email], "accepted");
                            }}
                            onStar={() => act("star", [thread.id])}
                            onDone={() => act("archive", [thread.id])}
                            onForever={() => setForeverId(thread.id)}
                          />
                        </span>
                      </span>
                    )}
                  </div>
                  </SwipeRow>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {foreverId && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
          <button type="button" aria-label="Cancel" className="absolute inset-0 bg-ink/30" onClick={() => setForeverId(null)} />
          <div role="dialog" aria-labelledby="delete-forever-title" className="relative w-full max-w-sm rounded-3xl border border-line bg-paper p-4 shadow-lg">
            <p id="delete-forever-title" className="text-base font-bold">Delete this conversation forever?</p>
            <p className="mt-1 text-base text-muted">This cannot be undone.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="h-11 flex-1 rounded-full bg-danger text-base font-semibold text-white"
                onClick={() => {
                  destroyForever(foreverId);
                  setForeverId(null);
                }}
              >
                Delete forever
              </button>
              <button type="button" className="h-11 flex-1 rounded-full border border-line text-base font-semibold" onClick={() => setForeverId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function NewSenderStrip({
  cards,
  onSeeAll,
  onAccept,
  onBlock,
  onDomain,
}: {
  cards: SenderCard[];
  onSeeAll: () => void;
  onAccept: (email: string) => void;
  onBlock: (email: string) => void;
  onDomain: (domain: string) => void;
}) {
  return (
    <div className="min-w-0 max-w-full border-b border-line py-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold">New senders</p>
        <span className="text-sm font-semibold text-accent tabular-nums">{cards.length}</span>
        <button type="button" className="h-11 rounded-full px-3 text-sm font-semibold text-accent" onClick={onSeeAll}>
          See all
        </button>
      </div>
      <div className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1">
        {cards.slice(0, 8).map((card) => (
          <SenderFace key={card.email} card={card} onAccept={onAccept} onBlock={onBlock} onDomain={onDomain} />
        ))}
      </div>
    </div>
  );
}

function SenderReview({
  cards,
  onBack,
  onAccept,
  onBlock,
  onDomain,
  onAcceptAll,
  onBlockAll,
}: {
  cards: SenderCard[];
  onBack: () => void;
  onAccept: (email: string) => void;
  onBlock: (email: string) => void;
  onDomain: (domain: string) => void;
  onAcceptAll: () => void;
  onBlockAll: () => void;
}) {
  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="h-11 rounded-full px-3 text-sm font-semibold text-muted" onClick={onBack}>
          Back
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-bold">New senders</p>
        {cards.length > 0 && (
          <>
            <button type="button" className="h-11 rounded-full bg-accent px-3 text-sm font-semibold text-accent-fg" onClick={onAcceptAll}>
              Accept all
            </button>
            <button type="button" className="h-11 rounded-full bg-ink/5 px-3 text-sm font-semibold text-ink" onClick={onBlockAll}>
              Block all
            </button>
          </>
        )}
      </div>
      {cards.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted">No new senders.</p>
      ) : (
        cards.map((card) => (
          <SenderFace key={card.email} card={card} wide onAccept={onAccept} onBlock={onBlock} onDomain={onDomain} />
        ))
      )}
    </div>
  );
}

function SenderFace({
  card,
  wide,
  onAccept,
  onBlock,
  onDomain,
}: {
  card: SenderCard;
  wide?: boolean;
  onAccept: (email: string) => void;
  onBlock: (email: string) => void;
  onDomain: (domain: string) => void;
}) {
  return (
    <article className={wide ? "rounded-2xl border border-line bg-paper-2 p-3" : "w-64 shrink-0 rounded-2xl border border-line bg-paper-2 p-3"}>
      <div className="flex items-center gap-2">
        <Monogram className="size-10" name={card.name} email={card.email} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{card.name}</span>
          <span className="block truncate text-xs text-muted">{card.email}</span>
        </span>
      </div>
      {card.plusTag && <p className="mt-2 text-xs font-semibold text-accent">+{card.plusTag}</p>}
      <p className="mt-1 truncate text-sm font-bold">{card.subject}</p>
      {card.preview && <p className="truncate text-xs text-muted">{card.preview}</p>}
      <div className="mt-3 flex flex-wrap gap-1">
        <button type="button" className="h-11 rounded-full bg-accent px-3 text-sm font-semibold text-accent-fg" onClick={() => onAccept(card.email)}>
          Accept
        </button>
        <button type="button" className="h-11 rounded-full bg-ink/5 px-3 text-sm font-semibold text-ink" onClick={() => onBlock(card.email)}>
          Block
        </button>
        <button type="button" className="h-11 rounded-full px-3 text-sm font-medium text-muted" onClick={() => onDomain(emailDomain(card.email))}>
          Block domain
        </button>
      </div>
    </article>
  );
}

function runSwipeAction(
  action: SwipeAction,
  thread: Thread,
  api: {
    act: (kind: "archive" | "trash" | "star" | "read" | "unread", ids: string[]) => void;
    openSnoozeFor: (ids: string[]) => void;
    openLabelFor: (ids: string[]) => void;
  },
): boolean {
  const ids = [thread.id];
  if (action === "done") {
    api.act("archive", ids);
    return true;
  }
  if (action === "delete") {
    api.act("trash", ids);
    return true;
  }
  if (action === "star") {
    api.act("star", ids);
    return false;
  }
  if (action === "read") {
    api.act(thread.unread ? "read" : "unread", ids);
    return false;
  }
  if (action === "snooze") {
    api.openSnoozeFor(ids);
    return false;
  }
  api.openLabelFor(ids);
  return false;
}

const chipClass = "max-w-24 shrink-0 px-1.5 py-0 text-[11px] leading-4";

function stopRow(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function RowActions({
  thread,
  chips,
  folder,
  onAccept,
  onStar,
  onDone,
  onForever,
}: {
  thread: Thread;
  chips: Label[];
  folder: string;
  onAccept: () => void;
  onStar: () => void;
  onDone: () => void;
  onForever: () => void;
}) {
  return (
    <>
      <RowChips thread={thread} chips={chips} />
      {folder === "blocked" && (
        <button
          type="button"
          className="h-11 min-w-0 max-w-full shrink truncate rounded-full px-2 text-base font-semibold text-accent"
          onPointerDown={stopRow}
          onClick={(event) => {
            stopRow(event);
            onAccept();
          }}
        >
          Accept sender
        </button>
      )}
      <button
        type="button"
        aria-label={thread.starred ? "Unstar" : "Star"}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-ink/5"
        onPointerDown={stopRow}
        onClick={(event) => {
          stopRow(event);
          onStar();
        }}
      >
        <Star className={thread.starred ? "size-4 fill-brass text-brass" : "size-4 text-faint"} strokeWidth={1.75} />
      </button>
      {folder === "trash" ? (
        <button
          type="button"
          aria-label="Delete forever"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-full px-2 text-base font-semibold text-danger"
          onPointerDown={stopRow}
          onClick={(event) => {
            stopRow(event);
            onForever();
          }}
        >
          Delete forever
        </button>
      ) : (
        <button
          type="button"
          aria-label="Done"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-accent hover:bg-ink/5"
          onPointerDown={stopRow}
          onClick={(event) => {
            stopRow(event);
            onDone();
          }}
        >
          <Check className="size-4" strokeWidth={1.75} />
        </button>
      )}
    </>
  );
}

function RowChips({ thread, chips }: { thread: Thread; chips: Label[] }) {
  if (!thread.plusTag && chips.length === 0 && !thread.important) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {thread.plusTag && <PlusChip tag={thread.plusTag} className={chipClass} />}
      {chips.map((label) => (
        <LabelChip key={label.id} label={label} className={chipClass} />
      ))}
      {thread.important && <Bookmark className="size-3.5 shrink-0 text-brass" aria-label="Important" />}
    </span>
  );
}

function byNewest(a: OutboxItem, b: OutboxItem): number {
  const at = b.createdAt.localeCompare(a.createdAt);
  if (at !== 0) return at;
  return b.id.localeCompare(a.id);
}

function OutboxList({
  items,
  onOpen,
  onCancel,
  onRetry,
  onCheck,
}: {
  items: OutboxItem[];
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onCheck: () => void;
}) {
  const rows = [...items].sort(byNewest);
  return (
    <section className="paper flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-none lg:w-96 lg:flex-none lg:rounded-3xl">
      <header className="flex min-w-0 max-w-full items-center gap-1 border-b border-line py-1 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">Outbox</h1>
          <p className="truncate text-xs text-muted">
            {rows.length} send{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <IconButton label="Check mail" onClick={onCheck}>
          <RefreshCw className="size-5" strokeWidth={1.75} />
        </IconButton>
      </header>
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pb-[calc(5.375rem+env(safe-area-inset-bottom))] lg:pb-2">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-64 max-w-full flex-col items-center justify-center px-3 text-center">
            <p className="wrap-anywhere max-w-full text-xl font-bold text-balance">No mail waiting to send.</p>
          </div>
        ) : (
          <ul>
            {rows.map((item) => {
              const to = item.to.filter(Boolean).join(", ");
              const cc = item.cc.filter(Boolean).join(", ");
              const who = [to ? `To: ${to}` : "To: —", cc ? `Cc: ${cc}` : ""].filter(Boolean).join(" · ");
              return (
                <li key={item.id} className="min-w-0 max-w-full border-b border-line">
                  <button
                    type="button"
                    className="block w-full min-w-0 max-w-full py-3 text-left pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
                    onClick={() => onOpen(item.id)}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.subject || "(no subject)"}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">{formatWhen(item.createdAt)}</span>
                    </span>
                    <span className="block truncate text-base text-muted">{who}</span>
                    <span className="mt-1 block text-base">{outboxStatusLabel(item.status, item.error)}</span>
                  </button>
                  {item.status === "queued" ? (
                    <div className="pb-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
                      <button
                        type="button"
                        className="h-11 rounded-full bg-ink/5 px-3 text-base font-semibold"
                        onClick={() => onCancel(item.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {item.status === "failed" ? (
                    <div className="pb-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
                      <button
                        type="button"
                        className="h-11 rounded-full bg-ink/5 px-3 text-base font-semibold"
                        onClick={() => onRetry(item.id)}
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Empty({ query, fresh }: { query: string; fresh: boolean }) {
  return (
    <div className="flex h-full min-h-64 max-w-full flex-col items-center justify-center px-3 text-center">
      <p className="wrap-anywhere max-w-full text-xl font-bold text-balance">
        {fresh ? "No mail yet. Your bot will deliver new mail here." : query ? "No results" : "No messages"}
      </p>
    </div>
  );
}

function FreshAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rise flex h-full min-h-64 max-w-full flex-col items-center justify-center px-3 text-center">
      <p className="wrap-anywhere max-w-full text-xl font-bold text-balance text-ink">No mail yet. Your bot will deliver new mail here.</p>
      <p className="mt-3 max-w-full truncate text-sm text-ink">{address}</p>
      <button
        type="button"
        className="mt-3 h-11 rounded-full bg-ink px-4 text-sm font-semibold text-paper"
        onClick={() => {
          void navigator.clipboard?.writeText(address).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy address"}
      </button>
    </div>
  );
}

function InboxClear({
  handled,
  snoozeAt,
  onSnoozed,
  onDone,
}: {
  handled: number;
  snoozeAt: string | null;
  onSnoozed: () => void;
  onDone: () => void;
}) {
  return (
    <div className="rise flex h-full min-h-64 flex-col items-center justify-center px-8 text-center">
      <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden>
        <Check className="size-7" strokeWidth={1.75} />
      </span>
      <p className="text-xl font-bold text-ink">Inbox is clear</p>
      <p className="mt-2 text-sm text-muted">{handled === 1 ? "1 handled today" : `${handled} handled today`}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" className="h-11 rounded-full bg-ink/5 px-4 text-sm font-semibold text-ink" onClick={onSnoozed}>
          Snoozed{snoozeAt ? ` · ${formatWhen(snoozeAt)}` : ""}
        </button>
        <button type="button" className="h-11 rounded-full bg-ink/5 px-4 text-sm font-semibold text-ink" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
