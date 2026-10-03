import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { assets as assetsApi, jobs as jobsApi, type JobRecord } from "@/lib/api";

/* ==========================================================================
   Pieces shared by every page in this module.

   `Notice` was previously copy-pasted into four pages. One definition means a
   wording or colour fix lands everywhere, and the pages stay readable.
   ========================================================================== */

export function Notice({
  tone,
  children,
}: {
  tone: "error" | "warn" | "info";
  children: React.ReactNode;
}) {
  const cls = {
    error: "bg-red-50 text-red-700",
    warn: "bg-amber-50 text-amber-800",
    info: "bg-gray-alpha-50 text-secondary",
  }[tone];
  return <div className={`rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

const TAB_CLASS = (active: boolean) =>
  `focus-ring -mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm transition-colors ${
    active
      ? "border-foreground font-medium text-foreground"
      : "border-transparent text-secondary hover:text-foreground"
  }`;

export function TabLink({ to, label, active }: { to: string; label: string; active?: boolean }) {
  return (
    <Link to={to} aria-current={active ? "page" : undefined} className={TAB_CLASS(!!active)}>
      {label}
    </Link>
  );
}

/**
 * In-page tab. Same geometry as `TabLink` but a button, because these tabs
 * switch a panel on the current route instead of navigating.
 */
export function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={TAB_CLASS(active)}
    >
      {label}
    </button>
  );
}

/* ======================================================================
   The right-hand settings rail (015/025, 100-103).

   TTS and the voice changer share this column verbatim upstream: a
   设置/历史 pair at the top, then a 音色 row, a 模型 row, a run of
   sliders, and a collapsible 高级设置 block. Keeping the parts here
   means the two pages cannot drift apart, and the row order stays the
   one the reference actually renders rather than the one that is
   convenient to write.

   The reference's marketing card and its "试用 Eleven v4" banner are
   deliberately absent — SCOPE.md removes upsell, and a card is not a
   layout slot to keep empty.
   ====================================================================== */

/** Rail column. The upstream rail is a fixed ~460px pane on the right. */
export function SettingsRail({ children }: { children: React.ReactNode }) {
  return (
    <aside className="w-[468px] shrink-0 border-l border-gray-alpha-150 pl-6 pr-6">
      {children}
    </aside>
  );
}

/** Left column: input on top, footer row pinned to the bottom. */
export function StageColumn({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col gap-4 pr-8">{children}</div>;
}

/** Tab pair at the top of the rail, with the hairline the reference draws under it. */
export function RailTabs({
  value,
  onChange,
}: {
  value: "settings" | "history";
  onChange: (v: "settings" | "history") => void;
}) {
  return (
    <div className="border-b border-gray-alpha-150" role="tablist">
      <div className="flex items-center gap-5">
        <TabButton label="设置" active={value === "settings"} onClick={() => onChange("settings")} />
        <TabButton label="历史" active={value === "history"} onClick={() => onChange("history")} />
      </div>
    </div>
  );
}

/** Label above a full-width control — the rail stacks, it does not split. */
export function RailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="stack gap-1.5">
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </section>
  );
}

/**
 * The full-width rounded control the rail uses for every choice: voice,
 * model, language, output format. Native `select` cannot carry the
 * reference's badge-plus-chevron row, so this is a button that opens the
 * page's own dialog — the visible state and the committed state stay one
 * value rather than two.
 */
export function SelectPill({
  label,
  badge,
  leading,
  disabled,
  onClick,
  ariaLabel,
}: {
  label: string;
  /** Short model/version chip, e.g. the "V2" the reference shows. */
  badge?: string;
  leading?: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="focus-ring flex h-9 w-full items-center gap-2 rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-left transition-colors hover:border-gray-alpha-200 hover:bg-gray-alpha-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {badge && (
        <span className="shrink-0 rounded-full border border-gray-alpha-200 px-1.5 py-px text-[11px] leading-4 text-secondary">
          {badge}
        </span>
      )}
      {leading}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
      <ChevronIcon />
    </button>
  );
}

/**
 * Slider block in the reference's order: title, then the two end labels,
 * then the track. The upstream page shows no numeric readout, so neither
 * does this — the value lives in the thumb position, not in text.
 */
export function RailSlider({
  label,
  low,
  high,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  enabled = true,
  reason,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  enabled?: boolean;
  /** Required whenever `enabled` is false: a control may not be dead. */
  reason?: string;
}) {
  return (
    <section className="stack gap-1">
      <span className={enabled ? "text-sm text-foreground" : "text-sm text-subtle"}>{label}</span>
      <div className="flex items-center justify-between text-xs text-secondary">
        <span>{low}</span>
        <span>{high}</span>
      </div>
      <input
        type="range"
        role="slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full disabled:cursor-not-allowed disabled:opacity-40"
      />
      {!enabled && reason && <span className="text-xs text-subtle">{reason}</span>}
    </section>
  );
}

/** Collapsible 高级设置: title left, chevron pinned to the rail's right edge. */
export function AdvancedToggle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="focus-ring flex w-full items-center justify-between rounded-[10px] py-1.5 text-left text-sm text-foreground"
    >
      高级设置
      <span className={open ? "rotate-180 transition-transform" : "transition-transform"}>
        <ChevronIcon />
      </span>
    </button>
  );
}

/** Label left, control right — how the advanced rows are built. */
export function RailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Switch. The reference exposes these as `switch`, and an unchecked
 * checkbox is the wrong control here: it reads as a form field, not as
 * the toggle the rail shows.
 */
export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
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
      className={`focus-ring relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-foreground" : "bg-gray-alpha-200"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-natural-xs transition-[left] ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-secondary"
    >
      <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Small square avatar standing in for the reference's voice thumbnail. */
export function VoiceDot({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-alpha-100 text-[10px] font-medium text-secondary"
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Section header row for the history tables (标题 / 创建于 / 操作). */
export function TableHead({ columns }: { columns: string[] }) {
  return (
    <div className="flex items-center gap-4 border-b border-gray-alpha-150 px-3 pb-2 text-xs text-secondary">
      {columns.map((c) => (
        <span
          key={c}
          className={c === columns[0] ? "min-w-0 flex-1" : "shrink-0 whitespace-nowrap"}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- drafts -- */

/**
 * Draft state that survives a refresh.
 *
 * Only non-secret page state goes in here — text, ids, slider values. Provider
 * secrets never reach this path: they live in the server-side proxy and are
 * not part of any draft. A malformed or absent entry falls back to the
 * initial value rather than throwing, so an old draft can never brick the page.
 */
export function useDraft<T>(key: string, initial: T) {
  const storageKey = `voice-draft:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return initial;
      return { ...(initial as object), ...(JSON.parse(raw) as object) } as T;
    } catch {
      return initial;
    }
  });

  // Debounced so a slider drag does not write on every frame.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        /* Private mode or a full quota: the page still works, just not sticky. */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [storageKey, value]);

  return [value, setValue] as const;
}

/* ------------------------------------------------------------ job rows -- */

/**
 * Jobs of one type, newest first, plus a reload for after a cancel.
 *
 * `enabled` is false while the history tab is hidden: fetching a list nobody
 * is looking at costs a request on every page load and, on a cold start,
 * delays the panel the user actually asked for.
 */
export function useJobHistory(type: string, enabled = true) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await jobsApi.list();
      setJobs(all.filter((j) => j.type === type));
      setError(null);
    } catch {
      setError("无法读取本地历史。");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return { jobs, loading, error, reload: load };
}

/**
 * Render a job history with its media.
 *
 * The job's own `outputAssetIds` are the only link between a job and a file.
 * Resolving "the newest asset" instead would attach a different job's output
 * to a row after a refresh, so the id list is what is matched on.
 */
export function JobHistoryList({
  jobs,
  loading,
  error,
  reload,
  emptyText,
  query = "",
  head,
}: {
  jobs: JobRecord[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  emptyText: string;
  /** Optional filter, matched against the asset name or the job id. */
  query?: string;
  /** Column header row, so a list can carry the reference's table labels. */
  head?: React.ReactNode;
}) {
  const [assets, setAssets] = useState<Record<string, { url: string; name: string }>>({});
  const wanted = jobs.flatMap((j) => j.outputAssetIds).join(",");

  useEffect(() => {
    if (!wanted) return;
    void (async () => {
      try {
        const res = await assetsApi.list();
        const wantedIds = new Set(wanted.split(","));
        setAssets(
          Object.fromEntries(
            res.assets
              .filter((a) => wantedIds.has(a.id))
              .map((a) => [a.id, { url: a.url, name: a.displayName }]),
          ),
        );
      } catch {
        /* rows stay visible without their media */
      }
    })();
  }, [wanted]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? jobs.filter((j) => {
            const name = j.outputAssetIds.map((id) => assets[id]?.name).find(Boolean);
            return (
              (name ?? "").toLowerCase().includes(q) ||
              j.id.toLowerCase().includes(q) ||
              (j.modelId ?? "").toLowerCase().includes(q)
            );
          })
        : jobs,
    [jobs, assets, q],
  );

  if (loading) {
    return (
      <div className="stack gap-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-alpha-50" />
        ))}
      </div>
    );
  }

  return (
    <section className="stack gap-3">
      {error && <Notice tone="error">{error}</Notice>}
      {head}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
          {jobs.length === 0 ? emptyText : "没有匹配的历史。"}
        </p>
      ) : (
        <ul className="stack gap-2">
          {shown.map((j) => {
            const asset = j.outputAssetIds.map((id) => assets[id]).find(Boolean);
            return (
              <li
                key={j.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-alpha-150 p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {asset?.name ?? `任务 ${j.id.slice(0, 8)}`}
                  </span>
                  <span className="text-xs text-secondary">
                    {j.modelId ?? "未知模型"} · {j.status}
                    {j.error ? ` — ${j.error.safeMessage}` : ""}
                  </span>
                </span>
                {asset && <audio controls preload="none" src={asset.url} className="h-8 w-40" />}
                {asset && (
                  <a href={asset.url} download={asset.name} className="focus-ring text-xs underline">
                    下载
                  </a>
                )}
                {["queued", "running", "pending"].includes(j.status) && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await jobsApi.cancel(j.id);
                        await reload();
                      } catch {
                        /* no local state change without a server answer */
                      }
                    }}
                    className="focus-ring shrink-0 rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50"
                  >
                    取消
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** `0:07`, or an em dash while the media element has not reported a duration. */
export function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
