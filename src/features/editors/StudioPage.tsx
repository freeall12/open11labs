import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  projects as projectsApi,
  type AssetRecord,
  type ProjectRecord,
} from "@/lib/api";
import { ArtifactList } from "@/features/media/ArtifactList";
import { Modal } from "@/features/shared/Modal";
import { Dots, Menu } from "@/features/editors/Menu";
import { relativeTime } from "@/features/editors/FlowsPage";
import { downloadText } from "@/features/voice/transcript";

/* ==========================================================================
   Studio.

   Reference shape: a centred "what do you want to create" prompt, an
   灵感 (inspiration) row of starting templates, then the project list with
   全部 / 视频 / 音频 tabs, an upload action and a search field.

   Removed per SCOPE.md: the 创建者 filter chip and the 所有者 column, which
   exist only to filter a shared cloud workspace. The 分享 control is removed
   with them. What stays is the single-user local project list.

   A project here is a local `ProjectRecord`: structured content, a revision
   and a set of asset references. Opening one yields the editor, and deriving a
   variant from an existing project is the supported way to iterate.
   ========================================================================== */

type Filter = "all" | "video" | "audio";

/** 段落类型。取值与本模块其它工具的 beat kind 一致，没有凭空多加能力。 */
const BEAT_KINDS = ["tts", "music", "sfx", "image", "stt"];

/** Starting points. Each opens a blank project with a pre-shaped timeline. */
const INSPIRATION = [
  {
    id: "film-trailer",
    label: "Film trailer",
    kind: "video",
    hue: "from-gray-200 to-gray-400",
    content: {
      beats: [
        { id: "b1", name: "旁白", kind: "tts" },
        { id: "b2", name: "配乐", kind: "music" },
        { id: "b3", name: "画面", kind: "image" },
      ],
    },
  },
  {
    id: "explainer",
    label: "Explainer video",
    kind: "video",
    hue: "from-amber-200 to-blue-400",
    content: {
      beats: [
        { id: "b1", name: "开场", kind: "tts" },
        { id: "b2", name: "图示", kind: "image" },
        { id: "b3", name: "旁白", kind: "tts" },
      ],
    },
  },
  {
    id: "product",
    label: "Product video",
    kind: "video",
    hue: "from-stone-200 to-stone-400",
    content: { beats: [{ id: "b1", name: "产品镜头", kind: "image" }] },
  },
  {
    id: "documentary",
    label: "Audio documentary",
    kind: "audio",
    hue: "from-sky-200 to-indigo-500",
    content: {
      beats: [
        { id: "b1", name: "解说", kind: "tts" },
        { id: "b2", name: "环境音", kind: "sfx" },
      ],
    },
  },
];

export function StudioPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [refMenu, setRefMenu] = useState(false);
  const [refQuery, setRefQuery] = useState("");
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [renameText, setRenameText] = useState("");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        projectsApi.list(),
        assetsApi.list().catch(() => ({ assets: [] as AssetRecord[] })),
      ]);
      setProjects(p.filter((x) => x.kind === "studio"));
      setAssets(a.assets);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter !== "all" && p.content.kind !== filter) return false;
      return !q || p.name.toLowerCase().includes(q);
    });
  }, [projects, filter, query]);

  async function create(name: string, content: Record<string, unknown>) {
    const project = await projectsApi.create({ kind: "studio", name, content });
    await load();
    navigate(`/app/studio/${project.id}`);
  }

  async function rename() {
    if (!renaming || !renameText.trim()) return;
    try {
      await projectsApi.save(renaming.id, renaming.content, renameText.trim());
      setRenaming(null);
      await load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "重命名失败");
    }
  }

  return (
    <div className="stack gap-8 pb-24">
      <section className="stack gap-4">
        <h1 className="text-center font-waldenburg text-3xl font-normal text-foreground">
          你想创建什么?
        </h1>
        <div className="relative mx-auto flex w-full max-w-[650px] items-center gap-2 rounded-[32px] border border-gray-alpha-150 bg-background px-4 py-2 shadow-natural-xs">
          <button
            type="button"
            aria-label="添加文件"
            aria-expanded={refMenu}
            onClick={() => setRefMenu((v) => !v)}
            className="focus-ring rounded-full p-1 text-secondary hover:bg-gray-alpha-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="为…创建一个发布视"
            aria-label="描述要创建的项目"
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) void create(query.trim(), { kind: "video", beats: [] });
            }}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            aria-label="引用本机素材"
            onClick={() => {
              // 引用只把素材名写进提示词：新建的项目仍是一个空白工程。
              const a = assets[0];
              if (!a) {
                setNote("本机素材库还是空的，先上传一个文件再引用。");
                return;
              }
              setQuery((v) => (v.trim() ? `${v.trim()} 引用 ${a.displayName}` : `参考 ${a.displayName} 创作`));
            }}
            className="focus-ring rounded-full p-1 text-secondary hover:bg-gray-alpha-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6.5 9.5l3-3a1.8 1.8 0 012.5 2.5l-4 4a3 3 0 01-4.2-4.2l4-4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => query.trim() && void create(query.trim(), { kind: "video", beats: [] })}
            disabled={!query.trim()}
            aria-label="创建项目"
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:bg-gray-300"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 19V5m0 0l-6 6m6-6l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {refMenu && (
            <div
              className="absolute top-[calc(100%+8px)] left-1/2 z-40 w-[300px] -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-alpha-150 bg-background shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-gray-alpha-100 p-2">
                <input
                  value={refQuery}
                  onChange={(e) => setRefQuery(e.target.value)}
                  placeholder="搜索本机素材…"
                  aria-label="搜索本机素材"
                  className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-2.5 text-sm outline-none placeholder:text-subtle"
                />
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
                {assets
                  .filter((a) => !refQuery.trim() || a.displayName.toLowerCase().includes(refQuery.trim().toLowerCase()))
                  .slice(0, 20)
                  .map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setQuery((v) =>
                          v.trim() ? `${v.trim()} 引用 ${a.displayName}` : `参考 ${a.displayName} 创作`,
                        );
                        setRefMenu(false);
                      }}
                      className="focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-alpha-50"
                    >
                      <span className="min-w-0 flex-1 truncate">{a.displayName}</span>
                      <span className="shrink-0 text-[11px] text-subtle">{a.mediaType}</span>
                    </button>
                  ))}
                {assets.length === 0 && (
                  <p className="px-3 py-3 text-xs text-secondary">
                    本机素材库还是空的。可以先用下面的「上传」放一个进来。
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-subtle">
          输入描述会创建一个本地空白项目；结构化编辑在项目内完成。
        </p>
      </section>

      <section className="stack gap-4">
        {/* 参考里这一行右侧只有「查看全部灵感」一个链接，所以说明挪到左边跟着标题。 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-medium text-foreground">灵感</h2>
            <span className="text-xs text-subtle">模板均为本地结构，不含云端素材</span>
          </div>
          <Link
            to="/app/studio/templates"
            className="focus-ring shrink-0 text-xs text-foreground hover:underline"
          >
            查看全部灵感 →
          </Link>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {INSPIRATION.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => void create(t.label, { kind: t.kind, ...t.content })}
                className="focus-ring group w-full text-left"
              >
                <div
                  className={`aspect-video w-full rounded-xl bg-linear-to-br ${t.hue} transition-transform group-hover:scale-[1.01]`}
                  aria-hidden="true"
                />
                <p className="mt-2 text-sm text-foreground">{t.label}</p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="stack gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 border-b border-gray-alpha-150">
            {(["all", "video", "audio"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-current={filter === f}
                /* 047 里选中的是一枚白底带边框的小药丸，下划线来自整条 tablist 的边。 */
                className={`focus-ring -mb-px px-2.5 py-1.5 text-sm transition-colors ${
                  filter === f
                    ? "rounded-[10px] bg-background text-foreground shadow-natural-xs outline-1 outline-gray-alpha-150"
                    : "rounded-[10px] text-secondary hover:text-foreground"
                }`}
              >
                {f === "all" ? "全部" : f === "video" ? "视频" : "音频"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50">
              上传
              <input
                type="file"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    await assetsApi.upload(f);
                    await load();
                    setNote(`${f.name} 已上传到素材库。`);
                  } catch (err) {
                    setNote(err instanceof ApiError ? err.message : "上传失败");
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void create("未命名项目", { kind: "video", beats: [] })}
              className="focus-ring inline-flex items-center gap-1.5 rounded-[10px] bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-gray-800"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              新建空白项目
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索最近内容</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索最近内容…"
              className="focus-ring h-10 w-full rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
            />
          </label>
          <div className="flex shrink-0 overflow-hidden rounded-[10px] border border-gray-alpha-150">
            {(["list", "grid"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-label={v === "list" ? "列表视图" : "网格视图"}
                aria-pressed={view === v}
                className={`focus-ring px-2.5 py-2 ${
                  view === v ? "bg-gray-alpha-100 text-foreground" : "text-secondary"
                }`}
              >
                {v === "list" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                    <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {note && (
          <div className="flex items-center gap-3 text-sm text-secondary">
            <span>{note}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="focus-ring rounded-[10px] border border-gray-alpha-200 px-2 py-0.5 text-xs hover:bg-gray-alpha-50"
            >
              重试
            </button>
          </div>
        )}

        {loading ? (
          <div className="h-16 animate-pulse rounded-xl bg-gray-alpha-50" />
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
            {projects.length === 0
              ? "还没有项目。用上方的灵感模板或「新建空白项目」开始。"
              : `没有匹配「${query.trim()}」的项目。`}
          </p>
        ) : (
          <ul
            className={
              view === "grid"
                ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                : "divide-y divide-gray-alpha-100 overflow-hidden rounded-xl border border-gray-alpha-150 [&>li]:px-0"
            }
          >
            {filtered.map((p) => {
              const thumb = assets.find((a) => p.assetRefs.includes(a.id));
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 pr-1 transition-colors hover:bg-gray-alpha-50 ${
                    view === "grid" ? "rounded-xl border border-gray-alpha-150" : ""
                  }`}
                >
                  <Link
                    to={`/app/studio/${p.id}`}
                    className="focus-ring flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
                  >
                    {thumb ? (
                      <img
                        src={thumb.url}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="h-9 w-9 shrink-0 rounded-md bg-gray-alpha-100"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {p.name}
                      </span>
                      <span className="block text-xs text-secondary">
                        {String(p.content.kind ?? "video")} · 修订 {p.revision} ·{" "}
                        {relativeTime(p.updatedAt)}
                      </span>
                      {p.content.derivedFrom &&
                        typeof p.content.derivedFrom === "object" &&
                        "changed" in p.content.derivedFrom && (
                          <span className="mt-0.5 block text-xs text-subtle">
                            派生自 {String((p.content.derivedFrom as { id: string }).id).slice(0, 8)} ·
                            变量{" "}
                            {((p.content.derivedFrom as { changed: string[] }).changed ?? []).join("、") ||
                              "无"}
                          </span>
                        )}
                    </span>
                  </Link>
                  <ProjectRowMenu
                    project={p}
                    onRename={() => {
                      setRenaming(p);
                      setRenameText(p.name);
                    }}
                    onChanged={load}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {renaming && (
        <Modal
          open
          onClose={() => setRenaming(null)}
          title="重命名项目"
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
            aria-label="项目名称"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}
    </div>
  );
}

/** 047 里每行右侧的「…」。分享按范围裁剪移除，所以菜单里没有它。 */
function ProjectRowMenu({
  project,
  onRename,
  onChanged,
}: {
  project: ProjectRecord;
  onRename: () => void;
  onChanged: () => Promise<void>;
}) {
  return (
    <Menu
      triggerLabel={`${project.name} 选项`}
      align="right"
      width="min-w-44"
      trigger={<Dots />}
      triggerClassName="focus-ring rounded p-1.5 text-secondary enabled:hover:bg-gray-alpha-100"
      entries={[
        { label: "重命名", onSelect: onRename },
        {
          label: "复制",
          onSelect: () => {
            void projectsApi
              .create({ kind: "studio", name: `${project.name}（副本）`, content: project.content })
              .then(() => onChanged());
          },
        },
        {
          label: "导出 JSON",
          onSelect: () =>
            downloadText(
              `${project.name}.studio.json`,
              JSON.stringify({ name: project.name, content: project.content }, null, 2),
              "application/json",
            ),
        },
        {
          label: "删除",
          onSelect: () => {
            void projectsApi.remove(project.id).then(() => onChanged());
          },
          danger: true,
          separated: true,
        },
      ]}
    />
  );
}

/* ------------------------------------------------------ studio editor -- */

/**
 * Project editor.
 *
 * routes.json marks the upstream editor path as `pending-discovery`, so this
 * does not claim to mirror an observed screen. It is the local editor for a
 * project: the beat timeline, editing its parameters, saving a new revision,
 * and deriving a variant. Both of those are real operations against the local
 * project store.
 */
export function StudioEditorPage() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [variantName, setVariantName] = useState("");
  const [deriveOpen, setDeriveOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const all = await projectsApi.list();
      const found = all.find((p) => p.id === id) ?? null;
      if (!found) {
        setError("找不到该项目，可能已被删除。");
        return;
      }
      setProject(found);
      const a = await assetsApi.list();
      setAssets(a.assets);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取失败");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  }
  if (!project) return <p className="text-sm text-secondary">读取项目…</p>;

  const beats = Array.isArray(project.content.beats) ? project.content.beats : [];

  async function addBeat() {
    const next = [
      ...beats,
      { id: `b${beats.length + 1}`, name: `段落 ${beats.length + 1}`, kind: "tts" },
    ];
    await saveBeats(next);
  }

  async function removeBeat(beatId: string) {
    await saveBeats(beats.filter((b: { id: string }) => b.id !== beatId));
  }

  async function saveBeats(next: unknown[]) {
    setSaving("正在保存…");
    try {
      const saved = await projectsApi.save(project!.id, { ...project!.content, beats: next });
      setProject(saved);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  async function moveBeat(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= beats.length) return;
    const next = [...beats];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    await saveBeats(next);
  }

  async function renameProject() {
    if (!nameDraft.trim()) return;
    try {
      const saved = await projectsApi.save(
        project!.id,
        project!.content,
        nameDraft.trim(),
      );
      setProject(saved);
      setRenameOpen(false);
      setNote("已重命名。");
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "重命名失败");
    }
  }

  async function removeProject() {
    await projectsApi.remove(project!.id);
    navigate("/app/studio");
  }

  async function derive() {
    if (!variantName.trim()) return;
    try {
      const child = await projectsApi.deriveVariant(
        project!.id,
        { name: variantName.trim() },
        variantName.trim(),
      );
      setDeriveOpen(false);
      setNote(`已派生变体 ${child.name}（修订 ${child.revision}），未重新生成任何素材。`);
      await load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "派生失败");
    }
  }

  return (
    <div className="stack gap-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="stack gap-1">
        <p className="font-waldenburg text-2xl font-normal text-foreground">{project.name}</p>
          <p className="text-sm text-secondary">
            本地工程 · 修订 {project.revision} · 结构版本 {project.schemaVersion ?? 1}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setNameDraft(project.name);
              setRenameOpen(true);
            }}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
          >
            重命名
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${project.name}.studio.json`,
                JSON.stringify({ name: project.name, content: project.content }, null, 2),
                "application/json",
              )
            }
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
          >
            导出
          </button>
          <button
            type="button"
            onClick={() => setDeriveOpen(true)}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
          >
            派生变体
          </button>
          <Link
            to="/app/studio"
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50"
          >
            返回列表
          </Link>
          <button
            type="button"
            onClick={() => void removeProject()}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm text-red-700 hover:bg-gray-alpha-50"
          >
            删除项目
          </button>
        </div>
      </div>

      {note && <p className="rounded-lg bg-gray-alpha-50 px-3 py-2 text-sm text-secondary">{note}</p>}

      <section className="stack gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">
            时间线
            <span className="ml-2 text-xs font-normal text-subtle">
              {saving ?? `${beats.length} 段 · 修订 ${project.revision}`}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => void addBeat()}
            disabled={saving !== null}
            className="focus-ring rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm enabled:hover:bg-gray-alpha-50 disabled:opacity-40"
          >
            添加段落
          </button>
        </div>

        {beats.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-8 text-center text-sm text-secondary">
            这个项目还没有段落。
          </p>
        ) : (
          <ol className="stack gap-2">
            {beats.map((b: { id: string; name: string; kind: string; text?: string }, i: number) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-alpha-150 px-4 py-3"
              >
                <span className="w-6 text-xs text-subtle">{i + 1}</span>
                <input
                  value={b.name}
                  aria-label={`第 ${i + 1} 段名称`}
                  onChange={(e) =>
                    setProject({
                      ...project,
                      content: {
                        ...project.content,
                        beats: beats.map((x: { id: string }) =>
                          x.id === b.id ? { ...b, name: e.target.value } : x,
                        ),
                      },
                    })
                  }
                  onBlur={(e) => {
                    const next = beats.map((x: { id: string }) =>
                      x.id === b.id ? { ...b, name: e.target.value } : x,
                    );
                    if (next !== beats) void saveBeats(next);
                  }}
                  className="focus-ring min-w-32 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-gray-alpha-150 focus:border-gray-alpha-150"
                />
                <label className="sr-only" htmlFor={`beat-kind-${b.id}`}>
                  第 {i + 1} 段类型
                </label>
                <select
                  id={`beat-kind-${b.id}`}
                  value={b.kind}
                  onChange={(e) => {
                    const next = beats.map((x: { id: string }) =>
                      x.id === b.id ? { ...b, kind: e.target.value } : x,
                    );
                    void saveBeats(next);
                  }}
                  className="focus-ring rounded-full border border-gray-alpha-150 bg-background px-2 py-0.5 text-xs outline-none"
                >
                  {BEAT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => void moveBeat(i, -1)}
                    disabled={i === 0 || saving !== null}
                    aria-label={`上移 ${b.name}`}
                    className="focus-ring rounded px-1.5 py-1 text-xs text-secondary enabled:hover:bg-gray-alpha-50 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => void moveBeat(i, 1)}
                    disabled={i === beats.length - 1 || saving !== null}
                    aria-label={`下移 ${b.name}`}
                    className="focus-ring rounded px-1.5 py-1 text-xs text-secondary enabled:hover:bg-gray-alpha-50 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeBeat(b.id)}
                    disabled={saving !== null}
                    aria-label={`删除 ${b.name}`}
                    className="focus-ring rounded px-2 py-1 text-xs text-secondary enabled:hover:bg-gray-alpha-50 disabled:opacity-30"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">
          引用素材（{project.assetRefs.length}）
        </h2>
        <ArtifactList
          assets={assets.filter((a) => project.assetRefs.includes(a.id))}
          empty="这个项目还没有引用素材。"
        />
      </section>

      {renameOpen && (
        <Modal
          open
          onClose={() => setRenameOpen(false)}
          title="重命名项目"
          footer={
            <>
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void renameProject()}
                disabled={!nameDraft.trim()}
                className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
              >
                保存
              </button>
            </>
          }
        >
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-label="项目名称"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}

      {deriveOpen && (
        <Modal
          open
          onClose={() => setDeriveOpen(false)}
          title="派生变体"
          footer={
            <>
              <button
                type="button"
                onClick={() => setDeriveOpen(false)}
                className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void derive()}
                disabled={!variantName.trim()}
                className="focus-ring h-9 rounded-[10px] bg-gray-400 px-4 text-sm font-medium text-white enabled:hover:bg-gray-800 disabled:cursor-not-allowed"
              >
                派生
              </button>
            </>
          }
        >
          <div className="stack gap-3">
            <label className="stack gap-1.5 text-sm">
              <span className="text-secondary">变体名称</span>
              <input
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="例如：30 秒竖版"
                className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
              />
            </label>
            <p className="text-xs text-subtle">
              派生只复制结构并替换具名变量，<strong>复用现有素材，不重新生成</strong>。
              要出新成片仍需走正常的费用确认路径。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
