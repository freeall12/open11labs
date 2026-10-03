import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

/* ==========================================================================
   Composer primitives shared by the media pages.

   The reference pages are all the same shape: a pill tab strip under the page
   title, a panel, and a composer that floats centred over the panel with its
   parameters as small popovers above a bottom control bar. Building that once
   keeps the three pages visually consistent and keeps the popover behaviour
   (Escape, outside click, focus) in a single place instead of three subtly
   different copies.

   Nothing here knows about a provider: the controls are pure UI, and the
   caller decides what is blocked and why.

   Geometry notes are measured off the 1500×759 reference captures (090–092,
   122, 075–080): composer card ≈680px wide and centred, suggestion chips are
   28px pills, bar controls are borderless 32px items that only gain a grey
   pill when active, and the tab strip is a pill row over a hairline.
   ========================================================================== */

/* -------------------------------------------------------------- notice -- */

export function Notice({
  tone,
  children,
}: {
  tone: "error" | "warn" | "info";
  children: ReactNode;
}) {
  const cls = {
    error: "bg-red-50 text-red-700",
    warn: "bg-amber-50 text-amber-800",
    info: "bg-gray-alpha-50 text-secondary",
  }[tone];
  return <div className={`rounded-[10px] px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

/* -------------------------------------------------------------- popover -- */

/**
 * Anchored panel that opens above its trigger, the way the reference composer
 * does. It closes on Escape and on a pointer press outside, and returns focus
 * to the trigger so keyboard users do not lose their place in the bar.
 */
export function Popover({
  label,
  summary,
  active,
  bordered,
  children,
  width = "w-56",
}: {
  /** Accessible name of the trigger; the visible text is `summary`. */
  label: string;
  summary: ReactNode;
  active?: boolean;
  bordered?: boolean;
  children: ReactNode;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <BarButton
        ref={trigger}
        label={label}
        onClick={() => setOpen((v) => !v)}
        active={active ?? open}
        bordered={bordered}
      >
        {summary}
      </BarButton>

      {open && (
        <div
          role="group"
          aria-label={`${label}设置`}
          className={`absolute bottom-full left-0 z-30 mb-2 ${width} rounded-xl border border-gray-alpha-150 bg-popover p-3 shadow-lg`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- bar button -- */

/**
 * One control in the composer's bottom bar. The reference draws these as bare
 * icon + label; only the active one gets a grey pill, so a selected parameter
 * is the only thing that reads as "on".
 */
export const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(
  { label, active, onClick, disabled, title, bordered, children },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      aria-pressed={onClick ? active : undefined}
      className={`focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors ${
        disabled
          ? "cursor-not-allowed text-subtle"
          : bordered
            ? `border bg-background ${
                active ? "border-gray-350 text-foreground" : "border-gray-alpha-200 text-secondary hover:bg-gray-alpha-50"
              }`
            : active
              ? "bg-gray-alpha-100 text-foreground"
              : "text-secondary hover:bg-gray-alpha-50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
});

interface BarButtonProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  /** Outlined variant, for the model / finetune pickers that sit above a card. */
  bordered?: boolean;
  children: ReactNode;
}

/**
 * A control the reference draws but the local submit path cannot honour.
 *
 * Two details are deliberate. The marker occupies the value slot the reference
 * fills with a number (质量 高 / 生成次数 4), so the control inventory still
 * matches, and it is held to 10px so three of them do not turn the bar into a
 * wall of grey. The reason goes on a wrapper instead of on the button because
 * Chrome does not show `title` on a disabled control — a reason attached to the
 * button alone would be unreachable, which is the same as not stating it.
 */
export function InertBarButton({
  label,
  reason,
  children,
}: {
  label: string;
  reason: string;
  children: ReactNode;
}) {
  return (
    <span title={reason} className="inline-flex cursor-help">
      <BarButton label={`${label}（未转交）`} disabled>
        {children}
        <span className="whitespace-nowrap text-[10px] leading-none text-subtle">未转交</span>
      </BarButton>
    </span>
  );
}

/* --------------------------------------------------------------- slider -- */

/**
 * Range control drawn the way the reference draws it: a 2px track with the
 * travelled part in the foreground colour and a 12px round thumb, plus the
 * 低/高 scale spelled out above the track. The native input stays in the tree
 * (transparent, on top) so pointer and keyboard behaviour are the browser's
 * own rather than a hand-rolled approximation.
 */
export function Slider({
  title,
  value,
  min,
  max,
  step,
  onChange,
  ends,
  disabled,
  bubble,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  ends?: [string, string];
  disabled?: boolean;
  /** Show the current value in a tooltip above the thumb, as 提示词影响 does. */
  bubble?: string;
}) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  // Keep the bubble inside the panel instead of letting it hang off an edge.
  const bubblePos = Math.min(86, Math.max(14, pct));

  return (
    <div className="stack gap-2">
      {ends && (
        <div className="flex items-center justify-between text-xs text-secondary">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}

      <div className={`relative h-4 ${disabled ? "opacity-40" : ""}`}>
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-gray-alpha-200" />
        <div
          className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-foreground"
          style={{ width: `${pct}%` }}
        />
        {bubble && !disabled && (
          <span
            className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-xs text-background"
            style={{ left: `${bubblePos}%` }}
          >
            {bubble}
          </span>
        )}
        <span
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={title}
          aria-valuetext={bubble}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ composer -- */

/** Popover heading: the reference titles its panels instead of labelling inputs. */
export function PopoverTitle({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-foreground">{children}</p>;
}

/** Free-text chips that insert a fragment into the prompt; never auto-submit. */
export function PromptChips({
  chips,
  onPick,
  onToggle,
  hidden,
}: {
  chips: { id: string; label: string; insert: string }[];
  onPick: (insert: string) => void;
  /** The reference's 隐藏建议 / 显示建议 toggle: collapses the whole chip row. */
  onToggle?: () => void;
  hidden?: boolean;
}) {
  if (hidden) {
    /* Collapsed, the reference parks the restore button at the card's top
       right rather than leaving a gap where the chips used to be. */
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="显示建议"
        className="focus-ring ml-auto flex h-8 w-8 items-center justify-center rounded-[10px] border border-gray-alpha-200 text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
      >
        <Icon path={ICONS.sparkle} size={15} />
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.insert)}
          className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-full border border-gray-alpha-150 px-3 text-[13px] text-foreground transition-colors hover:bg-gray-alpha-50"
        >
          <Icon path={ICONS.sparkle} size={13} />
          {c.label}
        </button>
      ))}
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="隐藏建议"
          className="focus-ring ml-auto flex h-7 items-center rounded-full px-2 text-[13px] text-subtle transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
        >
          隐藏建议
        </button>
      )}
    </div>
  );
}

/**
 * The composer surface: a dismissible header band, the suggestion row, the
 * prompt, an optional extra slot, and the control bar. It is centred and
 * capped at the reference width so it floats over the panel instead of
 * stretching with it.
 */
export function Composer({
  chips,
  prompt,
  onPrompt,
  placeholder,
  label,
  hint,
  inputSlot,
  bar,
  submit,
  foot,
  docked,
}: {
  chips?: ReactNode;
  prompt: string;
  onPrompt: (v: string) => void;
  placeholder: string;
  label: string;
  /** Grey band across the top of the card, as the sound-effects composer has. */
  hint?: ReactNode;
  inputSlot?: ReactNode;
  bar: ReactNode;
  submit: ReactNode;
  /** The single line that sits under the card (cost acknowledgement, reason). */
  foot?: ReactNode;
  /**
   * Keep the card at the bottom of the viewport while the results scroll under
   * it, which is how the reference composer behaves. Without it the card would
   * be pushed off-screen by a long result list — taking the cost
   * acknowledgement and the disabled reason with it.
   */
  docked?: boolean;
}) {
  return (
    // `sticky bottom-*` is what makes the reference composer stay visible over a
    // long result list. It is only correct while the page still scrolls: on a
    // short page the last child gets pulled *up* to the viewport bottom and
    // lands on top of the content above it, hiding the empty state and the
    // cost gate. So the card stays in normal flow, and the page gets bottom
    // padding to match instead of the card floating over anything.
    <div className={`mx-auto w-full max-w-[680px] ${docked ? "relative z-20" : ""}`}>
      <section className="overflow-hidden rounded-2xl border border-gray-alpha-150 bg-background shadow-lg">
        {hint && (
          <div className="flex items-center justify-center gap-1.5 bg-gray-alpha-50 px-4 py-2 text-center text-xs">
            {hint}
          </div>
        )}
        {chips && <div className="px-3 pt-3">{chips}</div>}
        <div className="p-3">
          <div className="flex items-start gap-2">
            <label className="sr-only" htmlFor={`${label}-input`}>
              {label}
            </label>
            <textarea
              id={`${label}-input`}
              value={prompt}
              onChange={(e) => onPrompt(e.target.value)}
              rows={3}
              placeholder={placeholder}
              className="focus-ring min-h-20 w-full resize-none border-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-subtle"
            />
            {prompt && (
              <button
                type="button"
                aria-label="清空描述"
                onClick={() => onPrompt("")}
                className="focus-ring mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-gray-alpha-200 text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          {inputSlot}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-gray-alpha-100 px-3 py-2">
          {bar}
          <div className="ml-auto flex items-center gap-1.5">{submit}</div>
        </div>
      </section>
      {foot && <div className="mt-2">{foot}</div>}
    </div>
  );
}

/** Circular arrow submit, matching the reference composer's shape. */
export function SubmitArrow({
  label,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={busy ? `${label}（进行中）` : label}
      className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 19V5m0 0l-6 6m6-6l6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** 费用未知 pill. A real provider call costs money; the amount is not knowable here. */
export function UnknownCostPill({ note }: { note?: string }) {
  return (
    <span
      title={note}
      className="rounded-full bg-gray-alpha-50 px-2 py-0.5 text-xs text-secondary"
    >
      费用未知
    </span>
  );
}

/**
 * A checkbox drawn from tokens rather than left to the UA.
 *
 * The document used to declare `<meta name="color-scheme" content="light dark">`
 * (index.html), which makes Chrome paint form controls from the dark palette: an
 * unchecked box came out near-black on a white page. `appearance-none` plus a
 * tick drawn from `checked` keeps the control legible whatever the document
 * says. The input itself is untouched in behaviour — it is still the real,
 * focusable, keyboard-operable checkbox, just with the native skin removed.
 *
 * Shared by the cost gate and the history filter menus so both are drawn once.
 */
export function CheckBox({
  checked,
  onChange,
  className = "",
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
  /** Accessible name when the control is not already inside a <label>. */
  label?: string;
}) {
  return (
    <span
      className={`relative flex h-3.5 w-3.5 shrink-0 items-center justify-center ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-[4px] border border-gray-alpha-300 bg-background transition-colors checked:border-foreground checked:bg-foreground"
      />
      {checked && (
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none relative text-background"
        >
          <path
            d="M2.5 6.2l2.4 2.4L9.5 3.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/**
 * The acknowledgement that stands in for the removed credits pill. It is a
 * gate, not a caption: the submit stays disabled until it is ticked, and it
 * sits directly under the card so the reason is never off-screen.
 */
export function CostAcknowledgement({
  checked,
  onChange,
  target,
  what,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  target?: string;
  what: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-secondary">
      <CheckBox checked={checked} onChange={onChange} className="mt-0.5" />
      <span>
        我了解{what}会产生费用、金额未知，并同意向 {target ?? "Provider"} 发送上述内容。
      </span>
    </label>
  );
}

/* ---------------------------------------------------------- filter chips -- */

export interface FilterOption {
  value: string;
  label: string;
  /** How many stored rows this value matches; undefined when not applicable. */
  count?: number;
}

export interface FilterGroup {
  id: string;
  label: string;
  options: FilterOption[];
  /**
   * Why there is nothing to pick. A filter with no options is not rendered as
   * an empty menu: the chip is disabled and says this instead, so it never
   * looks like a control that silently does nothing.
   */
  emptyReason?: string;
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * The additive filter row the reference puts above a history list (130, 131):
 * `+ 模型`, `+ 类型`, `+ 来源`. Each chip opens a multi-select; picking several
 * values widens the filter (an OR), which is why the panel is a checkbox list
 * rather than the single-select row the composer's bar uses.
 *
 * An active chip shows how many values are on, because a chip that looks
 * identical whether it is filtering or not is the one control a user cannot
 * verify by looking.
 */
export function FilterChips({ groups }: { groups: FilterGroup[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {groups.map((g) => {
        const n = g.selected.length;
        return (
          <Popover
            key={g.id}
            label={g.label}
            bordered={n > 0}
            width="w-64"
            summary={
              <>
                {n > 0 ? <Icon path={ICONS.minus} size={13} /> : <Icon path={ICONS.plus} size={13} />}
                {g.label}
                {n > 0 && <span className="text-subtle">· {n}</span>}
              </>
            }
          >
            <div className="stack gap-0.5">
              <PopoverTitle>{g.label}</PopoverTitle>
              {g.options.length === 0 ? (
                /* An empty menu reads as a broken control. Say what is missing
                   instead, in the panel where the user is already looking. */
                <p className="px-1.5 py-1.5 text-xs text-subtle">{g.emptyReason}</p>
              ) : (
                g.options.map((o) => {
                  const on = g.selected.includes(o.value);
                  return (
                    <label
                      key={o.value}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-secondary transition-colors hover:bg-gray-alpha-50"
                    >
                      <CheckBox
                        checked={on}
                        onChange={(v) =>
                          g.onChange(
                            v ? [...g.selected, o.value] : g.selected.filter((x) => x !== o.value),
                          )
                        }
                        label={o.label}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">{o.label}</span>
                      {o.count !== undefined && (
                        <span className="shrink-0 text-xs text-subtle">{o.count}</span>
                      )}
                    </label>
                  );
                })
              )}
              {n > 0 && (
                <button
                  type="button"
                  onClick={() => g.onChange([])}
                  className="focus-ring mt-1 rounded-lg px-1.5 py-1 text-left text-xs text-subtle transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
                >
                  清除
                </button>
              )}
            </div>
          </Popover>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------- segmented set -- */

/**
 * The reference's pill radio group (图像 / 视频 / 口型同步). A real radiogroup
 * so arrow-key navigation and the checked state are the browser's, not a
 * row of buttons pretending to be one.
 */
export function SegmentedRadio<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-8 items-center gap-0.5 rounded-full bg-gray-alpha-50 p-0.5"
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`focus-ring flex h-7 items-center rounded-full px-3 text-[13px] transition-colors ${
              on
                ? "bg-background text-foreground shadow-natural-xs"
                : "text-secondary hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- tab strip -- */

/**
 * Pill tabs over a hairline. The reference gives the active tab a white pill
 * *and* an underline the width of that pill, which is what makes the row read
 * as tabs rather than as a segmented switch.
 */
export function TabStrip({
  tabs,
  trailing,
}: {
  tabs: { to: string; label: string; active: boolean }[];
  /** Right-aligned secondary links, as the music page carries 微调. */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-alpha-150">
      <div className="flex items-center gap-1.5">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={t.active ? "page" : undefined}
            className={`focus-ring -mb-px flex h-7 items-center rounded-[10px] border-b-2 px-2.5 text-[13px] transition-colors ${
              t.active
                ? "border-foreground bg-background font-medium text-foreground shadow-natural-xs"
                : "border-transparent text-secondary hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {trailing}
    </div>
  );
}

/** Right-aligned secondary tab link (music's 微调), the reference's quieter slot. */
export function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="focus-ring -mb-px flex h-7 items-center border-b-2 border-transparent px-2.5 text-[13px] text-secondary transition-colors hover:text-foreground"
    >
      {label}
    </Link>
  );
}

/* ---------------------------------------------------------------- icons -- */

export function Icon({
  path,
  size = 16,
  className = "",
}: {
  path: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const ICONS = {
  loop: "M7 7h10l-3-3m3 3l-3 3M17 17H7l3 3m-3-3l3-3",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3.5 2",
  gauge: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3.5 2M12 12h.01",
  wand: "M4 20l10-10m-2 2l2 2m-6 2l2 2M16 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z",
  sparkle: "M4 7h8M14 7h6M6 4v6M3 7h6M6 15h7M15 15h5M9.5 12v6M6.5 15h6",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  format: "M4 6h16M4 12h10M4 18h7",
  ratio: "M3 6h18v12H3z",
  resolution: "M3 6h18v12H3zM7 10v4M11 10v4M15 10v4",
  quality: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z",
  model: "M4 6h16M4 12h16M4 18h16M8 4v16",
  count: "M4 8h16M4 12h16M4 16h16",
  sound: "M4 9v6h4l5 4V5L8 9H4zm13.5-1.5a6 6 0 010 9M20 5a9 9 0 010 14",
  warn: "M12 4l9 16H3l9-16zm0 6v5m0 3h.01",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  /** The reference's settings/filter affordance at the right of the tab row. */
  filter: "M4 7h16M7 12h10M10 17h4",
  image: "M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 5",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
} as const;

/* -------------------------------------------------------------- helpers -- */
