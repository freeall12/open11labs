import { useCallback, useEffect, useState } from "react";
import { ApiError, assets, backup } from "@/lib/api";

/* ==========================================================================
   Local storage settings — local extension.

   Shows where the data lives in terms the user can act on (size, count,
   backup), without disclosing a filesystem layout the browser has no business
   knowing.
   ========================================================================== */

export function LocalStorageSettingsPageBody() {
  const [usage, setUsage] = useState<{ totalBytes: number; count: number } | null>(null);
  const [items, setItems] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    // The previous version showed "0 个 / 0 B" until the request resolved, so
    // a slow or unreachable server read as an empty disk. Loading has to be a
    // state of its own here, exactly as it is on the other two local pages.
    setLoading(true);
    try {
      const res = await assets.list();
      setUsage(res.usage);
      setItems(res.assets);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法读取存储信息");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function makeBackup() {
    setBusy(true);
    setBackupNote(null);
    try {
      const res = await backup.create();
      setBackupNote(
        `已生成备份，校验和 ${res.sha256.slice(0, 16)}…（不含密钥与研究资料）`,
      );
    } catch (err) {
      setBackupNote(err instanceof ApiError ? err.message : "备份失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-8">
      {error && (
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

      <section className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
        <h2 className="text-sm font-medium text-foreground">本机数据</h2>
        {loading ? (
          <p className="text-sm text-secondary">读取中…</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-secondary">已存素材</dt>
              <dd className="text-sm text-foreground">
                {usage ? `${usage.count} 个` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-secondary">占用空间</dt>
              <dd className="text-sm text-foreground">
                {usage ? formatBytes(usage.totalBytes) : "—"}
              </dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-secondary">
          素材与工程保存在本机数据目录，浏览器只通过受控接口访问，不会暴露文件路径。
        </p>
      </section>

      <section className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
        <h2 className="text-sm font-medium text-foreground">备份与恢复</h2>
        <p className="max-w-prose text-sm text-secondary">
          备份包含工程、素材清单与任务历史，并带有 schema 版本号。
          它不包含 API 密钥、原始研究资料或任何绝对路径。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={makeBackup}
          className="focus-ring h-9 w-fit rounded-[10px] bg-foreground px-3 text-sm text-background disabled:bg-gray-400"
        >
          {busy ? "生成中…" : "立即生成备份"}
        </button>
        {backupNote && <p className="text-sm text-secondary">{backupNote}</p>}
      </section>

      {items.length > 0 && (
        <section className="stack gap-2">
          <h2 className="text-sm font-medium text-foreground">素材</h2>
          <p className="text-sm text-secondary">共 {items.length} 项。</p>
        </section>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
