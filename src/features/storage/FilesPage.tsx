import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Modal } from "@/features/shared/Modal";
import {
  ApiError,
  assets as assetsApi,
  projects as projectsApi,
  type AssetRecord,
} from "@/lib/api";

/* ==========================================================================
   Local assets — 素材 (066, 067, 068, 069, 070, 071).

   Shape, read off the reference rather than guessed:

     - the page heading and the two page-level actions (新建文件夹 / 上传)
       sit on one row, actions right-aligned. PageFrame owns the <h1>; the
       actions are handed to it, so the page never grows a second heading.
     - under that, a two-tab strip 文件 / 品牌套件.
     - then one toolbar row: a full-width search field, and a bordered pair
       of icon-only list/grid toggles.
     - then a real table: 名称 / 已添加 / 类型 / 文件大小, with a hairline
       under the header only. Rows have no dividers, as in 069.

   SCOPE.md removes the account owner filter, so the reference's `+ 所有者`
   filter chip row is not rendered and no placeholder is left in its place.
   The local 来源 filter is not a stand-in for it: it filters the asset's own
   `origin` field, it lives in the toolbar rather than in the removed filter
   row, and it carries no owner/workspace/member concept.

   070 is named "new-folder-dialog" in the research set, but the captured
   state is an inline editing row appended to the table with a textbox
   pre-filled 未命名文件夹 — the a11y tree shows a textbox inside the list
   container, and the screenshot shows the row ringed in place, not a
   floating panel. The inline row is what this page reproduces.

   Persistence: upstream creates the folder the moment the row appears, so
   Escape leaves it behind (071). specs/pages/assets-local.md requires the
   local build to say which of the two it does, so the local row is an
   explicit draft: Enter or blur commits it through POST /api/v1/folders,
   Escape cancels the draft and nothing is written. The hint under the table
   states this, so Escape cancelling a draft can never be mistaken for
   Escape deleting a stored folder.
   ========================================================================== */

type View = "list" | "grid";

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

/** Server-side accept list, mirrored for a pre-flight check (assets.mjs). */
const ACCEPTED_EXT = [
  ".mp3", ".wav", ".m4a", ".ogg", ".flac",
  ".mp4", ".webm",
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".srt", ".vtt", ".txt", ".json",
];
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const ACCEPT_ATTR = "audio/*,video/*,image/*,.srt,.vtt,.txt,.json";

const ORIGIN_LABEL: Record<string, string> = {
  generated: "生成",
  uploaded: "上传",
  youtube: "YouTube",
  url: "URL 抓取",
};

const ONBOARDING_KEY = "open11labs.files.onboarded";

/* -------------------------------------------------------------- controller -- */

export function useFilesController() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [usage, setUsage] = useState<{ totalBytes: number; count: number } | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "error" | "warn"; text: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [draftFolder, setDraftFolder] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(() => readOnboarded());
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboarded());

  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [a, f] = await Promise.all([assetsApi.list(), assetsApi.folders()]);
      setAssets(a.assets);
      setUsage(a.usage);
      setFolders(f);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法读取素材");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const origins = useMemo(
    () => ["all", ...new Set(assets.map((a) => a.origin))],
    [assets],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (origin !== "all" && a.origin !== origin) return false;
      if (!q) return true;
      return a.displayName.toLowerCase().includes(q);
    });
  }, [assets, query, origin]);

  const searched = query.trim().length > 0;
  const emptyStore = !loading && assets.length === 0 && folders.length === 0;

  /* -- upload ---------------------------------------------------------- */

  const send = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const created: string[] = [];
      const reused: string[] = [];
      const problems: string[] = [];

      for (const file of files) {
        // Pre-flight: the server rejects an unknown extension and caps a
        // single import, so both are reported here rather than after a
        // failed round trip. Same numbers as server/lib/assets.mjs.
        const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
        if (!ACCEPTED_EXT.includes(ext)) {
          problems.push(`${file.name}：不支持的格式 ${ext || "（无扩展名）"}`);
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          problems.push(`${file.name}：超过本地上限 ${formatBytes(MAX_UPLOAD_BYTES)}`);
          continue;
        }
        try {
          const res = await assetsApi.upload(file);
          // Identical bytes resolve to the existing asset. A repeated name
          // with different bytes becomes its own record, so an import never
          // overwrites what is already stored.
          (res.created ? created : reused).push(file.name);
        } catch (err) {
          problems.push(
            `${file.name}：${err instanceof ApiError ? err.message : "上传失败"}`,
          );
        }
      }

      const parts: string[] = [];
      if (created.length) parts.push(`新增 ${created.length} 个：${created.join("、")}`);
      if (reused.length) parts.push(`内容重复，复用 ${reused.length} 个已有素材`);
      if (problems.length) parts.push(problems.join("；"));

      setNotice({
        tone: problems.length && !created.length && !reused.length ? "error" : problems.length ? "warn" : "info",
        text: parts.join("。") || "没有可上传的文件。",
      });
      await reload();
    },
    [reload],
  );

  const pickFiles = useCallback(() => {
    fileInput.current?.click();
  }, []);

  /* -- new folder ------------------------------------------------------ */

  const startFolder = useCallback(() => {
    setNotice(null);
    setConfirmDelete(null);
    setDraftFolder(DEFAULT_FOLDER_NAME);
  }, []);

  const commitFolder = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setDraftFolder(null);
        setNotice({ tone: "error", text: "文件夹名称不能为空，草稿已丢弃，没有创建任何文件夹。" });
        return;
      }
      setDraftFolder(null);
      try {
        const folder = await assetsApi.createFolder(trimmed);
        setNotice({ tone: "info", text: `已创建文件夹「${folder.name}」。` });
        await reload();
      } catch (err) {
        setNotice({
          tone: "error",
          text: err instanceof ApiError ? err.message : "新建文件夹失败",
        });
      }
    },
    [reload],
  );

  const cancelFolder = useCallback(() => {
    setDraftFolder(null);
    setNotice({
      tone: "info",
      text: "已取消这一次命名，没有创建文件夹。已经存在的文件夹不受影响。",
    });
  }, []);

  /* -- delete ---------------------------------------------------------- */

  const remove = useCallback(
    async (id: string) => {
      setNotice(null);
      try {
        await assetsApi.remove(id);
        setConfirmDelete(null);
        setNotice({ tone: "info", text: "已删除素材及其本地文件。" });
        await reload();
      } catch (err) {
        setConfirmDelete(null);
        if (err instanceof ApiError && err.isConflict) {
          // The server answers a referenced asset with 409 and names the
          // projects, but it puts that list beside the error object rather
          // than inside it, so the shared client cannot see it. Rather than
          // print a count of zero, the referencing projects are resolved from
          // the project list the client can already read.
          const names = await referencingProjects(id);
          setNotice({
            tone: "error",
            text: names
              ? `无法删除：${err.message}（${names.length} 个工程：${names}）`
              : `无法删除：${err.message}`,
          });
          return;
        }
        setNotice({
          tone: "error",
          text: err instanceof ApiError ? err.message : "删除失败",
        });
      }
    },
    [reload],
  );

  /* -- onboarding ------------------------------------------------------ */

  const dismissOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    setOnboardingSeen(true);
    writeOnboarded();
  }, []);

  return {
    assets,
    usage,
    folders,
    view,
    setView,
    query,
    setQuery,
    origin,
    setOrigin,
    origins,
    filtered,
    loading,
    error,
    notice,
    setNotice,
    confirmDelete,
    setConfirmDelete,
    draftFolder,
    setDraftFolder,
    uploading,
    setUploading,
    dragOver,
    setDragOver,
    send,
    pickFiles,
    fileInput,
    startFolder,
    commitFolder,
    cancelFolder,
    remove,
    emptyStore,
    searched,
    onboardingOpen,
    onboardingSeen,
    dismissOnboarding,
  };
}

export type FilesController = ReturnType<typeof useFilesController>;

/** Upstream's own default, reused so the first row looks the same (070/071). */
const DEFAULT_FOLDER_NAME = "未命名文件夹";

/* Icon paths, named so the header, the onboarding card and the rows cannot
   drift apart. 24x24 grid, 1.5px stroke, drawn for this build. */
const FOLDER = "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z";
const FOLDER_PLUS = `${FOLDER}M12 11v5M9.5 13.5h5`;
const UPLOAD = "M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2";
const DOWNLOAD_IN =
  "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2";

/* -------------------------------------------------------------- header -- */

/** The two page-level actions, handed to PageFrame so they align with the h1. */
export function FilesHeaderActions({ ctl }: { ctl: FilesController }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={ctl.startFolder}
        className="focus-ring flex h-8 items-center gap-1.5 rounded-[10px] border border-gray-alpha-200 px-3 text-[13px] text-foreground transition-colors hover:bg-gray-alpha-50"
      >
        <Glyph d={FOLDER_PLUS} />
        新建文件夹
      </button>
      <button
        type="button"
        onClick={ctl.pickFiles}
        disabled={ctl.uploading}
        className="focus-ring flex h-8 items-center gap-1.5 rounded-[10px] bg-gray-950 px-3 text-[13px] text-background transition-opacity disabled:opacity-50"
      >
        <Glyph d={UPLOAD} />
        {ctl.uploading ? "上传中…" : "上传"}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- body -- */

export function FilesPageBody({ ctl }: { ctl: FilesController }) {
  return (
    <div className="stack gap-4">
      <AssetTabs />

      {ctl.error && (
        <Notice tone="error">
          <span>{ctl.error}</span>
          <button
            type="button"
            onClick={() => void ctl.setNotice(null)}
            className="focus-ring ml-2 underline"
          >
            知道了
          </button>
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">搜索素材</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
          >
            <path
              d="M11 18a7 7 0 100-14 7 7 0 000 14zm5.5-1.5L21 21"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            value={ctl.query}
            onChange={(e) => ctl.setQuery(e.target.value)}
            placeholder="开始输入以搜索"
            className="focus-ring h-9 w-full rounded-[10px] border border-gray-alpha-150 bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-subtle"
          />
        </label>

        <label className="flex items-center gap-1.5 text-[13px] text-secondary">
          来源
          <select
            value={ctl.origin}
            onChange={(e) => ctl.setOrigin(e.target.value)}
            className="focus-ring h-8 rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-[13px] text-foreground outline-none"
          >
            {ctl.origins.map((o) => (
              <option key={o} value={o}>
                {o === "all" ? "全部" : ORIGIN_LABEL[o] ?? o}
              </option>
            ))}
          </select>
        </label>

        <div
          role="group"
          aria-label="视图"
          className="flex items-center rounded-[10px] border border-gray-alpha-150 p-0.5"
        >
          <ViewToggle
            active={ctl.view === "list"}
            onClick={() => ctl.setView("list")}
            label="列表视图"
            icon="M4 6h16M4 12h16M4 18h16"
          />
          <ViewToggle
            active={ctl.view === "grid"}
            onClick={() => ctl.setView("grid")}
            label="网格视图"
            icon="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z"
          />
        </div>
      </div>

      {ctl.notice && <Notice tone={ctl.notice.tone}>{ctl.notice.text}</Notice>}

      {ctl.loading ? (
        <p className="py-10 text-center text-sm text-secondary">读取中…</p>
      ) : ctl.emptyStore ? (
        <Onboarding ctl={ctl} />
      ) : ctl.searched && ctl.filtered.length === 0 ? (
        <EmptyPanel
          title="没有匹配的素材"
          body={`素材库里有 ${ctl.assets.length} 个素材，但没有匹配「${ctl.query.trim()}」的名称。`}
        >
          <button
            type="button"
            onClick={() => {
              ctl.setQuery("");
              ctl.setOrigin("all");
            }}
            className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-3 text-[13px] hover:bg-gray-alpha-50"
          >
            清除搜索
          </button>
        </EmptyPanel>
      ) : ctl.view === "grid" ? (
        <GridList ctl={ctl} />
      ) : (
        <TableList ctl={ctl} />
      )}

      {ctl.draftFolder !== null && (
        <p className="text-xs text-secondary">
          草稿命名中：回车或点开别处即创建文件夹，Esc 取消这一次命名（不会删除已存在的文件夹）。
        </p>
      )}

      <p className="text-xs text-secondary">
        本地单用户存储，没有所有者筛选、成员管理或共享入口。素材由服务端管理，浏览器只通过受控 URL 访问，不会看到文件路径。
        <Link to="/local/settings/storage" className="ml-1 underline">
          存储设置
        </Link>
      </p>

      {/* One hidden input serves the header button and the drop target. */}
      <input
        ref={ctl.fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          ctl.setUploading(true);
          void ctl.send(files).finally(() => ctl.setUploading(false));
        }}
      />

      <DropLayer ctl={ctl} />

      {/*
        067 puts the welcome dialog over a list that already has rows, so
        showing it on an empty store too would stack two onboarding surfaces
        for the same first run. The empty store gets the inline card; the
        dialog is for a store that already holds files.
      */}
      {ctl.onboardingOpen && !ctl.emptyStore && <OnboardingDialog ctl={ctl} />}
    </div>
  );
}

/* ------------------------------------------------------------- fragments -- */

function AssetTabs() {
  return (
    <div className="flex items-center gap-6 border-b border-gray-alpha-150">
      <span className="-mb-px border-b-2 border-foreground px-1 pb-2.5 text-sm font-medium text-foreground">
        文件
      </span>
      <Link
        to="/app/files/brand-kits"
        className="focus-ring -mb-px px-1 pb-2.5 text-sm text-secondary transition-colors hover:text-foreground"
      >
        品牌套件
      </Link>
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring flex h-7 w-8 items-center justify-center rounded-[10px] transition-colors ${
        active
          ? "bg-gray-alpha-100 text-foreground shadow-natural-xs"
          : "text-subtle hover:text-foreground"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={icon}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function TableList({ ctl }: { ctl: FilesController }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">本地素材列表</caption>
      <colgroup>
        <col />
        <col className="w-[18%]" />
        <col className="w-[16%]" />
        <col className="w-[14%]" />
        <col className="w-[44px]" />
      </colgroup>
      <thead>
        <tr className="border-b border-gray-alpha-150 text-xs text-subtle">
          <th scope="col" className="py-2.5 text-left font-normal">名称</th>
          <th scope="col" className="py-2.5 text-left font-normal">已添加</th>
          <th scope="col" className="py-2.5 text-left font-normal">类型</th>
          <th scope="col" className="py-2.5 text-left font-normal">文件大小</th>
          <th scope="col" className="py-2.5"><span className="sr-only">操作</span></th>
        </tr>
      </thead>
      <tbody>
        {ctl.folders.map((f) => (
          <tr key={`f-${f.id}`} className="border-b border-gray-alpha-50">
            <td className="py-4 pr-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <RowIcon kind="folder" />
                <span className="truncate text-foreground">{f.name}</span>
              </span>
            </td>
            {/* The folder record carries no creation time, so the column says
                so rather than showing a date this build cannot know. */}
            <td className="py-4 text-secondary">—</td>
            <td className="py-4 text-secondary">文件夹</td>
            <td className="py-4 text-secondary">—</td>
            <td className="py-4" />
          </tr>
        ))}

        {ctl.filtered.map((a) => (
          <AssetRow key={a.id} ctl={ctl} asset={a} />
        ))}

        {ctl.draftFolder !== null && (
          <tr className="ring-2 ring-foreground rounded-[10px]">
            <td className="py-4 pr-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <RowIcon kind="folder" />
                <input
                  autoFocus
                  value={ctl.draftFolder}
                  aria-label="文件夹名称"
                  onChange={(e) => ctl.setDraftFolder(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void ctl.commitFolder(ctl.draftFolder ?? "");
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      ctl.cancelFolder();
                    }
                  }}
                  className="focus-ring min-w-0 flex-1 rounded-[10px] bg-transparent px-1 py-0.5 text-sm text-foreground outline-none"
                />
              </span>
            </td>
            <td className="py-4 text-secondary">—</td>
            <td className="py-4 text-secondary">文件夹</td>
            <td className="py-4 text-secondary">—</td>
            <td className="py-4" />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function AssetRow({ ctl, asset }: { ctl: FilesController; asset: AssetRecord }) {
  const confirming = ctl.confirmDelete === asset.id;
  return (
    <tr className="border-b border-gray-alpha-50">
      <td className="py-4 pr-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <RowIcon kind={iconKind(asset.mediaType)} />
          <span className="min-w-0">
            <span className="block truncate text-foreground">{asset.displayName}</span>
            {asset.licenseSource && (
              <span className="block truncate text-xs text-subtle">{asset.licenseSource}</span>
            )}
          </span>
        </span>
      </td>
      <td className="py-4 text-secondary">{formatAdded(asset.createdAt)}</td>
      <td className="py-4 text-secondary">{typeLabel(asset.mediaType)}</td>
      <td className="py-4 text-secondary">{formatBytes(asset.byteSize)}</td>
      <td className="py-4 text-right">
        {confirming ? (
          <span className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => void ctl.remove(asset.id)}
              className="focus-ring rounded-[10px] px-1.5 py-1 text-[13px] text-red-700 hover:bg-gray-alpha-50"
            >
              确认删除
            </button>
            <button
              type="button"
              onClick={() => ctl.setConfirmDelete(null)}
              className="focus-ring rounded-[10px] px-1.5 py-1 text-[13px] text-secondary hover:bg-gray-alpha-50"
            >
              取消
            </button>
          </span>
        ) : (
          <RowMenu ctl={ctl} asset={asset} />
        )}
      </td>
    </tr>
  );
}

/**
 * Per-row menu. The reference shows 更多操作 on every row (071), but the
 * local server exposes folder rename/move/delete nowhere, so a folder row
 * gets no menu rather than a panel of controls that cannot act. Asset rows
 * get the two operations the API really has.
 */
function RowMenu({ ctl, asset }: { ctl: FilesController; asset: AssetRecord }) {
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
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`focus-ring rounded-[10px] p-1.5 transition-colors hover:bg-gray-alpha-50 ${
          open ? "bg-gray-alpha-100 text-foreground" : "text-subtle"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="更多操作"
          className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-44 overflow-hidden rounded-xl border border-gray-alpha-150 bg-background py-1 shadow-lg"
        >
          <a
            role="menuitem"
            href={asset.url}
            download={asset.displayName}
            onClick={() => setOpen(false)}
            className="focus-ring block px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-gray-alpha-50"
          >
            下载
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              ctl.setConfirmDelete(asset.id);
            }}
            className="focus-ring block w-full px-3 py-1.5 text-left text-[13px] text-red-700 hover:bg-gray-alpha-50"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

function GridList({ ctl }: { ctl: FilesController }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ctl.folders.map((f) => (
        <article
          key={`f-${f.id}`}
          className="stack gap-2 rounded-xl border border-gray-alpha-150 p-3"
        >
          <span className="flex items-center gap-2">
            <RowIcon kind="folder" />
            <span className="truncate text-sm text-foreground">{f.name}</span>
          </span>
          <span className="text-xs text-secondary">文件夹</span>
        </article>
      ))}

      {ctl.filtered.map((a) => (
        <article
          key={a.id}
          className="stack gap-2 rounded-xl border border-gray-alpha-150 p-3"
        >
          {a.mediaType.startsWith("image/") && (
            <img
              src={a.url}
              alt=""
              className="h-28 w-full rounded-[10px] bg-gray-alpha-50 object-cover"
            />
          )}
          <span className="flex min-w-0 items-center gap-2">
            <RowIcon kind={iconKind(a.mediaType)} />
            <span className="truncate text-sm text-foreground">{a.displayName}</span>
          </span>
          <span className="text-xs text-secondary">
            {typeLabel(a.mediaType)} · {formatBytes(a.byteSize)} · {formatAdded(a.createdAt)}
          </span>
          {a.mediaType.startsWith("audio/") && (
            <audio controls preload="none" src={a.url} className="h-8 w-full" />
          )}
          <span className="flex justify-end">
            <a
              href={a.url}
              download={a.displayName}
              className="focus-ring rounded-[10px] px-2 py-1 text-[13px] text-secondary hover:bg-gray-alpha-50"
            >
              下载
            </a>
          </span>
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ onboarding -- */

/**
 * Empty store reads as onboarding, not as a broken list. Same two points the
 * reference gives, minus 与工作区共享, which SCOPE removes with the rest of the
 * workspace affordances. The illustration is a locally drawn stand-in — the
 * reference's is a product asset this build does not ship.
 */
function Onboarding({ ctl }: { ctl: FilesController }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-alpha-150">
      <Sketch />
      <div className="stack gap-4 p-6">
        <h2 className="font-waldenburg text-xl text-foreground">欢迎使用素材库</h2>
        <p className="text-sm text-secondary">整理和管理所有媒体文件的中心。</p>
        <FeatureList />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={ctl.startFolder}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-[10px] border border-gray-alpha-200 px-3 text-[13px] hover:bg-gray-alpha-50"
          >
            <Glyph d={FOLDER_PLUS} />
            新建文件夹
          </button>
          <button
            type="button"
            onClick={ctl.pickFiles}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-[10px] bg-gray-950 px-3 text-[13px] text-background"
          >
            <Glyph d={UPLOAD} />
            上传
          </button>
          <span className="text-xs text-subtle">
            素材库为空，生成工具的产物会自动存在这里。
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * 067 captures the welcome card as a `role=dialog` over an already-rendered
 * list, not as the list's own empty state. First run only; the dismissal is
 * remembered so a returning visit lands on the table (069).
 */
function OnboardingDialog({ ctl }: { ctl: FilesController }) {
  return (
    <Modal
      open={ctl.onboardingOpen}
      onClose={ctl.dismissOnboarding}
      title="欢迎使用素材库"
      width="max-w-[460px]"
      footer={
        <button
          type="button"
          onClick={ctl.dismissOnboarding}
          className="focus-ring h-9 w-full rounded-[10px] bg-gray-950 text-sm text-background"
        >
          开始使用
        </button>
      }
    >
      <div className="stack gap-4">
        <p className="text-sm text-secondary">整理和管理所有媒体文件的中心。</p>
        <FeatureList />
      </div>
    </Modal>
  );
}

function FeatureList() {
  return (
    <ul className="stack gap-3">
      <Feature
        icon={FOLDER}
        title="整理文件"
        body="创建文件夹，将音频、视频和图像集中整理在一起。"
      />
      <Feature
        icon={DOWNLOAD_IN}
        title="从任意位置拖动"
        body="将语音、音效和其他工具生成的内容直接拖入文件。"
      />
    </ul>
  );
}

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-foreground"
      >
        <path
          d={icon}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{title}</span>
        <span className="block text-xs leading-relaxed text-secondary">{body}</span>
      </span>
    </li>
  );
}

/** Local stand-in for the reference's onboarding illustration. */
function Sketch() {
  return (
    <div className="flex items-end gap-3 border-b border-gray-alpha-100 bg-gray-alpha-50 px-6 py-5">
      <div className="stack w-28 gap-2">
        <span className="h-14 rounded-[10px] bg-gray-alpha-150" />
        <span className="h-14 rounded-[10px] bg-gray-alpha-100" />
      </div>
      <div className="stack w-40 gap-2">
        <span className="h-8 rounded-[10px] bg-gray-alpha-150" />
        <span className="h-8 rounded-[10px] bg-gray-alpha-100" />
        <span className="h-8 rounded-[10px] bg-gray-alpha-100" />
      </div>
      <div className="h-20 w-20 rounded-[10px] bg-gray-alpha-150" />
    </div>
  );
}

function EmptyPanel({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="stack items-center gap-3 rounded-xl border border-dashed border-gray-alpha-200 px-6 py-12 text-center">
      <p className="text-sm text-foreground">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-secondary">{body}</p>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- drop -- */

/** The list itself is the drop target, as 067's 从任意位置拖动 describes. */
function DropLayer({ ctl }: { ctl: FilesController }) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        ctl.setDragOver(true);
      }}
      onDragLeave={() => ctl.setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        ctl.setDragOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        ctl.setUploading(true);
        void ctl.send(files).finally(() => ctl.setUploading(false));
      }}
      className={
        ctl.dragOver
          ? "rounded-xl border-2 border-dashed border-foreground p-2"
          : "pointer-events-none h-0 w-0 overflow-hidden"
      }
    >
      {ctl.dragOver && (
        <p className="py-8 text-center text-sm text-foreground">松开即可加入素材库</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- atoms -- */

function Glyph({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type IconKind = "folder" | "audio" | "image" | "video" | "text";

function RowIcon({ kind }: { kind: IconKind }) {
  const d = {
    folder: FOLDER,
    audio: "M4 9v6h4l5 4V5L8 9H4zm13.5-1.5a6 6 0 010 9M20 5a9 9 0 010 14",
    image: "M3 6h18v12H3zM3 16l5-5 4 4 3-3 6 6",
    video: "M3 6h12v12H3zM15 10l6-3v10l-6-3z",
    text: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  }[kind];
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-subtle"
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const cls = {
    info: "bg-gray-alpha-50 text-secondary",
    warn: "bg-amber-50 text-amber-800",
    error: "bg-red-50 text-red-700",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-[10px] px-3 py-2 text-sm ${cls}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- helpers -- */

function iconKind(mediaType: string): Exclude<IconKind, "folder"> {
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  return "text";
}

function typeLabel(mediaType: string): string {
  if (mediaType === "application/x-subrip" || mediaType === "text/vtt") return "字幕";
  const kind = iconKind(mediaType);
  return { audio: "音频", image: "图像", video: "视频", text: "文本", folder: "文件夹" }[kind];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Upstream renders 已添加 as e.g. `10月2日`. Anything unparseable says so. */
function formatAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function readOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    // A store that refuses reads is treated as first run; the welcome card
    // is dismissible either way.
    return false;
  }
}

function writeOnboarded() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* Nothing to do: the card simply reappears next visit. */
  }
}

/**
 * Which projects still hold this asset. Resolved from the project list
 * because the 409 body carries that list outside the error object, where the
 * shared API client drops it. Returns null when the lookup itself fails, so
 * the caller can show the server's own wording instead of a wrong count.
 */
async function referencingProjects(assetId: string): Promise<string[] | null> {
  try {
    const all = await projectsApi.list();
    return all.filter((p) => p.assetRefs.includes(assetId)).map((p) => p.name);
  } catch {
    return null;
  }
}
