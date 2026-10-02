import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  jobs as jobsApi,
  providers as providersApi,
  type AssetRecord,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";

/* ==========================================================================
   Sound effects.

   Per SCOPE.md this is the user's own generation only. The upstream sound
   marketplace, licensing sales and public publishing are out of scope, so
   there is no browse-a-catalog affordance here — the page goes straight to
   making something, which is what the spec asks for.

   Duration and encoding limits upstream are plan-dependent and have not been
   verified, so the page states its own local range and lets the provider be
   the authority on the rest.
   ========================================================================== */

/** The widest range this UI will send. The real cap may be lower on a given plan. */
const LOCAL_DURATION_RANGE = { min: 0.5, max: 60 };

const PRESETS = [
  "雨夜窗外的雨声，远处偶尔有车经过",
  "木门吱呀一声缓缓推开",
  "篝火噼啪声，偶尔木柴断裂",
  "拥挤地铁站内的人声与报站广播",
];

interface Result {
  jobId: string;
  url: string;
  name: string;
}

export function SfxPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [influence, setInfluence] = useState(0.3);
  const [loop, setLoop] = useState(false);
  const [ackCost, setAckCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [history, setHistory] = useState<Result[]>([]);

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

  const durationState = useMemo(() => {
    if (duration < LOCAL_DURATION_RANGE.min) {
      return { level: "over" as const, text: `不能小于 ${LOCAL_DURATION_RANGE.min} 秒` };
    }
    if (duration > LOCAL_DURATION_RANGE.max) {
      return { level: "over" as const, text: `不能大于 ${LOCAL_DURATION_RANGE.max} 秒` };
    }
    if (duration === LOCAL_DURATION_RANGE.max) {
      return { level: "at" as const, text: `正好等于本地上限 ${duration} 秒` };
    }
    return { level: "ok" as const, text: `${duration} 秒` };
  }, [duration]);

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地 Provider…";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (!prompt.trim()) return "请输入音效描述";
    if (durationState.level === "over") return durationState.text;
    return null;
  }, [loading, provider, prompt, durationState]);

  const intentId = useMemo(
    () => `sfx:${provider?.id ?? "none"}:${duration}:${loop ? 1 : 0}:${prompt.trim()}`,
    [provider?.id, duration, loop, prompt],
  );

  const show = useCallback((jobId: string, asset: AssetRecord | null) => {
    if (!asset) return;
    const r = { jobId, url: asset.url, name: asset.displayName };
    setResult(r);
    setHistory((h) => [r, ...h].slice(0, 20));
  }, []);

  async function generate() {
    if (!provider) return;
    setBusy(true);
    setNote(null);
    try {
      const created = await jobsApi.create({
        intentId,
        type: "sound_generation",
        providerId: provider.id,
        credentialRef: provider.id,
        input: {
          prompt: prompt.trim(),
          durationSeconds: duration,
          promptInfluence: influence,
          loop,
          acknowledgeUnknownCost: ackCost,
        },
      });
      setJob(created.job);

      if (!created.created) {
        setNote("这次提交与上一次完全相同，已复用同一个任务，不会重复计费。");
        return;
      }

      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      if (out.asset) show(out.job.id, out.asset);
      else if (out.reason) setNote(out.reason);
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
          尚未配置 Provider。音效生成会调用你的 Provider 产生费用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">描述</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="描述你想要的音效…"
          className="focus-ring w-full resize-y rounded-xl border border-gray-alpha-150 bg-background p-3 text-sm outline-none placeholder:text-subtle"
        />
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPrompt(p)}
              className="focus-ring rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs text-secondary transition-colors hover:bg-gray-alpha-50"
            >
              {p.length > 14 ? `${p.slice(0, 14)}…` : p}
            </button>
          ))}
        </div>
        <p className="text-xs text-subtle">
          预设只填入描述文本，不会自动提交。
        </p>
      </section>

      <section className="stack gap-4 rounded-xl border border-gray-alpha-150 p-5">
        <h2 className="text-sm font-medium text-foreground">参数</h2>

        <div className="stack gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">时长</span>
            <span className="font-mono text-xs text-secondary">{duration}s</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={60}
            step={0.5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full"
          />
          <p
            className={`text-xs ${
              durationState.level === "over"
                ? "text-red-700"
                : durationState.level === "at"
                  ? "text-amber-700"
                  : "text-secondary"
            }`}
          >
            {durationState.text}
          </p>
        </div>

        <div className="stack gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">提示词影响力</span>
            <span className="font-mono text-xs text-secondary">{influence}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={influence}
            onChange={(e) => setInfluence(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
          />
          <span className="text-foreground">循环</span>
        </label>

        <p className="text-xs text-secondary">
          时长与编码的上限随 Provider 账户方案而变，**本地未核验**。本地只做明显越界的拦截，
          真正的上限以 Provider 返回的错误为准。
        </p>
      </section>

      <Notice tone="warn">
        音效生成会调用你的 Provider 产生费用，本地无法获知金额，一律记为「费用未知」。
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
          disabled={!!blocked || busy || !ackCost}
          onClick={generate}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background hover:bg-gray-800 disabled:bg-gray-400"
        >
          {busy ? "生成中…" : "生成音效"}
        </button>
        {blocked && <span className="text-xs text-secondary">{blocked}</span>}
      </div>

      {result && (
        <section className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
          <h2 className="text-sm font-medium text-foreground">产物</h2>
          <audio controls src={result.url} className="w-full" />
          <a href={result.url} download={result.name} className="focus-ring w-fit text-sm underline">
            下载 {result.name}
          </a>
        </section>
      )}

      {history.length > 1 && (
        <section className="stack gap-2">
          <h2 className="text-sm font-medium text-foreground">本次会话历史</h2>
          {history.map((h) => (
            <div
              key={h.jobId}
              className="flex items-center justify-between gap-3 rounded-xl border border-gray-alpha-150 p-3 text-sm"
            >
              <span className="truncate text-secondary">{h.name}</span>
              <span className="flex gap-3">
                <a href={h.url} className="focus-ring underline">
                  播放
                </a>
                <a href={h.url} download={h.name} className="focus-ring underline">
                  下载
                </a>
              </span>
            </div>
          ))}
        </section>
      )}

      {job && job.status !== "succeeded" && (
        <p className="text-xs text-secondary">
          最近一次任务：{job.status}
          {job.error ? ` — ${job.error.safeMessage}` : ""}
        </p>
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
