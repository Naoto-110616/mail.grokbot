import { useEffect, useState } from "react";
import { MailShell } from "@/components/mail/shell";
import type { DemoPreview } from "@/lib/mail/mail-rpc";
import { useMail } from "@/lib/mail/store";

export function MailHome({
  messageId = null,
  threadId = null,
  outboxId = null,
  preview = null,
}: {
  messageId?: string | null;
  threadId?: string | null;
  outboxId?: string | null;
  preview?: DemoPreview | null;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.resolve(useMail.persist.rehydrate())
      .catch(() => undefined)
      .then(() => useMail.getState().connect())
      .finally(() => {
        if (!live) return;
        setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  if (!ready) {
    if (preview?.sample) {
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center bg-paper px-6 text-ink">
          <h1 className="text-[20px] font-bold leading-6">Grokbot Mail</h1>
          <p className="mt-3 text-[15px] leading-5 text-muted">{preview.note}</p>
          <ul className="mt-4 list-disc pl-5 text-[15px] leading-6">
            {preview.subjects.map((subject, index) => (
              <li key={`${index}-${subject}`}>{subject}</li>
            ))}
          </ul>
        </main>
      );
    }
    return (
      <main className="flex h-dvh items-center justify-center bg-paper text-ink">
        <p className="text-[20px] font-bold leading-6">Grokbot Mail</p>
      </main>
    );
  }
  return <MailShell messageId={messageId} threadId={threadId} outboxId={outboxId} />;
}
