import { useEffect, useMemo, useRef, useState } from "react";
import { HTML_FRAME_SANDBOX, mailNeedsImagePrompt, mailSrcDoc } from "@/lib/mail/html-mail";
import { resolveTheme } from "@/lib/mail/model";
import { useMail } from "@/lib/mail/store";

function fitMailFrame(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  const body = doc?.body;
  const root = doc?.documentElement;
  if (!doc || !body || !root) return;
  body.style.transform = "none";
  body.style.transformOrigin = "top left";
  body.style.width = "100%";
  root.style.overflowX = "hidden";
  const view = frame.clientWidth;
  if (view <= 0) return;
  const wide = Math.max(body.scrollWidth, root.scrollWidth);
  const tall = Math.max(body.scrollHeight, root.scrollHeight, 1);
  if (wide > view + 1) {
    const scale = view / wide;
    body.style.transform = `scale(${scale})`;
    frame.style.height = `${Math.ceil(tall * scale) + 4}px`;
    return;
  }
  frame.style.height = `${tall + 4}px`;
}

function watchImages(frame: HTMLIFrameElement) {
  const images = frame.contentDocument?.images;
  if (!images) return;
  for (const img of Array.from(images)) {
    if (img.dataset.fitWatch === "1" || img.complete) continue;
    img.dataset.fitWatch = "1";
    const refit = () => fitMailFrame(frame);
    img.addEventListener("load", refit, { once: true });
    img.addEventListener("error", refit, { once: true });
  }
}

export function HtmlMail({ html }: { html: string }) {
  const theme = useMail((s) => s.settings.theme);
  const [showImages, setShowImages] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const prompt = useMemo(() => mailNeedsImagePrompt(html), [html]);
  const srcDoc = useMemo(
    () => mailSrcDoc(html, { showRemoteImages: showImages, theme: resolveTheme(theme) }),
    [html, showImages, theme],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let width = -1;
    const fit = () => {
      fitMailFrame(frame);
      watchImages(frame);
    };
    const onLoad = () => fit();
    frame.addEventListener("load", onLoad);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const next = Math.round(entries[0]?.contentRect.width ?? 0);
            if (next === width) return;
            width = next;
            fit();
          });
    if (frame.parentElement && observer) observer.observe(frame.parentElement);
    fit();
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [srcDoc]);

  return (
    <div className="mail-html w-full min-w-0 max-w-full overflow-hidden">
      {prompt ? (
        <button
          type="button"
          aria-pressed={showImages}
          className="mb-3 inline-flex h-11 items-center rounded-full border border-line px-3 text-base font-medium text-ink hover:bg-ink/5"
          onClick={() => setShowImages((open) => !open)}
        >
          {showImages ? "Hide images" : "Show images"}
        </button>
      ) : null}
      <iframe
        ref={frameRef}
        title="HTML message"
        sandbox={HTML_FRAME_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="mail-html-frame block w-full min-w-0 max-w-full overflow-hidden border-0 bg-white"
      />
    </div>
  );
}
