import { useCallback, useEffect, useState } from "react";
import { ApiError, providers, type ProviderRecord } from "@/lib/api";

/* ==========================================================================
   Provider and key settings — local extension, not an upstream replica.

   The key field is write-only by design: the server never returns it, so
   rotating means supplying a new one. Nothing here is stored in
   localStorage, a URL, or component state beyond the submit call.
   ========================================================================== */

const STATE_LABEL: Record<ProviderRecord["validationState"], string> = {
  unconfigured: "未配置",
  unverified: "未验证",
  validating: "验证中",
  available: "可用",
  auth_failed: "认证失败",
  insufficient_scope: "权限不足",
  network_error: "网络错误",
  removed: "已移除",
};

const STATE_TONE: Record<ProviderRecord["validationState"], string> = {
  unconfigured: "text-secondary",
  unverified: "text-secondary",
  validating: "text-secondary",
  available: "text-emerald-700",
  auth_failed: "text-red-700",
  insufficient_scope: "text-amber-700",
  network_error: "text-amber-700",
  removed: "text-secondary",
};

export function ProviderSettingsPage() {
  const [items, setItems] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await providers.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "无法读取本地密钥");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="stack gap-8">
      <p className="max-w-prose text-sm text-secondary">
        在此录入你自己已有的 API 密钥。密钥只写入本机服务端，页面与接口都不会回显完整密钥。
        验证只做一次免费的能力查询，不会调用任何生成功能。
      </p>

      <AddProvider onAdded={reload} />

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">已保存的密钥</h2>

        {loading && <p className="text-sm text-secondary">读取中…</p>}
        {loadError && <ErrorNote text={loadError} />}

        {!loading && !loadError && items.length === 0 && (
          <EmptyState />
        )}

        {items.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            busy={busy === p.id}
            onChanged={reload}
            onBusy={(v) => setBusy(v ? p.id : null)}
          />
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ add -- */

function AddProvider({ onAdded }: { onAdded: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [baseURL, setBaseURL] = useState("https://api.elevenlabs.io");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!secret) {
      setError("请输入 API 密钥");
      return;
    }
    setBusy(true);
    try {
      await providers.add({ type: "elevenlabs", displayName, baseURL, secret });
      // Clear the field immediately: the key must not linger in the DOM.
      setSecret("");
      setDisplayName("");
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
      <h2 className="text-sm font-medium text-foreground">添加密钥</h2>

      <label className="stack gap-1.5 text-sm">
        <span className="text-secondary">显示名称</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例如：我的 ElevenLabs"
          className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
      </label>

      <label className="stack gap-1.5 text-sm">
        <span className="text-secondary">Provider 地址</span>
        <input
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none"
        />
        <span className="text-xs text-subtle">
          仅允许已登记的官方地址；自托管地址需在服务端显式登记。
        </span>
      </label>

      <label className="stack gap-1.5 text-sm">
        <span className="text-secondary">API 密钥</span>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none"
        />
        <span className="text-xs text-subtle">
          只写入本机服务端，保存后无法再读回。
        </span>
      </label>

      {error && <ErrorNote text={error} />}

      <button
        type="submit"
        disabled={busy}
        className="focus-ring h-9 rounded-[10px] bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-gray-800 disabled:bg-gray-400"
      >
        {busy ? "保存中…" : "保存并写入服务端"}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ row -- */

function ProviderRow({
  provider,
  busy,
  onChanged,
  onBusy,
}: {
  provider: ProviderRecord;
  busy: boolean;
  onChanged: () => void;
  onBusy: (v: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [rotateTo, setRotateTo] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    onBusy(true);
    try {
      await fn();
      setRotateTo("");
      setConfirming(false);
      onChanged();
      if (ok) setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {provider.displayName}
          </p>
          <p className="truncate font-mono text-xs text-subtle">{provider.maskedSecret}</p>
        </div>
        <span className={`shrink-0 text-xs font-medium ${STATE_TONE[provider.validationState]}`}>
          {STATE_LABEL[provider.validationState]}
        </span>
      </div>

      {provider.lastError && (
        <p className="text-xs text-amber-700">{provider.lastError}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => providers.validate(provider.id))}
          className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 bg-background px-2.5 text-sm transition-colors hover:bg-gray-alpha-50 disabled:opacity-50"
        >
          {busy ? "验证中…" : "验证连接"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming((v) => !v)}
          className="focus-ring h-8 rounded-[10px] px-2.5 text-sm text-secondary transition-colors hover:bg-gray-alpha-100"
        >
          轮换密钥
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            confirming
              ? run(() => providers.remove(provider.id))
              : setConfirming(true)
          }
          className="focus-ring h-8 rounded-[10px] px-2.5 text-sm text-red-700 transition-colors hover:bg-red-50"
        >
          {confirming ? "确认删除？再点一次" : "删除"}
        </button>
      </div>

      {confirming && (
        <p className="text-xs text-secondary">
          删除后本机不再保留该密钥。已提交到供应商的任务不会被撤回，已生成的资产不受影响。
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          type="password"
          value={rotateTo}
          onChange={(e) => setRotateTo(e.target.value)}
          placeholder="新密钥"
          autoComplete="off"
          className="focus-ring h-8 rounded-lg border border-gray-alpha-150 bg-background px-2.5 font-mono text-xs outline-none"
        />
        <button
          type="button"
          disabled={busy || !rotateTo}
          onClick={() => run(() => providers.rotate(provider.id, rotateTo))}
          className="focus-ring h-8 rounded-[10px] bg-foreground px-2.5 text-sm text-background disabled:bg-gray-400"
        >
          写入新密钥
        </button>
      </div>

      {error && <ErrorNote text={error} />}
    </div>
  );
}

/* --------------------------------------------------------------- shared -- */

function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {text}
    </p>
  );
}

function EmptyState() {
  return (
    <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-8 text-center text-sm text-secondary">
      还没有配置任何 Provider。没有密钥时仍可浏览和编辑本地项目，但真实生成会被禁用。
    </p>
  );
}
