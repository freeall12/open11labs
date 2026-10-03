import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  projects as projectsApi,
  type ProjectRecord,
} from "@/lib/api";
import { downloadText } from "@/features/voice/transcript";
import { Dots, Menu, type MenuEntry } from "@/features/editors/Menu";
import { Modal } from "@/features/shared/Modal";

/* ==========================================================================
   Flows 列表.

   参考 052-flows-loaded 与交互记录里 Flows 一行：列表带新建、搜索、排序，
   行菜单含新标签、复制链接、复制、重命名、删除。分享与所有者筛选属于云工作区，
   按 SCOPE.md 移除，所以行里不再有那一列。

   画布本体在 FlowCanvas.tsx。模板这里指本地工程：把画布结构复制一份用来开新
   Flow，不上传、不销售。
   ========================================================================== */

type Sort = "recent" | "name" | "nodes";

/** 页面级「+ 新建 Flow」按钮，由 pages.tsx 传给 PageFrame 的 actions。 */
export function NewFlowButton() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void projectsApi
            .create({ kind: "flow", name: "未命名 Flow", content: { nodes: [], edges: [] } })
            .then((p) => navigate(`/app/flows/${p.id}`))
            .catch((err: unknown) =>
              setError(err instanceof ApiError ? err.message : "新建失败"),
            )
            .finally(() => setBusy(false));
        }}
        className="focus-ring inline-flex items-center gap-1.5 rounded-[10px] bg-foreground px-4 py-2 text-sm font-medium text-background enabled:hover:bg-gray-800 disabled:opacity-50"
      >
        <span aria-hidden="true">＋</span>
        {busy ? "新建中…" : "新建 Flow"}
      </button>
    </div>
  );
}

export function FlowsPage() {
  const [flows, setFlows] = useState<ProjectRecord[]>([]);
  const [templates, setTemplates] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [onboarded, setOnboarded] = useState(false);
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [renameText, setRenameText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await projectsApi.list();
      setFlows(all.filter((p) => p.kind === "flow"));
      // 054 的「灵感」是本机的 Flow 模板。这里只列本地存下来的模板，
      // 不搬上游那几份商业模板的名字 —— 没有就显示空态。
      setTemplates(all.filter((p) => p.kind === "flow-template"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = flows.filter((f) => !q || f.name.toLowerCase().includes(q));
    const sorted = [...filtered];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    else if (sort === "nodes")
      sorted.sort((a, b) => nodeCount(b) - nodeCount(a));
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted;
  }, [flows, query, sort]);

  async function rename() {
    if (!renaming || !renameText.trim()) return;
    try {
      await projectsApi.save(
        renaming.id,
        renaming.content,
        renameText.trim(),
      );
      setRenaming(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "重命名失败");
    }
  }

  async function duplicate(f: ProjectRecord) {
    const copy = await projectsApi.create({
      kind: "flow",
      name: `${f.name}（副本）`,
      content: f.content,
    });
    await load();
    setQuery("");
    return copy;
  }

  return (
    <div className="stack gap-6">
      {!onboarded && (
        <section className="rounded-2xl border border-gray-alpha-150 p-5">
          <h2 className="font-waldenburg text-lg text-foreground">开始使用 Flows</h2>
          <ul className="mt-3 stack gap-1.5 text-sm text-secondary">
            <li>· 添加并连接节点，把素材变成图像、视频和音频。</li>
            <li>· 在画布上摆放节点，按依赖顺序运行。</li>
          </ul>
          <p className="mt-2 text-xs text-subtle">
            能用哪些模型取决于你自己配置的 Provider；本地不会替你准备任何供应商账号。
          </p>
          <button
            type="button"
            onClick={() => setOnboarded(true)}
            className="focus-ring mt-4 h-9 w-full rounded-[10px] bg-foreground text-sm font-medium text-background hover:bg-gray-800"
          >
            开始使用
          </button>
        </section>
      )}

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">灵感</h2>
        {templates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-6 text-center text-sm text-secondary">
            还没有本地 Flow 模板。在画布上点「创建模板」就会出现在这里。
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {templates.slice(0, 4).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => void duplicate(t)}
                  className="focus-ring group w-full text-left"
                >
                  <div
                    aria-hidden="true"
                    className="flex aspect-video w-full items-center justify-center rounded-xl bg-gray-alpha-50 text-2xl text-subtle transition-colors group-hover:bg-gray-alpha-100"
                  >
                    ✦
                  </div>
                  <p className="mt-2 text-sm text-foreground">{t.name}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">最近的 Flows</h2>

        <label className="relative block">
          <span className="sr-only">搜索 Flow</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 Flow…"
            className="focus-ring h-10 w-full rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>

        {/* 054 的筛选行：角色 / 所有者 / 可见性 / 来源属于云工作区，按 SCOPE 移除，
            剩下的排序与视图控件保持原位、连续排列，不留空槽。 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-secondary">排序方式</span>
          <label className="sr-only" htmlFor="flow-sort">
            排序
          </label>
          <select
            id="flow-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="focus-ring h-8 rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            <option value="recent">最近更新</option>
            <option value="name">名称</option>
            <option value="nodes">节点数</option>
          </select>
          <div className="ml-auto flex shrink-0 overflow-hidden rounded-[10px] border border-gray-alpha-150">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-label={v === "grid" ? "网格视图" : "列表视图"}
                aria-pressed={view === v}
                className={`focus-ring px-2.5 py-1.5 ${
                  view === v ? "bg-gray-alpha-100 text-foreground" : "text-secondary"
                }`}
              >
                {v === "grid" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="focus-ring rounded-[10px] border border-red-200 px-2 py-0.5 text-xs"
            >
              重试
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-alpha-50" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
            {query.trim() ? "没有匹配的 Flow。" : "还没有 Flow。点右上角「新建 Flow」开始。"}
          </p>
        ) : (
          <ul
            className={
              view === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "stack gap-2"
            }
          >
            {shown.map((f) => (
              <li
                key={f.id}
                className={
                  view === "grid"
                    ? "group relative overflow-hidden rounded-xl border border-gray-alpha-150 bg-background transition-colors hover:border-gray-alpha-200"
                    : "flex items-center gap-2 rounded-xl border border-gray-alpha-150 px-4 py-2 pr-1 transition-colors hover:bg-gray-alpha-50"
                }
              >
                {/* 054 的卡片是「上方一块预览区 + 下方标题」，选项按钮浮在预览区右上角。 */}
                <div className={view === "grid" ? "relative" : "contents"}>
                  {view === "grid" && (
                    <Link
                      to={`/app/flows/${f.id}`}
                      aria-label={f.name}
                      className="focus-ring flex aspect-[3/2] w-full items-center justify-center bg-gray-alpha-50 text-3xl text-subtle"
                    >
                      <span aria-hidden="true">⌗</span>
                    </Link>
                  )}
                  <div className={view === "grid" ? "absolute top-2 right-2" : "contents"}>
                    <FlowRowMenu
                      flow={f}
                      onRename={() => {
                        setRenaming(f);
                        setRenameText(f.name);
                      }}
                      onDuplicate={() => void duplicate(f)}
                    />
                  </div>
                </div>
                <Link
                  to={`/app/flows/${f.id}`}
                  className={`focus-ring min-w-0 ${view === "grid" ? "block px-3 py-2.5" : "flex-1 py-0.5"}`}
                >
                  <p className="truncate text-sm font-medium text-foreground">{f.name}</p>
                  <p className="text-xs text-secondary">
                    {nodeCount(f)} 个节点 · 修订 {f.revision} · {relativeTime(f.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {renaming && (
        <Modal
          open
          onClose={() => setRenaming(null)}
          title="重命名 Flow"
          footer={
            <>
              <button
                type="button"
                onClick={() => setRenaming(null)}
                className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void rename()}
                disabled={!renameText.trim()}
                className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
              >
                保存
              </button>
            </>
          }
        >
          <input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            aria-label="Flow 名称"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}

      <p className="text-xs text-subtle">
        Flow 只存在本机。团队协作、云模板销售与公开分享按范围裁剪移除。
      </p>
    </div>
  );
}

function FlowRowMenu({
  flow,
  onRename,
  onDuplicate,
}: {
  flow: ProjectRecord;
  onRename: () => void;
  onDuplicate: () => void;
}) {
  const href = `/app/flows/${flow.id}`;
  const entries: MenuEntry[] = [
    { label: "打开新标签", onSelect: () => window.open(href, "_blank", "noopener") },
    { label: "复制", onSelect: onDuplicate },
    { label: "重命名", onSelect: onRename, separated: true },
    {
      label: "导出 JSON",
      onSelect: () =>
        downloadText(
          `${flow.name}.flow.json`,
          JSON.stringify({ name: flow.name, content: flow.content }, null, 2),
          "application/json",
        ),
    },
    {
      label: "复制本地链接",
      onSelect: () => void navigator.clipboard?.writeText(new URL(href, location.origin).href),
    },
    {
      label: "删除",
      onSelect: () => {
        void projectsApi.remove(flow.id);
      },
      danger: true,
      separated: true,
    },
  ];
  return (
    <Menu
      entries={entries}
      triggerLabel={`${flow.name} 选项`}
      align="right"
      width="min-w-44"
      trigger={<Dots />}
      triggerClassName="focus-ring rounded p-1.5 text-secondary enabled:hover:bg-gray-alpha-100"
    />
  );
}

function nodeCount(p: ProjectRecord): number {
  return Array.isArray(p.content.nodes) ? p.content.nodes.length : 0;
}

/** 参考里是「46分钟前」这种相对时间，比 ISO 串更接近原页面。 */
export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "时间未知";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(t).toISOString().slice(0, 10);
}
