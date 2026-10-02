import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";

/* ==========================================================================
   Dubbing.

   Two facts drive the design, both from docs/pages/voice.md:
     - v2 (Alpha) and v1 support different language counts. The site itself
       disagrees across views (104 vs 29). Neither number is treated as
       authoritative here: the page asks the user to pick a model version and
       says plainly that the language list is unverified.
     - the v1 editor was never observed, so no editor is offered. An unobserved
       editor drawn from imagination would be a fake feature.

   Dubbing is a two-step project flow: create, then poll until finished.
   ========================================================================== */

const VERSIONS = [
  {
    id: "v2",
    label: "v2（Alpha）",
    // Reported language counts, kept separate and labelled as unverified.
    reportedLanguages: 104,
    unverified: true,
  },
  {
    id: "v1",
    label: "v1",
    reportedLanguages: 29,
    unverified: true,
  },
];

export function DubbingPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState(VERSIONS[0].id);
  const [language, setLanguage] = useState("");
  const [ackCost, setAckCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await providersApi.list();
        setProvider(list.find((p) => p.validationState === "available") ?? list[0] ?? null);
      } catch {
        setProvider(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stop = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => stop, [stop]);

  const v = VERSIONS.find((x) => x.id === version)!;

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地 Provider…";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (!file) return "请先上传源音频";
    if (!language) return "请选择目标语言";
    return null;
  }, [loading, provider, file, language]);

  const poll = useCallback(async (id: string, attempt = 0) => {
    const out = await jobsApi.poll(id);
    setJob(out.job);
    if (out.asset) return;
    if (out.stillRunning && attempt < 60) {
      // Dubbing is slower than image generation; back off further.
      timer.current = setTimeout(() => void poll(id, attempt + 1), 4000 + attempt * 500);
      return;
    }
    if (out.reason) setNote(out.reason);
  }, []);

  async function generate() {
    if (!provider || !file) return;
    setBusy(true);
    setNote(null);
    try {
      const { asset } = await assetsApi.upload(file);
      const created = await jobsApi.create({
        intentId: `dub:${provider.id}:${version}:${language}:${asset.id}`,
        type: "dubbing",
        providerId: provider.id,
        modelId: version,
        credentialRef: provider.id,
        input: {
          assetId: asset.id,
          fileName: asset.displayName,
          targetLanguage: language,
          modelId: version,
          acknowledgeUnknownCost: ackCost,
        },
      });
      setJob(created.job);

      if (!created.created) {
        setNote("这段音频在相同设置下已经处理过，已复用对应任务，不会重复计费。");
        return;
      }

      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      if (out.asset) return;
      if (out.reason && !/pending|running|unknown/i.test(out.reason)) {
        setNote(out.reason);
        return;
      }
      void poll(out.job.id);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-8">
      {!loading && !provider && (
        <Notice tone="warn">
          尚未配置 Provider。配音会调用你的 Provider 产生费用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      <Notice tone="info">
        配音是两步流程：先创建项目，再轮询直到生成完成。关闭页面不会丢失任务，
        重启后会用远端项目 ID 继续查询。
      </Notice>

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">源音频</h2>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/*"
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="focus-ring h-9 w-fit rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
        >
          上传音频或视频
        </button>

        {file && (
          <div className="flex items-center gap-3 rounded-xl border border-gray-alpha-150 p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{file.name}</span>
              <span className="text-xs text-secondary">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </span>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="focus-ring rounded-[10px] px-2 py-1 text-sm text-secondary hover:bg-gray-alpha-100"
            >
              移除
            </button>
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">模型版本</span>
          <select
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            {VERSIONS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>

        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">目标语言</span>
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="语言代码，例如 en"
            className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <Notice tone="warn">
        {v.label} 报告支持约 {v.reportedLanguages} 种语言，但**这个数字未经核验**，
        且 v1 与 v2 的支持范围不同。本地不内置语言清单，也不替你断言某个语言可用——
        提交后由 Provider 判定，不支持会返回明确错误。
      </Notice>

      <Notice tone="warn">
        v1 的编辑器未采，因此本版**不提供**编辑器。没有观察过的界面画出来就是假的。
      </Notice>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ackCost}
          onChange={(e) => setAckCost(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-secondary">
          我了解这次配音会产生费用、金额未知，并同意把源文件发送到{" "}
          {provider?.baseURL ?? "Provider"}。
        </span>
      </label>

      {note && <Notice tone="error">{note}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!!blocked || busy || !ackCost}
          onClick={generate}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background hover:bg-gray-800 disabled:bg-gray-400"
        >
          {busy ? "提交中…" : "开始配音"}
        </button>
        {blocked && <span className="text-xs text-secondary">{blocked}</span>}
      </div>

      {job && (
        <section className="stack gap-2 rounded-xl border border-gray-alpha-150 p-4">
          <h2 className="text-sm font-medium text-foreground">任务 {job.status}</h2>
          <p className="text-xs text-secondary">
            本地任务 <span className="font-mono">{job.id.slice(0, 8)}</span>
            {job.requestId && (
              <>
                　远端项目 <span className="font-mono">{job.requestId}</span>
              </>
            )}
          </p>
          {job.error && (
            <p className="text-xs text-amber-700">
              {job.error.safeMessage}（提交确定性：{job.error.submissionCertainty}）
            </p>
          )}
          {job.outputAssetIds.length > 0 && (
            <p className="text-xs text-secondary">已生成产物，可在素材库查看与下载。</p>
          )}
        </section>
      )}
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "warn" | "info";
  children: React.ReactNode;
}) {
  const cls = {
    error: "bg-red-50 text-red-700",
    warn: "bg-amber-50 text-amber-800",
    info: "bg-gray-alpha-50 text-secondary",
  }[tone];
  return <div className={`rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
