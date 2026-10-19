import {
  Check,
  Bookmark,
  ChevronLeft,
  Clock,
  Download,
  Forward,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton, LabelChip, Monogram, PlusChip, Sheet } from "@/components/mail/bits";
import type { AttachmentBody } from "@/lib/mail/backend";
import { HtmlMail } from "@/components/mail/html-mail";
import { parseBody, quotedControlLabel, type BodyBlock, type Inline } from "@/lib/mail/body-text";
import { htmlIsVisible } from "@/lib/mail/html-mail";
import { initialHeaderOpenIds } from "@/lib/mail/reader-open";
import {
  type Attachment,
  type Message,
  CATEGORIES,
  attachmentBlobParts,
  formatAddress,
  formatFull,
  formatWhen,
  mineSet,
} from "@/lib/mail/model";
import { inboundSenders } from "@/lib/mail/bundles";
import { emailDomain, latestInbound } from "@/lib/mail/gate";
import { chipsAllowed, otherRecipients, quickRepliesOf } from "@/lib/mail/quick";
import { useMail } from "@/lib/mail/store";

export function Reader({ onBack, split }: { onBack: () => void; split: boolean }) {
  const openId = useMail((s) => s.openId);
  const thread = useMail((s) => s.threads.find((t) => t.id === openId) ?? null);
  const labels = useMail((s) => s.labels);
  const act = useMail((s) => s.act);
  const openCompose = useMail((s) => s.openCompose);
  const setSnooze = useMail((s) => s.setSnooze);
  const setLabelMenu = useMail((s) => s.setLabelMenu);
  const moveSender = useMail((s) => s.moveSender);
  const decideSenders = useMail((s) => s.decideSenders);
  const blockSenderDomain = useMail((s) => s.blockSenderDomain);
  const sendQuick = useMail((s) => s.sendQuick);
  const quickReplies = quickRepliesOf(useMail((s) => s.settings.quickReplies));
  const aliases = useMail((s) => s.aliases);
  const [replyAll, setReplyAll] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(false);
  const focusMessageId = useMail((s) => s.focusMessageId);
  const [menu, setMenu] = useState(false);
  // Header details only. Bodies stay visible. A single message starts collapsed; a thread opens the latest header.
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [file, setFile] = useState<Attachment | null>(null);
  const [fileBody, setFileBody] = useState<AttachmentBody | null>(null);
  const [fileNote, setFileNote] = useState<"missing" | "error" | null>(null);
  const loadAttachment = useMail((s) => s.loadAttachment);
  const focusRef = useRef<HTMLElement | null>(null);

  const threadId = thread?.id;
  const lastMessageId = thread?.messages[thread.messages.length - 1]?.id;
  const headerKey = thread?.messages.map((message) => message.id).join("\n") ?? "";
  const focused =
    focusMessageId && thread?.messages.some((message) => message.id === focusMessageId) ? focusMessageId : null;
  useEffect(() => {
    setOpenIds(initialHeaderOpenIds(headerKey ? headerKey.split("\n") : []));
    setMenu(false);
    setReplyAll(false);
    setChipsOpen(false);
  }, [threadId, lastMessageId, focused, headerKey]);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "nearest" });
  }, [threadId, focused]);
  useEffect(() => {
    if (!file) {
      setFileBody(null);
      setFileNote(null);
      return;
    }
    let cancel = false;
    setFileBody(null);
    setFileNote(null);
    void loadAttachment(file).then(
      (body) => {
        if (cancel) return;
        if (!body) setFileNote("missing");
        else setFileBody(body);
      },
      () => {
        if (!cancel) setFileNote("error");
      },
    );
    return () => {
      cancel = true;
    };
  }, [file, loadAttachment]);

  if (!thread) {
    return (
      <section className="paper hidden min-h-0 min-w-0 flex-1 flex-col items-center justify-center rounded-3xl px-8 text-center lg:flex">
        <p className="text-xl font-bold">Select a conversation</p>
      </section>
    );
  }

  const chips = thread.labels.map((id) => labels.find((l) => l.id === id)).filter((l) => l != null);
  const sender = inboundSenders(thread).at(-1) ?? "";
  const inbound = latestInbound(thread);
  const many = inbound ? otherRecipients(inbound, mineSet(aliases)).length > 1 : false;
  const showChips = chipsAllowed(thread) && quickReplies.length > 0;

  return (
    <section className="paper flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-none lg:rounded-3xl">
      <header className="flex min-w-0 max-w-full items-center gap-0.5 border-b border-line px-1 py-1">
        {!split && (
          <IconButton label="Back to list" onClick={onBack}>
            <ChevronLeft className="size-5" />
          </IconButton>
        )}
        <IconButton label="Done" onClick={() => act("archive", [thread.id])}>
          <Check className="size-5" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Delete" onClick={() => act("trash", [thread.id])}>
          <Trash2 className="size-5" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Snooze" onClick={() => setSnooze(true)}>
          <Clock className="size-5" strokeWidth={1.75} />
        </IconButton>
        <IconButton label={thread.starred ? "Unstar" : "Star"} onClick={() => act("star", [thread.id])} active={thread.starred}>
          <Star className={thread.starred ? "size-5 fill-brass text-brass" : "size-5"} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Label" onClick={() => setLabelMenu(true)}>
          <Tag className="size-5" strokeWidth={1.75} />
        </IconButton>
        <span className="relative ml-auto">
          <IconButton label="More actions" active={menu} onClick={() => setMenu((v) => !v)}>
            <MoreHorizontal className="size-5" />
          </IconButton>
          {menu && (
            <div className="absolute right-0 top-12 z-20 w-60 rounded-2xl border border-line bg-paper p-1 shadow-lg">
              <MenuBtn onClick={() => act("unread", [thread.id])}>Mark unread</MenuBtn>
              <MenuBtn onClick={() => act("read", [thread.id])}>Mark read</MenuBtn>
              <MenuBtn onClick={() => act("important", [thread.id])}>
                {thread.important ? "Not important" : "Mark important"}
              </MenuBtn>
              <MenuBtn onClick={() => act("mute", [thread.id])}>{thread.muted ? "Unmute" : "Mute"}</MenuBtn>
              <MenuBtn onClick={() => act("spam", [thread.id])}>Report spam</MenuBtn>
              <MenuBtn onClick={() => act("inbox", [thread.id])}>Move to inbox</MenuBtn>
              {inboundSenders(thread).at(-1) &&
                CATEGORIES.map((tab) => (
                  <MenuBtn
                    key={tab.id}
                    onClick={() => {
                      moveSender(inboundSenders(thread).at(-1) ?? "", tab.id);
                      setMenu(false);
                    }}
                  >
                    {`File sender in ${tab.label}`}
                  </MenuBtn>
                ))}
              <MenuBtn
                onClick={() => {
                  openCompose(thread.draft ? thread.draft.mode : "reply", thread.id);
                }}
              >
                {thread.draft ? "Resume draft" : "Reply"}
              </MenuBtn>
            </div>
          )}
        </span>
      </header>
      <div className="mail-body min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto py-5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-8" onClick={() => setMenu(false)}>
        <div className="mx-auto min-w-0 max-w-2xl">
          {sender && (thread.review || thread.screen === "pending" || thread.screen === "blocked") && (
            <div className="mb-4 rounded-2xl border border-line bg-paper-2 p-3">
              <p className="text-sm font-bold">{thread.screen === "blocked" ? "Blocked sender" : "New sender"}</p>
              <p className="mt-1 truncate text-sm text-muted">{sender}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg" onClick={() => decideSenders([sender], "accepted")}>
                  {thread.screen === "blocked" ? "Accept sender" : "Accept"}
                </button>
                {thread.screen !== "blocked" && (
                  <button type="button" className="h-11 rounded-full bg-ink/5 px-4 text-sm font-semibold text-ink" onClick={() => decideSenders([sender], "blocked")}>
                    Block
                  </button>
                )}
                <button type="button" className="h-11 rounded-full px-4 text-sm font-medium text-muted" onClick={() => blockSenderDomain(emailDomain(sender))}>
                  Block domain
                </button>
              </div>
            </div>
          )}
          <h1 className="wrap-anywhere max-w-full text-lg font-bold leading-6 text-balance">{thread.subject || "(no subject)"}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {thread.plusTag && <PlusChip tag={thread.plusTag} />}
            {chips.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
            {thread.important && (
              <span className="inline-flex items-center gap-1 text-xs text-brass">
                <Bookmark className="size-3.5" /> Important
              </span>
            )}
            {thread.snoozeUntil && Date.parse(thread.snoozeUntil) > Date.now() && (
              <span className="text-xs text-muted">Snoozed until {formatWhen(thread.snoozeUntil)}</span>
            )}
          </div>
          <div className="mt-3 space-y-1">
            {thread.messages.map((message) => {
              const open = openIds.includes(message.id);
              return (
                <article
                  key={message.id}
                  ref={focused === message.id ? focusRef : undefined}
                  className="min-w-0 rounded-2xl border border-line bg-paper-2"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    className={`flex min-h-11 w-full min-w-0 max-w-full gap-3 px-3 py-2 text-left ${open ? "items-start" : "items-center"}`}
                    onClick={() =>
                      setOpenIds((current) =>
                        current.includes(message.id) ? current.filter((id) => id !== message.id) : [...current, message.id],
                      )
                    }
                  >
                    <MessageHeader message={message} open={open} />
                  </button>
                  <div className="min-w-0 max-w-full px-3 pb-4">
                    {message.html && htmlIsVisible(message.html) ? <HtmlMail html={message.html} /> : <Body text={message.body} />}
                    {message.attachments.length > 0 && (
                      <ul className="mt-4 flex flex-col gap-2">
                        {message.attachments.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => setFile(item)}
                              className="flex h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left text-sm hover:bg-ink/5"
                            >
                              <Paperclip className="size-4 shrink-0 text-muted" />
                              <span className="min-w-0 flex-1 truncate">{item.filename}</span>
                              <span className="text-xs text-muted tabular-nums">{Math.max(1, Math.round(item.bytes / 1024))} KB</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {thread.draft && (
            <button
              type="button"
              onClick={() => openCompose(thread.draft?.mode ?? "reply", thread.id)}
              className="mt-4 w-full rounded-2xl border border-dashed border-line px-4 py-3 text-left"
            >
              <span className="text-xs font-semibold text-accent">Draft</span>
              <span className="mt-1 block truncate text-sm text-muted">{thread.draft.body.replace(/\s+/g, " ").slice(0, 140) || "Empty draft"}</span>
            </button>
          )}
        </div>
      </div>
      <div
        className="safe-bottom flex min-w-0 max-w-full gap-2 overflow-x-auto border-t border-line py-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
        role="group"
        aria-label="Reply"
      >
        <TextBtn className="shrink-0" onClick={() => openCompose("reply", thread.id)}>
          <Reply className="size-4 shrink-0" /> Reply
        </TextBtn>
        <TextBtn className="shrink-0" onClick={() => openCompose("replyAll", thread.id)}>
          <ReplyAll className="size-4 shrink-0" /> All
        </TextBtn>
        <TextBtn className="shrink-0" onClick={() => openCompose("forward", thread.id)}>
          <Forward className="size-4 shrink-0" /> Forward
        </TextBtn>
        {showChips && (
          <TextBtn className="shrink-0" pressed={chipsOpen} expanded={chipsOpen} onClick={() => setChipsOpen((open) => !open)}>
            {chipsOpen ? "Hide replies" : "Replies"}
          </TextBtn>
        )}
        {showChips && chipsOpen && many && (
          <button
            type="button"
            aria-pressed={replyAll}
            className={`h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${replyAll ? "border-ink bg-ink text-paper" : "border-line"}`}
            onClick={() => setReplyAll((value) => !value)}
          >
            {replyAll ? "Reply all" : "Reply to sender"}
          </button>
        )}
        {showChips &&
          chipsOpen &&
          quickReplies.map((reply) => (
            <button
              key={reply.id}
              type="button"
              className="h-11 shrink-0 rounded-full border border-line px-4 text-sm font-medium hover:bg-ink/5"
              onClick={() => sendQuick(thread.id, reply.id, many && replyAll ? "replyAll" : "reply")}
            >
              {reply.emoji ? `${reply.emoji} ` : ""}
              {reply.name}
            </button>
          ))}
      </div>
      {file && (
        <Sheet title={file.filename} onClose={() => setFile(null)} wide>
          {fileNote === "error" ? (
            <p className="text-base text-ink">Could not read this file.</p>
          ) : fileNote === "missing" ? (
            <p className="text-base text-ink">Not downloaded yet.</p>
          ) : fileBody?.text ? (
            <pre className="mail-body max-h-80 max-w-full overflow-auto whitespace-pre-wrap rounded-2xl bg-paper-2 p-3 font-sans text-base text-ink">{fileBody.text}</pre>
          ) : fileBody?.base64 ? (
            <p className="text-base text-ink">This file is ready to download.</p>
          ) : (
            <p className="text-base text-muted">Reading this file.</p>
          )}
          <button
            type="button"
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-base font-semibold text-accent-fg disabled:opacity-50"
            disabled={!fileBody}
            onClick={() => {
              if (fileBody) download(file, fileBody);
            }}
          >
            <Download className="size-4" /> Download
          </button>
        </Sheet>
      )}
    </section>
  );
}

function MessageHeader({ message, open }: { message: Message; open: boolean }) {
  const people = (list: Message["to"]) => list.map(formatAddress).join(", ");
  if (!open) {
    return (
      <>
        <Monogram name={message.from.name} email={message.from.email} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{message.from.name || message.from.email}</span>
        <span className="shrink-0 truncate text-xs text-muted tabular-nums">{formatWhen(message.date)}</span>
      </>
    );
  }
  return (
    <>
      <Monogram name={message.from.name} email={message.from.email} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{message.from.name || message.from.email}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">From {formatAddress(message.from)}</span>
        <span className="block truncate text-xs text-muted">To {people(message.to) || "—"}</span>
        {message.cc.length > 0 && <span className="block truncate text-xs text-muted">Cc {people(message.cc)}</span>}
        <span className="block truncate text-xs text-muted">{formatFull(message.date)}</span>
      </span>
    </>
  );
}

function MenuBtn({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" className="menu-item" onClick={onClick}>
      {children}
    </button>
  );
}

function TextBtn({
  children,
  onClick,
  className = "",
  pressed,
  expanded,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
  pressed?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-expanded={expanded}
      className={`inline-flex h-11 min-w-0 items-center justify-center gap-2 overflow-hidden rounded-full border px-3 text-sm font-medium hover:bg-ink/5 ${pressed ? "border-ink bg-ink text-paper" : "border-line"} ${className}`}
    >
      {children}
    </button>
  );
}

function Body({ text }: { text: string }) {
  const doc = useMemo(() => parseBody(text), [text]);
  // A cut that leaves no visible prose would look blank. Show that text instead.
  const blocks = doc.blocks.length > 0 ? doc.blocks : (doc.hidden ?? []);
  const hidden = doc.blocks.length > 0 ? doc.hidden : null;
  const [trimmed, setTrimmed] = useState(false);
  const quotedLabel = quotedControlLabel(hidden, trimmed);
  return (
    <div className="mail-body min-w-0 max-w-full space-y-4 text-[17px] font-normal leading-[1.5] text-ink">
      <BodyBlocks blocks={blocks} />
      {quotedLabel ? (
        <div>
          <button
            type="button"
            aria-expanded={trimmed}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-base text-ink hover:bg-ink/5"
            onClick={() => setTrimmed((open) => !open)}
          >
            {quotedLabel}
          </button>
          {trimmed && hidden ? (
            <div className="mt-3 space-y-4 text-muted">
              <BodyBlocks blocks={hidden} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BodyBlocks({ blocks }: { blocks: BodyBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "links") {
          return (
            <p key={index} className="flex flex-wrap gap-x-3 gap-y-1">
              {block.links.map((link, linkIndex) => (
                <Anchor key={linkIndex} href={link.href} label={link.label} tall />
              ))}
            </p>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inlines inlines={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={index} className="wrap-anywhere whitespace-pre-wrap border-l-2 border-line pl-3 text-muted">
              <Inlines inlines={block.inlines} />
            </blockquote>
          );
        }
        if (block.kind === "machine") {
          return (
            <pre key={index} className="mail-machine">
              {block.text}
            </pre>
          );
        }
        return (
          <p key={index} className="wrap-anywhere whitespace-pre-wrap text-pretty">
            <Inlines inlines={block.inlines} />
          </p>
        );
      })}
    </>
  );
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((part, index) => {
        if (part.kind === "link") return <Anchor key={index} href={part.href} label={part.label} />;
        if (part.kind === "strong") return <strong key={index}>{part.text}</strong>;
        if (part.kind === "em") return <em key={index}>{part.text}</em>;
        return <span key={index}>{part.text}</span>;
      })}
    </>
  );
}

function Anchor({ href, label, tall = false }: { href: string; label: string; tall?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={
        tall
          ? "wrap-anywhere inline-flex min-h-11 max-w-full items-center text-accent underline-offset-2 hover:underline"
          : "mail-inline-link wrap-anywhere inline max-w-full text-accent underline-offset-2 hover:underline"
      }
    >
      {label}
    </a>
  );
}

function download(file: Attachment, body: AttachmentBody) {
  const blob = new Blob(attachmentBlobParts(body), { type: body.mime || file.mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(url);
}
