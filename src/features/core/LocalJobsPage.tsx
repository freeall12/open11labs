import { useCallback, useEffect, useState } from "react";
import { ApiError, cost, jobs, type CostSummary, type JobRecord } from "@/lib/api";

/* ==========================================================================
   Task queue and cost ledger — local extension.

   The point of this screen is that nothing is rounded off to look tidy: an
   unpriced submission shows as "unknown", a stranded submission is called out
   as such, and cancelling says plainly what it did not do.
   ========================================================================== */

const STATUS_LABEL: Record<string, string> = {
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

const STATUS_TONE: Record<string, string> = {
  succeeded: "text-emerald-700",
  failed: "text-red-700",
  unknown_submission: "text-amber-700",
  cancel_requested: "text-amber-700",
  cancelled: "text-secondary",
};

export function LocalJobsPageBody() {
  const [items, setItems] = useState<JobRecord[]>([]);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budget, setBudget] = useState<{ limit: number | null; currency: string } | null>(null);
  const [scope, setScope] = useState<{ doesNotControl: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [j, c] = await Promise.all([jobs.list(), cost.summary()]);
      setItems(j);
      setSummary(c.summary);
      setBudget(c.budget);
      setScope(c.scope as unknown as { doesNotControl: string[] });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法读取任务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="stack gap-8">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <CostPanel summary={summary} budget={budget} scope={scope} onChanged={reload} />

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">任务记录</h2>

        {loading && <p className="text-sm text-secondary">读取中…</p>}
        {!loading && items.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-8 text-center text-sm text-secondary">
            还没有任务。提交生成后会在这里显示状态、费用与恢复信息。
          </p>
        )}

        {items.map((j) => (
          <JobRow key={j.id} job={j} onChanged={reload} />
        ))}
      </section>
    </div>
  );
}

function JobRow({ job, onChanged }: { job: JobRecord; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setNote(null);
    try {
      const res = await jobs.cancel(job.id);
      setNote(`${res.scope.stops}；不涉及：${res.scope.doesNot.join("、")}`);
      onChanged();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "取消失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-2 rounded-xl border border-gray-alpha-150 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{job.type}</p>
          <p className="truncate font-mono text-xs text-subtle">{job.id}</p>
        </div>
        <span className={`shrink-0 text-xs font-medium ${STATUS_TONE[job.status] ?? "text-secondary"}`}>
          {STATUS_LABEL[job.status] ?? job.status}
        </span>
      </div>

      {job.error && (
        <p className="text-xs text-amber-700">
          {job.error.safeMessage}（提交确定性：{job.error.submissionCertainty}）
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || job.status === "succeeded" || job.status === "cancelled"}
          onClick={cancel}
          className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm transition-colors hover:bg-gray-alpha-50 disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => setDetail(detail ? null : JSON.stringify(job, null, 2))}
          className="focus-ring h-8 rounded-[10px] px-2.5 text-sm text-secondary transition-colors hover:bg-gray-alpha-100"
        >
          {detail ? "收起详情" : "查看详情"}
        </button>
      </div>

      {note && <p className="text-xs text-secondary">{note}</p>}
      {detail && (
        <pre className="max-h-64 overflow-auto rounded-lg bg-gray-alpha-50 p-3 font-mono text-xs">
          {detail}
        </pre>
      )}
    </div>
  );
}

function CostPanel({
  summary,
  budget,
  scope,
  onChanged,
}: {
  summary: CostSummary | null;
  budget: { limit: number | null; currency: string } | null;
  scope: { doesNotControl: string[] } | null;
  onChanged: () => void;
}) {
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (budget) setLimit(budget.limit === null ? "" : String(budget.limit));
  }, [budget]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const parsed = limit.trim() === "" ? null : Number(limit);
      if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
        setError("限额必须是非负数字或留空");
        return;
      }
      await cost.setBudget(parsed);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack gap-4 rounded-xl border border-gray-alpha-150 p-5">
      <h2 className="text-sm font-medium text-foreground">费用账本</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-secondary">金额合计</p>
          {summary && summary.money.length === 0 ? (
            <p className="text-sm text-foreground">暂无已定价记录</p>
          ) : (
            <ul className="text-sm text-foreground">
              {summary?.money.map((m) => (
                <li key={m.currency}>
                  {m.total} {m.currency}（{m.entries} 条）
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs text-secondary">用量计量</p>
          {summary && summary.usage.length === 0 ? (
            <p className="text-sm text-foreground">—</p>
          ) : (
            <ul className="text-sm text-foreground">
              {summary?.usage.map((u) => (
                <li key={u.unit}>
                  {u.total} {u.unit}（{u.entries} 条）
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {summary && summary.unknown.count > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          有 {summary.unknown.count} 条记录没有可核实的价格，实际花费未知，未计入上方合计。
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">本地预算（{budget?.currency ?? "USD"}，留空为不限）</span>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="decimal"
            className="focus-ring h-9 w-40 rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-3 text-sm text-background disabled:bg-gray-400"
        >
          保存
        </button>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {scope && (
        <p className="text-xs text-secondary">
          本地预算只约束本应用发起的新任务，不控制：{scope.doesNotControl.join("、")}。
        </p>
      )}
    </section>
  );
}
