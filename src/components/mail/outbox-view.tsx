import { ChevronLeft } from "lucide-react";
import { IconButton } from "@/components/mail/bits";
import { HtmlMail } from "@/components/mail/html-mail";
import { htmlIsVisible } from "@/lib/mail/html-mail";
import { outboxEditAsDraftAllowed, outboxStatusLabel, type OutboxItem } from "@/lib/mail/outbox";

export function OutboxSendView({
  item,
  split,
  onBack,
  onCancel,
  onRetry,
  onEdit,
}: {
  item: OutboxItem;
  split: boolean;
  onBack: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const html = item.html?.trim() ? item.html : "";
  const showHtml = html !== "" && htmlIsVisible(html);
  const canEdit = outboxEditAsDraftAllowed(item.status);
  return (
    <section aria-label="Queued send" className="paper flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-none lg:rounded-3xl">
      <header className="flex min-w-0 max-w-full items-center gap-0.5 border-b border-line px-1 py-1">
        {!split && (
          <IconButton label="Back to list" onClick={onBack}>
            <ChevronLeft className="size-5" />
          </IconButton>
        )}
        <h1 className="min-w-0 flex-1 truncate px-2 text-base font-semibold">{item.subject || "(no subject)"}</h1>
      </header>
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <dl className="min-w-0 max-w-full space-y-2">
          <Field label="From" value={item.fromAddress} />
          <Field label="To" value={item.to.filter(Boolean).join(", ")} />
          <Field label="Cc" value={item.cc.filter(Boolean).join(", ")} />
          <Field label="Subject" value={item.subject || "(no subject)"} />
        </dl>
        <p className="mt-3 text-base font-semibold">{outboxStatusLabel(item.status, item.error)}</p>
        <div className="mt-4 min-w-0 max-w-full">
          {showHtml ? (
            <HtmlMail html={html} />
          ) : (
            <div className="mail-body wrap-anywhere whitespace-pre-wrap text-base font-normal leading-relaxed text-ink">{item.text}</div>
          )}
        </div>
        {(item.status === "queued" || item.status === "failed" || canEdit) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {item.status === "queued" ? (
              <button type="button" className="h-11 rounded-full bg-ink/5 px-3 text-base font-semibold" onClick={() => onCancel(item.id)}>
                Cancel
              </button>
            ) : null}
            {item.status === "failed" ? (
              <button type="button" className="h-11 rounded-full bg-ink/5 px-3 text-base font-semibold" onClick={() => onRetry(item.id)}>
                Retry
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" className="h-11 rounded-full bg-ink/5 px-3 text-base font-semibold" onClick={() => onEdit(item.id)}>
                Edit as draft
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 max-w-full">
      <dt className="text-base text-muted">{label}</dt>
      <dd className="wrap-anywhere text-base text-ink">{value || "—"}</dd>
    </div>
  );
}
