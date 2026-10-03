import { useEffect, useRef, useState, type ReactNode } from "react";

/* ==========================================================================
   Modal.

   Shared by every overlay in the app (transcribe dialog, create-voice,
   brand kits, confirmations). The behaviours that are easy to get wrong and
   are therefore implemented here once rather than per page:

     - Escape closes
     - the page behind does not scroll
     - focus moves into the dialog and returns to the trigger on close
     - a backdrop click closes, a click inside does not
     - Tab is trapped inside, so keyboard users cannot tab into the page
       behind and lose their place

   Geometry follows the reference: ~500px wide, 24px radius, white surface,
   title left and a close control right, footer actions right-aligned.
   ========================================================================== */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-[500px]",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;

      // Wrap focus so the page behind stays unreachable.
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the panel itself, not a control: an autofocus control can be
    // scrolled past or can be absent while the dialog is still opening.
    const t = setTimeout(() => panel.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex max-h-[88vh] w-full ${width} flex-col overflow-hidden rounded-2xl bg-background shadow-2xl outline-none`}
      >
        <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
          <h2 className="font-waldenburg text-lg text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="focus-ring -mr-1 rounded-[10px] p-1 text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-gray-alpha-100 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- controls -- */

/** Pill switch. Matches the reference control, and reports its own state. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`focus-ring relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-gray-950" : "bg-gray-300"
      }`}    >
      <span
        className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

/** Label on the left, control on the right — the dialog's dominant row shape. */
export function FieldRow({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-tight text-subtle">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Dashed drop target. Accepts a click and a real file drop. */
export function DropZone({
  onFile,
  title,
  hint,
  accept = "audio/*,video/*",
}: {
  onFile: (f: File) => void;
  title: string;
  hint: string;
  accept?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Allow re-picking the same file after a rejection.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={`focus-ring flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-4 transition-colors ${
          over ? "border-gray-400 bg-gray-alpha-50" : "border-gray-alpha-200 hover:bg-gray-alpha-50"
        }`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-secondary"
          />
        </svg>
        <span className="text-sm text-foreground">{title}</span>
        <span className="text-xs text-subtle">{hint}</span>
      </button>
    </>
  );
}

/** Segmented tabs used inside dialogs and page headers. */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap gap-1 ${size === "sm" ? "text-xs" : "text-sm"}`}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`focus-ring rounded-[10px] transition-colors ${
            size === "sm" ? "px-2.5 py-1" : "px-3 py-1.5"
          } ${
            value === o.id
              ? "bg-gray-alpha-100 font-medium text-foreground"
              : "text-secondary hover:bg-gray-alpha-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
