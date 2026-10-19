import { Bold, Italic, Link2, List, Minus, Paperclip, X } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "@/components/mail/bits";
import { recentContacts, mineSet, rememberBlob, uid, type Attachment } from "@/lib/mail/model";
import { useMail } from "@/lib/mail/store";

export function Compose() {
  const compose = useMail((s) => s.compose);
  const aliases = useMail((s) => s.aliases);
  const account = useMail((s) => s.account);
  const fromList = aliases;
  const threads = useMail((s) => s.threads);
  const patch = useMail((s) => s.patchCompose);
  const send = useMail((s) => s.send);
  const dismiss = useMail((s) => s.dismissCompose);
  const addFiles = useMail((s) => s.addComposeFiles);
  const removeFile = useMail((s) => s.removeComposeFile);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!compose) return null;
  const title =
    compose.mode === "forward" ? "Forward" : compose.mode === "new" ? "New message" : compose.mode === "replyAll" ? "Reply all" : "Reply";
  const contacts = recentContacts(threads.filter((t) => (account === "gmail" ? t.account === "gmail" : t.account !== "gmail")), mineSet(fromList)).slice(0, 4);

  if (compose.minimized) {
    return (
      <button
        type="button"
        className="glass fixed bottom-4 right-4 z-40 hidden h-12 max-w-xs items-center rounded-full px-4 text-sm font-medium lg:inline-flex"
        onClick={() => patch({ minimized: false })}
      >
        <span className="truncate">{compose.subject || title}</span>
      </button>
    );
  }

  function wrap(before: string, after: string) {
    const el = area.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const picked = compose!.body.slice(start, end) || "text";
    const next = compose!.body.slice(0, start) + before + picked + after + compose!.body.slice(end);
    patch({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + before.length + picked.length;
      el.setSelectionRange(caret, caret);
    });
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const next: Attachment[] = [];
    for (const file of list) {
      const id = uid();
      const path = `session/${id}`;
      let text = `${file.name} (${file.type || "file"}, ${file.size} bytes)`;
      if (file.size < 150_000 && (file.type.startsWith("text") || /\.(txt|md|csv|json|ics|log|svg)$/i.test(file.name))) {
        text = await file.text();
      }
      rememberBlob(path, text);
      next.push({ id, filename: file.name, mime: file.type || "application/octet-stream", bytes: file.size, path });
    }
    addFiles(next);
  }

  return (
    <form
      className={
        compose.expanded
          ? "paper fixed inset-2 z-40 flex flex-col overflow-hidden rounded-3xl"
          : "paper fixed inset-0 z-40 flex flex-col overflow-hidden lg:inset-auto lg:bottom-4 lg:right-4 lg:h-[36rem] lg:w-[34rem] lg:rounded-3xl"
      }
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <header className="glass flex items-center gap-2 rounded-none border-x-0 border-t-0 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <IconButton label={compose.expanded ? "Exit full screen" : "Full screen"} className="hidden lg:inline-flex" onClick={() => patch({ expanded: !compose.expanded })}>
          <span className="text-xs font-semibold">{compose.expanded ? "Exit" : "Full"}</span>
        </IconButton>
        <IconButton label="Minimize" className="hidden lg:inline-flex" onClick={() => patch({ minimized: true })}>
          <Minus className="size-5" />
        </IconButton>
        <IconButton label="Close and save draft" onClick={dismiss}>
          <X className="size-5" />
        </IconButton>
      </header>
      <div className="flex items-center gap-2 border-b border-line px-4">
        <span className="w-16 shrink-0 text-xs text-muted">From</span>
        <select
          aria-label="From"
          value={compose.from}
          onChange={(e) => patch({ from: e.target.value })}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
        >
          {fromList.map((alias) => (
            <option key={alias.email} value={alias.email}>
              {alias.name} · {alias.email}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 border-b border-line px-4">
        <span className="w-16 shrink-0 text-xs text-muted">To</span>
        <input
          value={compose.to}
          onChange={(e) => patch({ to: e.target.value })}
          placeholder="name@domain"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <button type="button" className="text-xs font-medium text-muted" onClick={() => patch({ showCc: !compose.showCc })}>
          Cc
        </button>
        <button type="button" className="text-xs font-medium text-muted" onClick={() => patch({ showBcc: !compose.showBcc })}>
          Bcc
        </button>
      </label>
      {compose.showCc && (
        <label className="flex items-center gap-2 border-b border-line px-4">
          <span className="w-16 shrink-0 text-xs text-muted">Cc</span>
          <input value={compose.cc} onChange={(e) => patch({ cc: e.target.value })} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
      )}
      {compose.showBcc && (
        <label className="flex items-center gap-2 border-b border-line px-4">
          <span className="w-16 shrink-0 text-xs text-muted">Bcc</span>
          <input value={compose.bcc} onChange={(e) => patch({ bcc: e.target.value })} className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
      )}
      <label className="flex items-center gap-2 border-b border-line px-4">
        <span className="w-16 shrink-0 text-xs text-muted">Subject</span>
        <input
          value={compose.subject}
          onChange={(e) => patch({ subject: e.target.value })}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {!compose.to && contacts.length > 0 && (
        <div className="flex gap-2 overflow-auto px-4 py-2">
          {contacts.map((c) => (
            <button
              key={c.email}
              type="button"
              className="h-8 shrink-0 rounded-full bg-ink/5 px-3 text-xs"
              onClick={() => patch({ to: `${c.name} <${c.email}>` })}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={area}
        value={compose.body}
        onChange={(e) => patch({ body: e.target.value })}
        className="min-h-0 w-full flex-1 resize-none bg-transparent px-4 py-3 text-base font-normal leading-relaxed outline-none"
        aria-label="Message"
      />
      {compose.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-4 pb-2">
          {compose.attachments.map((file) => (
            <li key={file.id} className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-3 text-xs">
              <span className="max-w-40 truncate">{file.filename}</span>
              <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => removeFile(file.id)}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer className="safe-bottom flex items-center gap-1 border-t border-line px-2 py-1">
        <button type="submit" className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg">
          Send
        </button>
        <IconButton label="Bold" onClick={() => wrap("**", "**")}>
          <Bold className="size-4" />
        </IconButton>
        <IconButton label="Italic" onClick={() => wrap("*", "*")}>
          <Italic className="size-4" />
        </IconButton>
        <IconButton label="Link" onClick={() => wrap("[", "](https://)")}>
          <Link2 className="size-4" />
        </IconButton>
        <IconButton label="List" onClick={() => wrap("- ", "")}>
          <List className="size-4" />
        </IconButton>
        <IconButton label="Attach" onClick={() => fileRef.current?.click()}>
          <Paperclip className="size-4" />
        </IconButton>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
        <button type="button" className="ml-auto h-11 px-3 text-sm text-muted" onClick={dismiss}>
          Save draft
        </button>
      </footer>
    </form>
  );
}
