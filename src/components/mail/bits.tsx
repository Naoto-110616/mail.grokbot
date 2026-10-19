import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SWATCH_DOT, type Label, type Swatch } from "@/lib/mail/model";

export function IconButton({
  label,
  children,
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink/5 disabled:opacity-40",
        active && "bg-accent/15 text-accent",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Monogram({ name, email, className }: { name: string; email: string; className?: string }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials =
    (parts.length ? parts.slice(0, 2).map((p) => p[0] ?? "").join("") : email.slice(0, 2)).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ink/5 text-xs font-semibold tracking-wide text-ink",
        className,
      )}
    >
      {initials}
    </span>
  );
}

export function SwatchDot({ swatch }: { swatch: Swatch }) {
  return <span className={cn("size-1.5 shrink-0 rounded-full", SWATCH_DOT[swatch])} />;
}

export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink", className)}>
      <SwatchDot swatch={label.swatch} />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

export function PlusChip({ tag, className }: { tag: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent", className)}>
      +{tag}
    </span>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "glass rise relative z-10 max-h-[86dvh] w-full overflow-auto rounded-t-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl",
          wide ? "sm:w-[40rem]" : "sm:w-[28rem]",
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-balance">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-line bg-paper-2 px-3 text-base text-ink outline-none"
      />
    </label>
  );
}
