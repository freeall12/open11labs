import { useMemo, useState, type ReactNode } from "react";
import type { AssetRecord } from "@/lib/api";

/* ==========================================================================
   Local artifact list.

   History, favourites, saved tracks and generated media are all the same
   shape over the same local store: a searchable, playable list of files this
   machine produced. Building it once means every one of those routes gets
   working search, playback, download and a real empty state.

   Favouriting is a local mark on the asset, kept in localStorage. That is a
   local preference, not an upstream "save to library" call, and it is
   labelled as such — there is no cloud library in this build.
   ========================================================================== */

const FAV_KEY = "open11labs.favourites";

function readFavourites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeFavourites(ids: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  } catch {
    /* A browser with storage disabled still plays; it just forgets. */
  }
}

export function useFavourites() {
  const [ids, setIds] = useState<string[]>(() => readFavourites());

  const toggle = (id: string) => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeFavourites(next);
      return next;
    });
  };

  return { ids, toggle, has: (id: string) => ids.includes(id) };
}

export function ArtifactList({
  title,
  assets,
  empty,
  loading,
  onlyFavourites,
  error,
  onRetry,
  searchPlaceholder = "搜索产物…",
  columns,
  hideSearch,
  emptySlot,
  query,
  onQuery,
}: {
  title?: string;
  assets: AssetRecord[];
  empty: string;
  loading?: boolean;
  onlyFavourites?: boolean;
  /** A read that failed. Shown instead of the empty state, never as "no rows". */
  error?: string | null;
  /** Only rendered when `error` is set, so the failure is always actionable. */
  onRetry?: () => void;
  searchPlaceholder?: string;
  /**
   * Draw the reference's 描述 / 时长 / 下载 / 操作 header over the rows (090,
   * 093). The local store keeps no duration or download count, so those two
   * columns read 未记录 rather than showing a number we would have to invent.
   */
  columns?: boolean;
  /**
   * The caller draws the search field itself. The reference keeps 搜索生成内容
   * above an *empty* history (130, 131), and this list only draws its own field
   * once there is something to search, so a page that must match that has to
   * own the field.
   */
  hideSearch?: boolean;
  /** Replaces the dashed empty box, for a richer empty state. */
  emptySlot?: ReactNode;
  /** Controlled search term, for the same reason as `hideSearch`. */
  query?: string;
  onQuery?: (v: string) => void;
}) {
  const [own, setOwn] = useState("");
  const q = query ?? own;
  const setQ = onQuery ?? setOwn;
  const fav = useFavourites();

  const rows = useMemo(() => {
    const base = onlyFavourites ? assets.filter((a) => fav.ids.includes(a.id)) : assets;
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((a) => a.displayName.toLowerCase().includes(needle));
  }, [assets, q, onlyFavourites, fav.ids]);

  return (
    <section className="stack gap-4">
      {title && <h2 className="text-sm font-medium text-foreground">{title}</h2>}

      {!hideSearch && assets.length > 0 && (
        <label className="relative block">
          <span className="sr-only">搜索产物</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="focus-ring h-10 w-full rounded-xl border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>
      )}

      {error ? (
        /* A failed read is not an empty store: saying "nothing here" would be
           a second, quieter lie on top of the first. */
        <div className="stack gap-2 rounded-[10px] border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          <p>读取本地产物失败：{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="focus-ring w-fit rounded-[10px] border border-red-300 px-2.5 py-1 text-xs hover:bg-red-100"
            >
              重试
            </button>
          )}
        </div>
      ) : loading ? (
        <div className="stack gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-alpha-50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        (emptySlot ?? (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
            {onlyFavourites && assets.length > 0 ? "还没有收藏的条目。" : empty}
          </p>
        ))
      ) : (
        <>
          {columns && (
            <div className="flex items-center gap-3 border-b border-gray-alpha-150 pb-2 text-xs text-secondary">
              <span className="flex-1 pl-11">描述</span>
              <span className="w-16 text-right">时长</span>
              <span className="w-16 text-right">下载</span>
              <span className="w-24 text-right">操作</span>
            </div>
          )}
          <ul className="divide-y divide-gray-alpha-100">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <button
                  type="button"
                  onClick={() => fav.toggle(a.id)}
                  aria-pressed={fav.has(a.id)}
                  aria-label={fav.has(a.id) ? `取消收藏 ${a.displayName}` : `收藏 ${a.displayName}`}
                  className={`focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                    fav.has(a.id) ? "text-foreground" : "text-subtle hover:text-secondary"
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z"
                      fill={fav.has(a.id) ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{a.displayName}</p>
                  <p className="truncate text-xs text-subtle">
                    {formatBytes(a.byteSize)} · {a.mediaType}
                    {a.origin && a.origin !== "local" ? ` · 来源 ${a.origin}` : ""}
                  </p>
                </div>

                {a.mediaType.startsWith("audio/") && (
                  <audio controls preload="none" src={a.url} className="h-8 w-40 shrink-0" />
                )}
                {a.mediaType.startsWith("image/") && (
                  <img
                    src={a.url}
                    alt={a.displayName}
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                )}

                {columns && (
                  <>
                    <span className="w-16 shrink-0 text-right text-xs text-subtle">未记录</span>
                    <span className="w-16 shrink-0 text-right text-xs text-subtle">未记录</span>
                  </>
                )}

                <a
                  href={a.url}
                  download={a.displayName}
                  className={`focus-ring shrink-0 rounded-[10px] text-xs ${
                    columns
                      ? "w-24 text-right text-secondary hover:text-foreground"
                      : "border border-gray-alpha-200 px-2.5 py-1 hover:bg-gray-alpha-50"
                  }`}
                >
                  下载
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "未知大小";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
