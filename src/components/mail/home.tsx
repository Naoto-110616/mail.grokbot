import { useEffect, useState } from "react";
import { MailShell } from "@/components/mail/shell";
import { useMail } from "@/lib/mail/store";

export function MailHome({
  messageId = null,
  threadId = null,
}: {
  messageId?: string | null;
  threadId?: string | null;
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
    return (
      <main className="flex h-dvh items-center justify-center bg-paper text-ink">
        <p className="text-[20px] font-bold leading-6">Grokbot Mail</p>
      </main>
    );
  }
  return <MailShell messageId={messageId} threadId={threadId} />;
}
