import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  ApiError,
  jobs as jobsApi,
  providers as providersApi,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";

/* ==========================================================================
   Image, video and lipsync.

   These are the asynchronous capabilities: the provider answers with a remote
   id and the result is polled. That shapes the whole UI — there is a real
   "in flight" period, and the honest states during it are more interesting
   than the success state.

   The three modes come from the URL (`?modality=`), matching the upstream
   route shape, so a deep link lands on the right mode.
   ========================================================================== */

const MODES = [
  { id: "image", label: "图像", taskType: "image_generation" },
  { id: "video", label: "视频", taskType: "video_generation" },
  { id: "lipsync", label: "口型同步", taskType: "video_generation" },
] as const;

type ModeId = (typeof MODES)[number]["id"];

/** Model ids below come from the docs table, not from a verified response. */
const MODELS: Record<ModeId, { id: string; label: string; needsApproval: boolean }[]> = {
  image: [
    { id: "seedream", label: "Seedream", needsApproval: false },
    { id: "flux", label: "Flux", needsApproval: false },
    // Some ByteDance models ship disabled and need account approval.
    { id: "seedream_4", label: "Seedream 4（需审批）", needsApproval: true },
  ],
  video: [
    { id: "kling_v2", label: "Kling v2", needsApproval: false },
    { id: "veo_3", label: "Veo 3", needsApproval: false },
  ],
  lipsync: [{ id: "lipsync", label: "口型同步", needsApproval: false }],
};

export function ImageVideoPage() {
  const [params, setParams] = useSearchParams();
  const modeParam = params.get("modality") as ModeId | null;
  const mode: ModeId = MODES.some((m) => m.id === modeParam) ? (modeParam as ModeId) : "image";
  const modeDef = MODES.find((m) => m.id === mode)!;

  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(MODELS.image[0].id);
  const [ackCost, setAckCost] = useState(false);

  const [job, setJob] = useState<JobRecord | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const models = MODELS[mode];
  const model = models.find((m) => m.id === modelId) ?? models[0];

  useEffect(() => {
    (async () => {
      try {
        const list = await providersApi.list();
        const p = list.find((x) => x.validationState === "available") ?? list[0] ?? null;
        setProvider(p);
      } catch {
        setProvider(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Switching mode resets the model if it is not valid for the new mode, but
  // keeps the prompt: a draft is not thrown away by a mode change.
  useEffect(() => {
    if (!models.some((m) => m.id === modelId)) setModelId(models[0].id);
  }, [mode, models, modelId]);

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地 Provider…";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (!prompt.trim()) return "请输入描述";
    if (model.needsApproval) {
      return "该模型在你的 Provider 账户中默认禁用，需要单独审批；本地无法代为申请";
    }
    return null;
  }, [loading, provider, prompt, model]);

  const intentId = useMemo(
    () => `${mode}:${provider?.id ?? "none"}:${model.id}:${prompt.trim().slice(0, 64)}`,
    [mode, provider?.id, model.id, prompt],
  );

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    async (id: string, attempt = 0) => {
      const out = await jobsApi.poll(id);
      setJob(out.job);
      if (out.asset) {
        setResult({ url: out.asset.url, name: out.asset.displayName });
        return;
      }
      if (out.stillRunning && attempt < 40) {
        // Back off gently. Polling a paid provider should not be a hot loop.
        timer.current = setTimeout(() => void poll(id, attempt + 1), 2000 + attempt * 250);
        return;
      }
      if (out.reason) setNote(out.reason);
    },
    [],
  );

  async function generate() {
    if (!provider) return;
    setBusy(true);
    setNote(null);
    setResult(null);
    try {
      const created = await jobsApi.create({
        intentId,
        type: modeDef.taskType,
        providerId: provider.id,
        modelId: model.id,
        credentialRef: provider.id,
        input: { prompt: prompt.trim(), acknowledgeUnknownCost: ackCost },
      });
      setJob(created.job);

      if (!created.created) {
        setNote("这次提交与上一次完全相同，已复用同一个任务，不会重复计费。");
        return;
      }

      const run = await jobsApi.run(created.job.id);
      setJob(run.job);
      if (run.asset) {
        setResult({ url: run.asset.url, name: run.asset.displayName });
        return;
      }
      // Asynchronous: it is running remotely now. Start polling.
      void poll(run.job.id);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  const running = job?.status === "running" || job?.status === "submitting";

  return (
    <div className="stack gap-8">
      {/* mode switch mirrors the upstream query shape */}
      <div role="tablist" aria-label="模态" className="inline-flex gap-1 rounded-xl bg-gray-alpha-50 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            type="button"
            aria-selected={m.id === mode}
            onClick={() => setParams({ modality: m.id })}
            className={`focus-ring h-8 rounded-[10px] px-3 text-sm transition-colors ${
              m.id === mode
                ? "bg-background text-foreground shadow-natural-xs"
                : "text-secondary hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {!loading && !provider && (
        <Notice tone="warn">
          尚未配置 Provider。图像与视频都会调用你的 Provider 产生费用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      {provider && (
        <Notice tone="info">
          模型列表与可用性尚未经过真实 API 核验，能力一律标为「未验证」。
          部分模型在你的 Provider 账户中可能需要单独审批。
        </Notice>
      )}

      <section className="stack gap-3">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">描述</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="描述你想生成的画面…"
            className="focus-ring w-full resize-y rounded-xl border border-gray-alpha-150 bg-background p-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>
      </section>

      <label className="stack gap-1.5 text-sm sm:max-w-sm">
        <span className="text-secondary">模型</span>
        <select
          value={model.id}
          onChange={(e) => setModelId(e.target.value)}
          className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {model.needsApproval && (
        <Notice tone="warn">
          该模型在你的 Provider 账户中默认禁用，需要单独审批。本地应用不会也无法代为申请。
        </Notice>
      )}

      <Notice tone="warn">
        图像/视频生成可能计费，且多数模型按分辨率或时长计。本地无法获知具体金额，
        提交后一律记为「费用未知」。
      </Notice>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ackCost}
          onChange={(e) => setAckCost(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-secondary">
          我了解这次提交会产生费用、金额未知，并同意向 {provider?.baseURL ?? "Provider"} 发送上述描述。
        </span>
      </label>

      {note && <Notice tone="error">{note}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!!blocked || busy || !ackCost || running}
          onClick={generate}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800 disabled:bg-gray-400"
        >
          {busy ? "提交中…" : running ? "生成中…" : `生成${modeDef.label}`}
        </button>
        {blocked && <span className="text-xs text-secondary">{blocked}</span>}
      </div>

      {job && (
        <section className="stack gap-2 rounded-xl border border-gray-alpha-150 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">
              任务 {job.status}
            </h2>
            {running && (
              <button
                type="button"
                onClick={async () => {
                  stopPolling();
                  try {
                    const r = await jobsApi.cancel(job.id);
                    setJob(r.job);
                    setNote(`${r.scope.stops}；不涉及：${r.scope.doesNot.join("、")}`);
                  } catch (err) {
                    setNote(err instanceof ApiError ? err.message : "取消失败");
                  }
                }}
                className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm hover:bg-gray-alpha-50"
              >
                取消
              </button>
            )}
          </div>
          <p className="text-xs text-secondary">
            本地任务 <span className="font-mono">{job.id.slice(0, 8)}</span>
            {job.requestId && (
              <>
                　远端任务 <span className="font-mono">{job.requestId}</span>
              </>
            )}
          </p>
          {job.error && (
            <p className="text-xs text-amber-700">
              {job.error.safeMessage}（提交确定性：{job.error.submissionCertainty}）
            </p>
          )}
          {running && (
            <p className="text-xs text-secondary">
              远端仍在处理，本应用正在轮询。关闭页面不会丢失任务，重启后会用上面的远端任务 ID 继续查询。
            </p>
          )}
        </section>
      )}

      {result && (
        <section className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
          <h2 className="text-sm font-medium text-foreground">产物</h2>
          {result.name.match(/\.(mp4|webm)$/i) ? (
            <video controls src={result.url} className="w-full rounded-lg" />
          ) : (
            <img src={result.url} alt={result.name} className="w-full rounded-lg" />
          )}
          <a href={result.url} download={result.name} className="focus-ring w-fit text-sm underline">
            下载 {result.name}
          </a>
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
