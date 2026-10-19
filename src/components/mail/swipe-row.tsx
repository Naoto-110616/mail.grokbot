import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ignoreSwipeStart, lockSwipe, revealSwipe, type SwipeReveal } from "@/lib/mail/swipe";

export function SwipeRow({
  enabled,
  preview,
  onCommit,
  onSwipeLock,
  children,
}: {
  enabled: boolean;
  preview: (dx: number) => { label: string; className: string };
  onCommit: (reveal: SwipeReveal) => boolean;
  onSwipeLock?: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const track = useRef<{ id: number; x: number; y: number; lock: "undecided" | "scroll" | "swipe"; buzzed: boolean } | null>(null);

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    const current = track.current;
    track.current = null;
    setDragging(false);
    if (!current || current.lock !== "swipe") {
      setDx(0);
      return;
    }
    const reveal = revealSwipe(event.clientX - current.x);
    if (reveal?.commit && onCommit(reveal)) {
      setDx(reveal.side === "right" ? 360 : -360);
      window.setTimeout(() => setDx(0), 130);
      return;
    }
    setDx(0);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const current = track.current;
    if (!current || event.pointerId !== current.id) return;
    const nextX = event.clientX - current.x;
    const nextY = event.clientY - current.y;
    if (current.lock === "undecided") {
      const lock = lockSwipe(nextX, nextY);
      if (lock === "undecided") return;
      current.lock = lock;
      if (lock === "scroll") return;
      onSwipeLock?.();
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (current.lock !== "swipe") return;
    setDx(nextX);
    const reveal = revealSwipe(nextX);
    if (reveal?.commit && !current.buzzed) {
      current.buzzed = true;
      try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(10);
      } catch {
        // Some browsers reject vibration without a user-gesture exception.
      }
    }
  }

  const look = preview(dx);
  return (
    <div className="relative overflow-hidden">
      <div className={`absolute inset-0 flex items-center px-4 ${dx < 0 ? "justify-end" : "justify-start"} ${look.className}`}>
        <span className="text-sm font-semibold">{look.label}</span>
      </div>
      <div
        className="relative"
        style={{ transform: `translate3d(${dx}px,0,0)`, transition: dragging ? "none" : "transform 120ms ease" }}
        onPointerDown={(event) => {
          if (!enabled) return;
          if (event.pointerType === "mouse" && event.button !== 0) return;
          if (ignoreSwipeStart(event.clientX)) return;
          track.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lock: "undecided", buzzed: false };
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          track.current = null;
          setDragging(false);
          setDx(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
