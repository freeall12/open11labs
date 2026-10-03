import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  providers as providersApi,
  type ProviderRecord,
  type ProviderSpec,
} from "@/lib/api";

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
      setItems(await providersApi.list());
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
        {loadError && (
          <div className="stack items-start gap-2 rounded-xl border border-gray-alpha-200 p-4">
            <ErrorNote text={loadError} />
            {/* A failure with no way back is a dead end; the reload path is the
                one control that has to be present in the error state itself. */}
            <button
              type="button"
              onClick={() => void reload()}
              className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm transition-colors hover:bg-gray-alpha-50"
            >
              重试
            </button>
          </div>
        )}

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

/**
 * The platform list comes from the server registry rather than a copy here.
 * A hardcoded table would drift from what the server actually accepts, and
 * the failure would only show up at save time.
 */
const TASK_LABELS: Record<string, string> = {
  tts: "文本转语音",
  stt: "语音转文本",
  sts: "变声",
  isolation: "人声分离",
  sfx: "音效",
  image: "图像",
  video: "视频",
  chat: "对话",
};

function AddProvider({ onAdded }: { onAdded: () => void }) {
  const [specs, setSpecs] = useState<ProviderSpec[]>([]);
  const [kindId, setKindId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [secret, setSecret] = useState("");
  const [selfHosted, setSelfHosted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  /* Catalog and submit fail for different reasons and are recoverable in
     different ways, so they cannot share one message slot. */
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * The platform catalog is a second, independent request from the saved-key
   * list above. Retrying only the list left this form permanently dead — no
   * chips, a disabled submit, and nothing to press — so it needs its own
   * loading flag and its own retry.
   */
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const list = await providersApi.catalog();
      setSpecs(list);
      setCatalogError(null);
      setKindId((current) => {
        // Keep the current choice across a retry when it survived, otherwise
        // fall back to the first platform.
        if (current && list.some((k) => k.id === current)) return current;
        return list[0]?.id ?? "";
      });
    } catch (err) {
      setCatalogError(err instanceof ApiError ? err.message : "无法读取可用平台列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const kind = specs.find((k) => k.id === kindId) ?? null;

  // A retry that lands on a different platform must not leave the old platform's
  // base URL behind, or the form would submit an address the server rejects.
  useEffect(() => {
    if (!kind) return;
    setBaseURL((current) =>
      current === "" || specs.some((k) => k.defaultBaseURL === current)
        ? kind.defaultBaseURL
        : current,
    );
  }, [kind, specs]);

  function pickKind(id: string) {
    const next = specs.find((k) => k.id === id);
    setKindId(id);
    setBaseURL(next?.defaultBaseURL ?? "");
    setSecret("");
    setSelfHosted(next?.requiresSelfHosted === true);
    setCatalogError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!kind) {
      setSubmitError("请先选择平台");
      return;
    }
    if (!secret) {
      setSubmitError("请输入 API 密钥");
      return;
    }
    if (kind.requiresSelfHosted && !selfHosted) {
      setSubmitError("该平台需要显式确认自托管");
      return;
    }
    setBusy(true);
    try {
      await providersApi.add({
        type: kind.id,
        displayName,
        baseURL,
        secret,
        selfHosted: selfHosted && kind.requiresSelfHosted,
      });
      // Clear the field immediately: the key must not linger in the DOM.
      setSecret("");
      setDisplayName("");
      onAdded();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
      <h2 className="text-sm font-medium text-foreground">添加 Provider</h2>

      {loading && <p className="text-sm text-secondary">读取可用平台列表…</p>}

      {/* Catalog failure is its own dead end, separate from the saved-key list
          above, so it carries its own retry. */}
      {!loading && specs.length === 0 && (
        <div className="stack items-start gap-2">
          <ErrorNote text={catalogError ?? "可用平台列表为空"} />
          <button
            type="button"
            onClick={() => void loadCatalog()}
            className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm transition-colors hover:bg-gray-alpha-50"
          >
            重试
          </button>
        </div>
      )}

      {specs.length > 0 && (
        <fieldset className="stack gap-2">
          <legend className="text-sm text-secondary">平台</legend>
          <div className="flex flex-wrap gap-2">
            {specs.map((k) => (
              <label
                key={k.id}
                className={`focus-ring cursor-pointer rounded-[10px] border px-2.5 py-1.5 text-sm transition-colors ${
                  kindId === k.id
                    ? "border-foreground bg-gray-alpha-100 text-foreground"
                    : "border-gray-alpha-200 text-secondary hover:bg-gray-alpha-50"
                }`}
              >
                <input
                  type="radio"
                  name="provider-kind"
                  value={k.id}
                  checked={kindId === k.id}
                  onChange={() => pickKind(k.id)}
                  className="sr-only"
                />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {kind && (
        <p className="text-xs text-subtle">
          该平台已接入：
          {kind.taskTypes.map((t) => TASK_LABELS[t] ?? t).join("、") || "（尚无）"}。
          {kind.chat ? "可用于多轮创作对话。" : "不提供对话接口。"}
          {kind.docs && (
            <>
              {" "}
              <a href={kind.docs} target="_blank" rel="noreferrer" className="underline">
                官方文档
              </a>
            </>
          )}
        </p>
      )}

      <label className="stack gap-1.5 text-sm">
        <span className="text-secondary">显示名称</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={kind?.label ?? "我的 Provider"}
          className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
      </label>

      <label className="stack gap-1.5 text-sm">
        <span className="text-secondary">Base URL</span>
        <input
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder={kind?.defaultBaseURL}
          className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none placeholder:text-subtle"
        />
        <span className="text-xs text-subtle">
          只接受该平台登记的域名。自托管地址需勾选下方选项。
        </span>
      </label>

      <label className="stack gap-1.5 text-sm">
        <span className="text-secondary">API 密钥</span>
        <input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={kind?.keyPlaceholder ?? "sk-…"}
          className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none placeholder:text-subtle"
        />
        <span className="text-xs text-subtle">只写入本机服务端，保存后无法再读回。</span>
      </label>

      {kind?.requiresSelfHosted && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={selfHosted}
            onChange={(e) => setSelfHosted(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-secondary">
            这是我自己部署的服务（自托管）。未勾选时该平台地址会被拒绝。
          </span>
        </label>
      )}

      {submitError && <ErrorNote text={submitError} />}

      <button
        type="submit"
        disabled={busy || !kind || !secret}
        className="focus-ring h-9 w-fit rounded-[10px] bg-foreground px-4 text-sm font-medium text-background hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {busy ? "保存中…" : "保存密钥"}
      </button>
    </form>
  );
}

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
            <span className="ml-2 font-mono text-xs font-normal text-subtle">
              {provider.type}
            </span>
            {provider.selfHosted && (
              <span className="ml-2 rounded bg-gray-alpha-100 px-1.5 py-0.5 text-xs text-secondary">
                自托管
              </span>
            )}
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
          onClick={() => run(() => providersApi.validate(provider.id))}
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
              ? run(() => providersApi.remove(provider.id))
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
          onClick={() => run(() => providersApi.rotate(provider.id, rotateTo))}
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
