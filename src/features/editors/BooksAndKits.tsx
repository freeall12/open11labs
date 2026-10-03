import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  projects as projectsApi,
  providers as providersApi,
  type AssetRecord,
  type JobRecord,
  type ProjectRecord,
  type ProviderRecord,
} from "@/lib/api";
import { ArtifactList } from "@/features/media/ArtifactList";
import { Modal } from "@/features/shared/Modal";
import { Dots, Menu } from "@/features/editors/Menu";
import { relativeTime } from "@/features/editors/FlowsPage";
import { downloadText } from "@/features/voice/transcript";

/* ==========================================================================
   有声书.

   参考只有 132/133 两张，交互记录还写明创建向导的截图两次 CDP 超时、只看到
   EPUB/PDF 上传向导的轮廓（上传→格式化→音色→发音）。所以这里不假装复刻向导，
   留下的是本地制作那一半：书架 → 分章 → 逐章生成旁白 → 导出。

   打款、收益分析、作者商业入驻、发布到零售平台由 SCOPE.md 移除，页面里没有
   对应入口，也不留空位。

   已知能力边界：导入只解析粘贴的纯文本并按空行分章。EPUB/PDF 解析没有实现
   （扫描件与复杂 EPUB 也不在本地能力内），创建弹层里写明了这一点。
   ========================================================================== */

interface Chapter {
  id: string;
  title: string;
  text: string;
  /** 生成后旁白对应的 asset id。 */
  audioAssetId?: string;
}

type BookStatus = "draft" | "wip" | "done";
type BookFilter = "all" | BookStatus | "series" | "solo";

const STATUS_LABEL: Record<BookStatus, string> = {
  draft: "草稿",
  wip: "生成中",
  done: "已完成",
};

function readChapters(p: ProjectRecord): Chapter[] {
  const raw = p.content.chapters;
  return Array.isArray(raw) ? (raw as Chapter[]) : [];
}

function statusOf(p: ProjectRecord): BookStatus {
  const chapters = readChapters(p);
  if (chapters.length === 0) return "draft";
  const done = chapters.filter((c) => c.audioAssetId).length;
  return done === 0 ? "draft" : done === chapters.length ? "done" : "wip";
}

function seriesOf(p: ProjectRecord): string {
  return typeof p.content.series === "string" ? p.content.series : "";
}

/**
 * 书架的状态放在 provider 里，不放在正文组件里。
 *
 * 为什么：133 里「+ 创建新项目」和「有声书」标题同一行，那个按钮走 PageFrame
 * 的 actions，而书架正文是 children —— 两者是并列的两棵子树，各自 useState 就
 * 是两个互不相干的实例，头上的按钮永远打不开正文里的弹层。放进 context 后两边
 * 共享同一份状态。
 */
interface BookStore {
  books: ProjectRecord[];
  loading: boolean;
  error: string | null;
  query: string;
  filter: BookFilter;
  view: "grid" | "list";
  createOpen: boolean;
  openId: string | null;
  renaming: ProjectRecord | null;
  renameText: string;
  setQuery: (v: string) => void;
  setFilter: (v: BookFilter) => void;
  setView: (v: "grid" | "list") => void;
  setRenameText: (v: string) => void;
  openCreate: () => void;
  closeCreate: () => void;
  openBook: (id: string) => void;
  closeBook: () => void;
  startRename: (p: ProjectRecord) => void;
  closeRename: () => void;
  refresh: () => Promise<void>;
  commitRename: () => Promise<void>;
}

const BookCtx = createContext<BookStore | null>(null);

export function useBookStore(): BookStore {
  const store = useContext(BookCtx);
  if (!store) throw new Error("useBookStore 必须在 AudiobooksProvider 内使用");
  return store;
}

export function AudiobooksProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BookFilter>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [renameText, setRenameText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await projectsApi.list();
      setBooks(all.filter((p) => p.kind === "book"));
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

  const store = useMemo<BookStore>(
    () => ({
      books,
      loading,
      error,
      query,
      filter,
      view,
      createOpen,
      openId,
      renaming,
      renameText,
      setQuery,
      setFilter,
      setView,
      setRenameText,
      openCreate: () => setCreateOpen(true),
      closeCreate: () => setCreateOpen(false),
      openBook: (id) => setOpenId(id),
      closeBook: () => setOpenId(null),
      startRename: (p) => {
        setRenaming(p);
        setRenameText(p.name);
      },
      closeRename: () => setRenaming(null),
      refresh: load,
      commitRename: async () => {
        if (!renaming || !renameText.trim()) return;
        try {
          await projectsApi.save(renaming.id, renaming.content, renameText.trim());
          setRenaming(null);
          await load();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "重命名失败");
        }
      },
    }),
    [books, loading, error, query, filter, view, createOpen, openId, renaming, renameText, load],
  );

  return <BookCtx.Provider value={store}>{children}</BookCtx.Provider>;
}

/** 页头「+ 创建新项目」按钮，由 pages.tsx 交给 PageFrame 的 actions。 */
export function AudiobooksCreateButton() {
  const { openCreate } = useBookStore();
  return (
    <button
      type="button"
      onClick={openCreate}
      className="focus-ring inline-flex items-center gap-1.5 rounded-[10px] bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-gray-800"
    >
      <span aria-hidden="true">＋</span>
      创建新项目
    </button>
  );
}

export function AudiobooksBody() {
  const {
    books,
    loading,
    error,
    query,
    filter,
    view,
    createOpen,
    openId,
    renaming,
    renameText,
    setQuery,
    setFilter,
    setView,
    setRenameText,
    openCreate,
    closeCreate,
    openBook,
    closeBook,
    startRename,
    closeRename,
    refresh: load,
    commitRename: rename,
  } = useBookStore();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((b) => {
      if (q && !b.name.toLowerCase().includes(q) && !seriesOf(b).toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "all") return true;
      if (filter === "series") return seriesOf(b) !== "";
      if (filter === "solo") return seriesOf(b) === "";
      return statusOf(b) === filter;
    });
  }, [books, query, filter]);

  return (
    <div className="stack gap-6">
      {/* 133 里两张开始卡片并排占满一行：保留本地制作那张，发布到零售平台那张
          由 SCOPE 移除。剩下的这一张仍占原来那一列，宽度不塌。 */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={openCreate}
          className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-gray-alpha-150 px-4 py-3 text-left transition-colors hover:bg-gray-alpha-50"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-alpha-100 text-secondary"
          >
            ▤
          </span>
          <span>
            <span className="block text-sm font-medium text-foreground">创建有声书</span>
            <span className="block text-xs text-secondary">
              导入章节文本，逐章生成旁白，再导出音频。
            </span>
          </span>
        </button>
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

      <section className="stack gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 133 里这一排还有打款 / 分析 / 资源，那是收益与发布面，按范围整体裁掉。
              连续布局、不留占位，所以这里只剩书架一个页签。 */}
          <div className="flex items-center gap-4 border-b border-gray-alpha-150">
            <span className="-mb-px border-b-2 border-foreground pb-2.5 pt-1 text-sm font-medium text-foreground">
              书架
            </span>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-[10px] border border-gray-alpha-150">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-label={v === "grid" ? "网格视图" : "列表视图"}
                aria-pressed={view === v}
                className={`focus-ring px-2.5 py-2 ${
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

        <label className="relative block">
          <span className="sr-only">搜索书籍和系列</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书籍和系列…"
            className="focus-ring h-10 w-full rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            label="类型"
            open={filter === "series" || filter === "solo"}
            onToggle={() => setFilter(filter === "all" ? "series" : "all")}
          />
          {filter === "series" && (
            <>
              <FilterChip label="只看系列" active onToggle={() => setFilter("series")} />
              <FilterChip label="只看单本" active onToggle={() => setFilter("solo")} />
            </>
          )}
          {/* 133 的这一排是「+ 类型 / + 状态 / + 语音」三枚下拉芯片，不是把状态值
              摊成三枚芯片。状态收进一枚，选中后变成可清除的已选项。 */}
          <FilterChip
            label="状态"
            open={filter === "draft" || filter === "wip" || filter === "done"}
            onToggle={() =>
              setFilter(filter === "draft" || filter === "wip" || filter === "done" ? "all" : "draft")
            }
          />
          {(["draft", "wip", "done"] as BookStatus[]).map((s) => (
            <FilterChip
              key={s}
              label={STATUS_LABEL[s]}
              active={filter === s}
              onToggle={() => setFilter(filter === s ? "all" : s)}
            />
          ))}
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-alpha-50" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="stack items-center gap-2 py-12 text-center">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-alpha-150 text-secondary"
            >
              ▤
            </span>
            <p className="text-sm text-foreground">
              {books.length === 0 ? "书架是空的" : "未找到书籍"}
            </p>
            <p className="text-xs text-secondary">
              {books.length === 0
                ? "点右上角「创建新项目」，或粘贴章节文本自动分章。"
                : "换一个关键词，或清掉上面的筛选。"}
            </p>
          </div>
        ) : (
          <ul
            className={
              view === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "stack gap-2"
            }
          >
            {shown.map((b) => {
              const chapters = readChapters(b);
              const done = chapters.filter((c) => c.audioAssetId).length;
              return (
                <li
                  key={b.id}
                  className="flex items-center gap-2 rounded-xl border border-gray-alpha-150 pr-1 hover:bg-gray-alpha-50"
                >
                  <button
                    type="button"
                    onClick={() => openBook(b.id)}
                    className="focus-ring min-w-0 flex-1 px-4 py-3 text-left"
                  >
                    <p className="truncate text-sm font-medium text-foreground">{b.name}</p>
                    <p className="text-xs text-secondary">
                      {seriesOf(b) && `${seriesOf(b)} · `}
                      {chapters.length} 章 · {STATUS_LABEL[statusOf(b)]} ·{" "}
                      {relativeTime(b.updatedAt)}
                    </p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-alpha-100">
                      <div
                        className="h-full bg-foreground"
                        style={{ width: chapters.length ? `${(done / chapters.length) * 100}%` : "0%" }}
                      />
                    </div>
                  </button>
                  <BookRowMenu
                    book={b}
                    onOpen={() => openBook(b.id)}
                    onRename={() => startRename(b)}
                    onChanged={load}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-subtle">
        书籍只存在本机。发布到零售平台、收益分析与作者商业入驻按范围裁剪移除。
      </p>

      {createOpen && (
        <CreateBookDialog
          onClose={closeCreate}
          onSaved={async (id) => {
            closeCreate();
            await load();
            openBook(id);
          }}
        />
      )}

      {renaming && (
        <Modal
          open
          onClose={closeRename}
          title="重命名有声书"
          footer={
            <>
              <button
                type="button"
                onClick={closeRename}
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
            aria-label="书名"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none"
          />
        </Modal>
      )}

      {openId && <BookEditor bookId={openId} onClose={closeBook} onChanged={load} />}
    </div>
  );
}

function FilterChip({
  label,
  active,
  open,
  onToggle,
}: {
  label: string;
  active?: boolean;
  open?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!!active}
      className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
        active || open
          ? "border-foreground text-foreground"
          : "border-gray-alpha-200 text-secondary hover:bg-gray-alpha-50"
      }`}
    >
      {!active && <span aria-hidden="true">＋</span>}
      {label}
    </button>
  );
}

function BookRowMenu({
  book,
  onOpen,
  onRename,
  onChanged,
}: {
  book: ProjectRecord;
  onOpen: () => void;
  onRename: () => void;
  onChanged: () => Promise<void>;
}) {
  return (
    <Menu
      triggerLabel={`${book.name} 选项`}
      align="right"
      width="min-w-44"
      trigger={<Dots />}
      triggerClassName="focus-ring rounded p-1.5 text-secondary enabled:hover:bg-gray-alpha-100"
      entries={[
        { label: "打开", onSelect: onOpen },
        { label: "重命名", onSelect: onRename },
        {
          label: "导出结构",
          onSelect: () =>
            downloadText(
              `${book.name}.book.json`,
              JSON.stringify({ name: book.name, content: book.content }, null, 2),
              "application/json",
            ),
        },
        {
          label: "删除",
          onSelect: () => {
            void projectsApi.remove(book.id).then(() => onChanged());
          },
          danger: true,
          separated: true,
        },
      ]}
    />
  );
}

function CreateBookDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [series, setSeries] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 按空行分章；看起来像标题的首行成为章名。 */
  function parse(raw: string): Chapter[] {
    return raw
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block, i) => {
        const lines = block.split("\n");
        const first = lines[0].trim();
        const looksLikeHeading = lines.length > 1 && first.length <= 40 && !/[。.!?！？]$/.test(first);
        return {
          id: `c${i + 1}`,
          title: looksLikeHeading ? first : `第 ${i + 1} 章`,
          text: looksLikeHeading ? lines.slice(1).join("\n").trim() : block,
        };
      });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const chapters = parse(text);
      if (chapters.length === 0) {
        setError("请粘贴至少一章内容（段落之间用空行分隔）。");
        return;
      }
      const project = await projectsApi.create({
        kind: "book",
        name: name.trim() || "未命名有声书",
        content: { chapters, series: series.trim(), voiceId: null, voiceName: null },
      });
      await onSaved(project.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="创建有声书"
      width="max-w-2xl"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-red-700">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!text.trim() || busy}
            className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </>
      }
    >
      <div className="stack gap-3">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">书名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="未命名有声书"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">所属系列（可留空）</span>
          <input
            value={series}
            onChange={(e) => setSeries(e.target.value)}
            placeholder="例如：野外观察"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">正文（空行分章）</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"第一章\n\n正文…\n\n第二章\n\n正文…"}
            className="focus-ring w-full resize-y rounded-lg border border-gray-alpha-150 bg-background p-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>
        <p className="text-xs text-subtle">
          导入只在本机解析文本，不发送到任何服务。生成旁白时才会调用你的 Provider。
          <strong className="block pt-1 font-medium text-amber-800">
            EPUB/PDF 导入尚未实现：参考里的上传向导（上传→格式化→音色→发音）没有采到
            稳定截图，本地也没有做 PDF 扫描件 OCR 与复杂 EPUB 解析。先用纯文本分章。
          </strong>
        </p>
      </div>
    </Modal>
  );
}

function BookEditor({
  bookId,
  onClose,
  onChanged,
}: {
  bookId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [book, setBook] = useState<ProjectRecord | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobRecord>>({});
  const [note, setNote] = useState<string | null>(null);
  const [ackCost, setAckCost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, a, p] = await Promise.all([
        projectsApi.list(),
        assetsApi.list(),
        providersApi.list(),
      ]);
      setBook(all.find((x) => x.id === bookId) ?? null);
      setAssets(a.assets);
      setProvider(p.find((x) => x.validationState === "available") ?? p[0] ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取失败");
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const chapters = useMemo(() => (book ? readChapters(book) : []), [book]);

  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!book) return null;

  async function render(chapter: Chapter) {
    if (!provider) {
      setNote("尚未配置 Provider。");
      return;
    }
    setRunning(chapter.id);
    setNote(null);
    try {
      const created = await jobsApi.create({
        // 每章一个 intent：重跑一章不会撞上另一章，重复提交同一章会复用任务。
        intentId: `book:${book!.id}:${chapter.id}`,
        type: "text_to_speech",
        providerId: provider.id,
        credentialRef: provider.id,
        input: {
          text: chapter.text,
          voiceId: String(book!.content.voiceId ?? ""),
          outputFormat: "mp3_44100_128",
          acknowledgeUnknownCost: true,
        },
      });
      setJobs((j) => ({ ...j, [chapter.id]: created.job }));
      if (!created.created) {
        setNote(`「${chapter.title}」已有相同提交，复用了原任务。`);
        return;
      }
      const out = await jobsApi.run(created.job.id);
      setJobs((j) => ({ ...j, [chapter.id]: out.job }));
      if (out.asset) {
        await projectsApi.save(book!.id, {
          ...book!.content,
          chapters: readChapters(book!).map((c) =>
            c.id === chapter.id ? { ...c, audioAssetId: out.asset!.id } : c,
          ),
        });
        await load();
        setNote(`「${chapter.title}」已生成。`);
      } else {
        setNote(out.reason ?? "生成未完成。");
      }
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "生成失败");
    } finally {
      setRunning(null);
    }
  }

  async function cancelChapter(chapterId: string) {
    const job = jobs[chapterId];
    if (!job) return;
    try {
      const out = await jobsApi.cancel(job.id);
      setNote(`已请求取消：${out.scope.stops}。不会发生：${out.scope.doesNot.join("、")}。`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "取消失败");
    }
  }

  const rendered = assets.filter((a) => chapters.some((c) => c.audioAssetId === a.id));
  const pending = chapters.filter((c) => !c.audioAssetId);

  return (
    <Modal
      open
      onClose={onClose}
      title={book.name}
      width="max-w-3xl"
      footer={
        <>
          <span className="mr-auto text-xs text-subtle">
            已生成 {chapters.length - pending.length} / {chapters.length} 章
          </span>
          <button
            type="button"
            onClick={() => {
              // 关掉弹层后书架上的进度条要跟着更新。
              onClose();
              void onChanged();
            }}
            className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
          >
            关闭
          </button>
        </>
      }
    >
      <div className="stack gap-4">
        <label className="flex items-start gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={ackCost}
            onChange={(e) => setAckCost(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            我了解逐章生成会产生费用、金额未知，并同意把章节文本发送到{" "}
            {provider?.baseURL ?? "你的 Provider"}。
          </span>
        </label>

        {note && <p className="rounded-lg bg-gray-alpha-50 px-3 py-2 text-sm text-secondary">{note}</p>}

        {pending.length > 0 && (
          <button
            type="button"
            disabled={!ackCost || running !== null || !provider || pending.length === 0}
            onClick={() => {
              // 逐章串行：一章失败不影响其它章，也不做任何自动重试。
              void (async () => {
                for (const c of pending) {
                  await render(c);
                }
              })();
            }}
            className="focus-ring w-fit rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm enabled:hover:bg-gray-alpha-50 disabled:opacity-40"
          >
            生成全部未完成章节（{pending.length}）
          </button>
        )}

        <ol className="divide-y divide-gray-alpha-100 overflow-hidden rounded-xl border border-gray-alpha-150">
          {chapters.map((c, i) => {
            const asset = assets.find((a) => a.id === c.audioAssetId);
            const status = jobs[c.id]?.status ?? (c.audioAssetId ? "succeeded" : null);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-6 text-xs text-subtle">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{c.title}</p>
                  <p className="text-xs text-subtle">{c.text.length} 字符</p>
                </div>
                {asset ? (
                  <>
                    <audio controls preload="none" src={asset.url} className="h-8 w-40" />
                    <a
                      href={asset.url}
                      download={asset.displayName}
                      className="focus-ring rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50"
                    >
                      下载
                    </a>
                  </>
                ) : running === c.id ? (
                  <>
                    <span className="text-xs text-secondary">生成中…</span>
                    <button
                      type="button"
                      onClick={() => void cancelChapter(c.id)}
                      className="focus-ring rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void render(c)}
                    disabled={!ackCost || running !== null || !provider}
                    className="focus-ring shrink-0 rounded-[10px] bg-foreground px-3 py-1.5 text-xs text-background disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    生成旁白
                  </button>
                )}
                {status && !asset && running !== c.id && (
                  <span className="text-xs text-secondary">{status}</span>
                )}
              </li>
            );
          })}
        </ol>

        {rendered.length > 0 && <ArtifactList title="已生成章节" assets={rendered} empty="" />}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------- brand kits -- */

export function BrandKitsPage() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteUrl, setSiteUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await assetsApi.list();
      setAssets(res.assets);
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

  const brandAssets = assets.filter(
    (a) => a.mediaType.startsWith("image/") || /font/.test(a.mediaType),
  );

  return (
    <div className="stack gap-6">
      {/* 073 里这一页是「素材」下的第二个页签，所以标题下面有一排页签。
          「文件」指向素材库那一页，「品牌套件」是当前页。 */}
      <div className="flex items-center gap-6 border-b border-gray-alpha-150">
        <Link
          to="/app/files"
          className="focus-ring -mb-px px-1 pb-2.5 text-sm text-secondary hover:text-foreground"
        >
          文件
        </Link>
        <span className="-mb-px border-b-2 border-foreground px-1 pb-2.5 text-sm font-medium text-foreground">
          品牌套件
        </span>
      </div>

      <p className="text-sm text-secondary">
        本地品牌素材：logo、配色与字体参考，集中存放供各工具引用。
        云端工作区共享与成员权限按范围裁剪移除。
      </p>

      <label className="w-fit cursor-pointer rounded-[10px] border border-gray-alpha-200 px-3 py-1.5 text-sm hover:bg-gray-alpha-50">
        上传品牌素材
        <input
          type="file"
          className="sr-only"
          accept="image/*,.ttf,.otf,.woff2"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await assetsApi.upload(f);
              await load();
              setNote(`${f.name} 已加入品牌套件。`);
            } catch (err) {
              setNote(err instanceof ApiError ? err.message : "上传失败");
            }
          }}
        />
      </label>

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

      {note && <p className="text-sm text-secondary">{note}</p>}

      <ArtifactList
        assets={brandAssets}
        loading={loading}
        empty="还没有品牌素材。上传 logo 或字体文件后，它们会出现在这里供各工具引用。"
      />

      {/* 073 空态里的起始行。本地没有站点抓取管线，所以「来自网站」按参考那样
          置灰并写明原因，而不是塞一个点了没反应或假装成功的按钮。 */}
      {brandAssets.length === 0 && !loading && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <input
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="网站 URL"
            aria-label="品牌素材来源网址"
            className="focus-ring h-9 w-72 rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            disabled
            title="本地没有站点抓取管线，无法从网址提取 logo 与配色。请改用上面的「上传品牌素材」。"
            className="focus-ring h-9 rounded-[10px] bg-gray-alpha-100 px-3 text-sm text-subtle disabled:cursor-not-allowed"
          >
            来自网站
          </button>
        </div>
      )}
    </div>
  );
}
