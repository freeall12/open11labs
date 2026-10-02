import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  type AssetRecord,
} from "@/lib/api";

/* ==========================================================================
   Local assets.

   SCOPE.md keeps local folders, file CRUD, search and view switching, and
   removes the cloud account owner filter, workspace sharing, member
   management and permission invites. There is therefore no owner column, no
   member list and no share button anywhere on this page — not hidden, absent.

   Deleting is reference-aware: an asset a project still uses reports a
   conflict listing the projects, rather than breaking them.
   ========================================================================== */

type View = "list" | "grid";

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export function FilesPage() {
  const [items, setItems] = useState<AssetRecord[]>([]);
  const [usage, setUsage] = useState<{ totalBytes: number; count: number } | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [upload, setUpload] = useState<File[]>([]);

  const reload = useCallback(async () => {
    try {
      const [a, f] = await Promise.all([assetsApi.list(), assetsApi.folders()]);
      setItems(a.assets);
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
    () => ["all", ...new Set(items.map((i) => i.origin))],
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((a) => {
      if (origin !== "all" && a.origin !== origin) return false;
      if (!q) return true;
      return a.displayName.toLowerCase().includes(q);
    });
  }, [items, query, origin]);

  async function uploadFiles() {
    if (upload.length === 0) return;
    setNotice(null);
    let created = 0;
    let reused = 0;
    for (const file of upload) {
      try {
        const res = await assetsApi.upload(file);
        if (res.created) created += 1;
        else reused += 1;
      } catch (err) {
        setNotice(`${file.name}：${err instanceof ApiError ? err.message : "上传失败"}`);
      }
    }
    // Identical bytes resolve to the existing asset rather than a duplicate.
    setNotice(`新增 ${created} 个，复用 ${reused} 个相同内容的素材。`);
    setUpload([]);
    await reload();
  }

  async function remove(id: string) {
    setNotice(null);
    try {
      await assetsApi.remove(id);
      setPendingDelete(null);
      setNotice("已删除。");
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) {
        const refs = (err.details.referencedBy ?? []) as { name: string }[];
        setNotice(
          `无法删除：仍被 ${refs.length} 个工程引用（${refs
            .map((r) => r.name)
            .join("、")}）。请先在这些工程中移除该素材。`,
        );
        setPendingDelete(null);
        return;
      }
      setNotice(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  async function addFolder() {
    if (!newFolder.trim()) return;
    try {
      await assetsApi.createFolder(newFolder.trim());
      setNewFolder("");
      await reload();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "新建文件夹失败");
    }
  }

  return (
    <div className="stack gap-6">
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">搜索</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称搜索"
            className="focus-ring h-9 w-56 rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>

        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">来源</span>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            {origins.map((o) => (
              <option key={o} value={o}>
                {o === "all" ? "全部" : o}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-1 rounded-xl bg-gray-alpha-50 p-0.5">
          {(
            [
              ["list", "列表视图"],
              ["grid", "网格视图"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`focus-ring h-8 rounded-[10px] px-3 text-sm transition-colors ${
                view === v
                  ? "bg-background text-foreground shadow-natural-xs"
                  : "text-secondary hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="focus-ring h-9 cursor-pointer rounded-[10px] border border-gray-alpha-200 px-3 text-sm leading-9 hover:bg-gray-alpha-50">
          选择文件
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => setUpload(Array.from(e.target.files ?? []))}
          />
        </label>
        <button
          type="button"
          disabled={upload.length === 0}
          onClick={uploadFiles}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-3 text-sm text-background disabled:bg-gray-400"
        >
          上传（{upload.length}）
        </button>

        <span className="mx-2 h-5 w-px bg-gray-alpha-200" />

        <input
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          placeholder="新文件夹名称"
          className="focus-ring h-9 w-44 rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
        <button
          type="button"
          onClick={addFolder}
          className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
        >
          新建文件夹
        </button>
      </div>

      {notice && <Notice tone="info">{notice}</Notice>}

      {folders.length > 0 && (
        <section className="stack gap-2">
          <h2 className="text-sm font-medium text-foreground">文件夹</h2>
          <ul className="flex flex-wrap gap-2">
            {folders.map((f) => (
              <li
                key={f.id}
                className="rounded-[10px] border border-gray-alpha-150 px-3 py-1.5 text-sm text-foreground"
              >
                {f.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack gap-3">
        <div className="flex items-center justify-between text-sm">
          <h2 className="font-medium text-foreground">素材</h2>
          {usage && (
            <span className="text-secondary">
              {usage.count} 个 · {formatBytes(usage.totalBytes)}
            </span>
          )}
        </div>

        {loading && <p className="text-sm text-secondary">读取中…</p>}

        {!loading && filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
            {items.length === 0
              ? "素材库为空。生成的产物会自动存在这里。"
              : "没有匹配的素材。"}
          </p>
        )}

        <ul
          className={
            view === "grid"
              ? "grid gap-3 sm:grid-cols-3 lg:grid-cols-4"
              : "divide-y divide-gray-alpha-100 rounded-xl border border-gray-alpha-150"
          }
        >
          {filtered.map((a) => (
            <li
              key={a.id}
              className={
                view === "grid"
                  ? "stack gap-2 rounded-xl border border-gray-alpha-150 p-3"
                  : "flex items-center gap-3 p-3"
              }
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {a.displayName}
                </p>
                <p className="truncate text-xs text-secondary">
                  {a.mediaType} · {formatBytes(a.byteSize)} · 来源 {a.origin}
                </p>
                {a.licenseSource && (
                  <p className="truncate text-xs text-subtle">{a.licenseSource}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={a.url}
                  download={a.displayName}
                  className="focus-ring rounded-[10px] px-2 py-1 text-sm text-secondary hover:bg-gray-alpha-100"
                >
                  下载
                </a>
                {view === "grid" && a.mediaType.startsWith("audio/") && (
                  <audio controls preload="none" src={a.url} className="h-7 w-24" />
                )}
                {view === "grid" && a.mediaType.startsWith("image/") && (
                  <img src={a.url} alt="" className="h-12 w-full rounded" />
                )}
                <button
                  type="button"
                  onClick={() =>
                    pendingDelete === a.id ? void remove(a.id) : setPendingDelete(a.id)
                  }
                  className="focus-ring rounded-[10px] px-2 py-1 text-sm text-red-700 hover:bg-red-50"
                >
                  {pendingDelete === a.id ? "确认删除" : "删除"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-secondary">
        本地单用户存储，没有所有者筛选、成员管理或共享入口。
        素材由服务端管理，浏览器只通过受控 URL 访问，不会看到文件路径。
        <Link to="/local/settings/storage" className="ml-1 underline">
          存储设置
        </Link>
      </p>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
}) {
  const cls =
    tone === "error"
      ? "bg-red-50 text-red-700"
      : "bg-gray-alpha-50 text-secondary";
  return <div className={`rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
