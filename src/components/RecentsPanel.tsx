import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, jobs, type JobRecord } from "@/lib/api";
import { formatRelative, iconForJobType, labelForJobType } from "@/data/recents";
import { IconGrid, IconList, IconSearch } from "@/lib/icons";

/* ==========================================================================
   Home "最近" panel.

   Rows come from the local job ledger, not from a list written here. The
   previous version shipped six invented projects with invented "上周/上个月"
   timestamps, and a 快速入门 tab of nine English template cards pointing at
   `/app/templates/1..9` — none of which is a route in this build, so all nine
   were dead links. Both are gone rather than relabelled: SCOPE.md keeps "最近
   本地项目" on the home page, and the ledger is the only real source of one.
   工作室模板 remains reachable through 更多工具 and global search.

   The panel has no upstream reference either — on the reference home the area
   below the tool grid is the marketing banner, which SCOPE.md removes — so the
   design language is borrowed from the rest of the shell rather than claimed as
   a replica.
   ========================================================================== */

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  queued: "排队中",
  submitting: "提交中",
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  unknown_submission: "提交状态未知",
  cancel_requested: "已请求取消",
  cancelled: "已取消",
};

/** A stranded submission is the one state that must not read as ordinary. */
const STATUS_TONE: Record<string, string> = {
  failed: "text-red-700",
  unknown_submission: "text-amber-700",
  cancel_requested: "text-amber-700",
  succeeded: "text-emerald-700",
};

type Layout = "list" | "grid";

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/* ------------------------------------------------------------- controls -- */

function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="group relative col-span-full flex h-9 w-full rounded-xl bg-background">
      <IconSearch
        size={20}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle group-focus-within:text-foreground"
      />
      <input
        type="search"
        aria-label="搜索最近任务"
        placeholder="搜索最近任务…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring h-full w-full rounded-xl bg-transparent pr-9 pl-9 text-sm font-medium text-foreground placeholder:text-subtle [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}

function LayoutToggle({
  layout,
  onChange,
}: {
  layout: Layout;
  onChange: (next: Layout) => void;
}) {
  return (
    <div
      role="group"
      aria-label="查看布局"
      className="flex shrink-0 rounded-xl bg-gray-75 p-0.5"
    >
      {(
        [
          { id: "list", label: "列表视图", Icon: IconList },
          { id: "grid", label: "网格视图", Icon: IconGrid },
        ] as const
      ).map(({ id, label, Icon }) => {
        const active = layout === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`focus-ring relative flex h-8 w-8 items-center justify-center rounded-[10px] transition-colors duration-200 ${
              active ? "text-foreground" : "text-secondary"
            }`}
          >
            {active && (
              <div className="absolute inset-0 rounded-[10px] bg-background shadow-natural-xs" />
            )}
            <Icon className="relative z-1 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- rows -- */

function RecentsList({ items }: { items: JobRecord[] }) {
  return (
    <ul className="grid grid-cols-[32px_1fr_auto] gap-x-3 divide-y border-y sm:grid-cols-[32px_1fr_auto_auto] lg:grid-cols-[32px_1fr_200px_auto]">
      {items.map((job) => {
        const RowIcon = iconForJobType(job.type);
        return (
          <li
            key={job.id}
            className="group relative col-span-3 grid grid-cols-subgrid items-center gap-3 py-2.5 transition-colors duration-75 hover:bg-gray-alpha-50 sm:col-span-4"
          >
            <Link
              to="/local/jobs"
              aria-label={`在任务队列中查看 ${labelForJobType(job.type)} 任务`}
              className="focus-ring absolute inset-0 -inset-x-2.5 inset-y-0.5 rounded-xl transition-colors duration-100"
            />
            <div className="center relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-gray-75">
              <RowIcon size={20} className="text-secondary" />
            </div>
            <div className="relative col-span-2 grid min-w-0 flex-1 grid-cols-subgrid sm:col-span-3">
              <p className="line-clamp-1 text-sm font-medium text-foreground">
                {labelForJobType(job.type)}
              </p>
              <p className="hidden truncate font-mono text-sm text-subtle sm:inline-block">
                {job.id}
              </p>
              <span
                className={`shrink-0 whitespace-nowrap text-right text-sm ${
                  STATUS_TONE[job.status] ?? "text-secondary"
                }`}
              >
                {statusLabel(job.status)}
              </span>
              <span className="shrink-0 whitespace-nowrap text-right text-sm text-secondary">
                {formatRelative(job.createdAt)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RecentsGrid({ items }: { items: JobRecord[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((job) => {
        const CardIcon = iconForJobType(job.type);
        return (
          <li key={job.id}>
            <Link
              to="/local/jobs"
              className="focus-ring flex h-full w-full flex-col gap-2 rounded-xl border border-gray-alpha-150 p-4 transition-colors hover:bg-gray-alpha-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="center h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-gray-75">
                  <CardIcon size={20} className="text-secondary" />
                </div>
                <span
                  className={`shrink-0 text-xs font-medium ${
                    STATUS_TONE[job.status] ?? "text-secondary"
                  }`}
                >
                  {statusLabel(job.status)}
                </span>
              </div>
              <p className="truncate text-sm font-medium text-foreground">
                {labelForJobType(job.type)}
              </p>
              <p className="truncate font-mono text-xs text-subtle">{job.id}</p>
              <p className="mt-auto text-xs text-secondary">
                {formatRelative(job.createdAt)}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- panel -- */

export function RecentsPanel() {
  const [layout, setLayout] = useState<Layout>("list");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await jobs.list());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法读取本地任务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Filter on the fields the row actually shows, so the field is a control
  // rather than decoration. An unfiltered empty result says so explicitly
  // instead of implying there are no tasks at all.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (j) =>
        labelForJobType(j.type).toLowerCase().includes(q) ||
        j.type.toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q) ||
        statusLabel(j.status).toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div dir="ltr" className="stack w-full gap-3.5">
      <h2 className="text-sm font-medium text-foreground">最近</h2>

      <div className="flex w-full items-stretch justify-between gap-1.5">
        <SearchField value={query} onChange={setQuery} />
        <LayoutToggle layout={layout} onChange={setLayout} />
      </div>

      {loading && <p className="text-sm text-secondary">读取本地任务…</p>}

      {!loading && error && (
        <div className="stack items-start gap-2 rounded-xl border border-gray-alpha-200 p-4">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void reload()}
            className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm transition-colors hover:bg-gray-alpha-50"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-8 text-center">
          <p className="text-sm text-secondary">
            本机还没有任务记录。提交一次生成后，这里会显示它的类型、状态与时间。
          </p>
          <Link
            to="/local/settings/providers"
            className="focus-ring mt-3 inline-block text-sm text-foreground underline"
          >
            先配置 Provider 与密钥
          </Link>
        </div>
      )}

      {!loading && !error && items.length > 0 && visible.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-8 text-center text-sm text-secondary">
          没有匹配「{query.trim()}」的任务。本机共有 {items.length} 条记录。
        </p>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="focus-ring">
          {layout === "list" ? (
            <RecentsList items={visible} />
          ) : (
            <RecentsGrid items={visible} />
          )}
        </div>
      )}
    </div>
  );
}
