import { useEffect, useRef, useState, type ReactNode } from "react";

/* ==========================================================================
   Popup menu.

   Four of this module's pages show the same control the reference does: a
   small trigger that opens a floating list — the Studio row `…`, the Flows
   file menu, the add-node menu, the per-node `…`. It lives here so the
   dismissal behaviour is written once: a click outside closes it, Escape
   closes it, and only one menu in a page can be open because every caller
   owns its own `open` state.

   Geometry follows 060-flow-file-menu: white surface, hairline border,
   ~12px radius, items at 13px with the shortcut hint right-aligned.
   ========================================================================== */

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  /** Rendered at the right of the row, e.g. `⌘Z`. */
  shortcut?: string;
  /** Shown under the label instead of `shortcut` — the reason it is off. */
  reason?: string;
  disabled?: boolean;
  /** Red for a destructive local action. */
  danger?: boolean;
  /** Forces a divider above this entry. */
  separated?: boolean;
}

export function Menu({
  entries,
  trigger,
  triggerClassName = "",
  triggerLabel,
  align = "left",
  width = "min-w-48",
}: {
  entries: MenuEntry[];
  trigger: ReactNode;
  triggerClassName?: string;
  triggerLabel: string;
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={triggerLabel}
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute top-[calc(100%+6px)] z-40 ${width} overflow-hidden rounded-xl border border-gray-alpha-150 bg-background py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {entries.map((e, i) => (
            <button
              key={`${e.label}-${i}`}
              type="button"
              role="menuitem"
              disabled={e.disabled}
              onClick={() => {
                setOpen(false);
                e.onSelect();
              }}
              className={`focus-ring flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-gray-alpha-50 ${
                e.separated && i > 0 ? "mt-1 border-t border-gray-alpha-100 pt-2" : ""
              } ${e.danger ? "text-red-700" : "text-foreground"}`}
            >
              <span className="flex w-full items-center justify-between gap-4">
                <span>{e.label}</span>
                {e.shortcut && (
                  <span className="font-mono text-[11px] text-subtle">{e.shortcut}</span>
                )}
              </span>
              {e.reason && <span className="text-[11px] text-subtle">{e.reason}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The reference's `…` glyph. Shared so every row menu looks the same. */
export function Dots() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** The reference's small chevron, used by the node toolbars. */
export function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
