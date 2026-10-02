import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { VoicePicker } from "@/features/voice/VoicePicker";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";

/* ==========================================================================
   Text to speech — the first BYOK page.

   The states here are the point, not decoration:
     - no provider configured  -> generation is disabled and says where to fix it
     - a provider that is not `available` -> the reason is shown, never guessed
     - capability unknown -> the UI refuses to pretend a model is usable
     - cost unknown -> submission requires an explicit acknowledgement, because
       this app cannot know what the user's provider will charge
     - a duplicate submit -> the same local job comes back, never a second bill

   Nothing here invents a price, a limit, or a success state.
   ========================================================================== */

const TTS_MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2", languages: 29, maxChars: 10000 },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", languages: 32, maxChars: 40000 },
  { id: "eleven_v3", label: "Eleven v3", languages: 70, maxChars: 5000 },
  { id: "eleven_v4", label: "Eleven v4", languages: 90, maxChars: 10000 },
];

/** Parameters and which models actually accept them. */
const PARAM_MODELS = {
  stability: TTS_MODELS.map((m) => m.id),
  similarity_boost: TTS_MODELS.map((m) => m.id),
  style: ["eleven_turbo_v2_5", "eleven_v3"],
  use_speaker_boost: ["eleven_turbo_v2_5", "eleven_v3"],
  speed: ["eleven_v3", "eleven_v4"],
} as const;

type ParamKey = keyof typeof PARAM_MODELS;
/** The slider-backed parameters; `use_speaker_boost` is a boolean and is separate. */
type NumericParam = "stability" | "similarity_boost" | "style" | "speed";

const OUTPUT_FORMATS = [
  { id: "mp3_44100_128", label: "MP3 · 44.1kHz · 128kbps" },
  { id: "mp3_44100_192", label: "MP3 · 44.1kHz · 192kbps", requiresPro: true },
  { id: "pcm_44100", label: "PCM · 44.1kHz", requiresPro: true },
];

export function TtsPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [modelId, setModelId] = useState(TTS_MODELS[0].id);
  const [voiceId, setVoiceId] = useState("");
  const [format, setFormat] = useState(OUTPUT_FORMATS[0].id);
  const [params, setParams] = useState<Record<NumericParam, number>>({
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    speed: 1.0,
  });
  const [speakerBoost, setSpeakerBoost] = useState(true);
  const [ackUnknownCost, setAckUnknownCost] = useState(false);

  const [job, setJob] = useState<JobRecord | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const model = useMemo(
    () => TTS_MODELS.find((m) => m.id === modelId) ?? TTS_MODELS[0],
    [modelId],
  );

  useEffect(() => {
    (async () => {
      try {
        const list = await providersApi.list();
        setProviders(list);
        setProvider(list.find((p) => p.validationState === "available") ?? list[0] ?? null);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "无法读取 Provider");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const supported = (k: ParamKey) => (PARAM_MODELS[k] as readonly string[]).includes(modelId);
  const setNum = (k: NumericParam) => (v: number) =>
    setParams((p) => ({ ...p, [k]: v }));

  /** At-limit and just-over are separate cases, not one "too long" message. */
  const lengthState = useMemo(() => {
    const n = text.length;
    if (n === 0) return { level: "empty" as const, text: "请输入要朗读的文本" };
    if (n > model.maxChars) {
      return {
        level: "over" as const,
        text: `超出 ${model.label} 上限：当前 ${n} / ${model.maxChars} 字符`,
      };
    }
    if (n > model.maxChars * 0.9) {
      return {
        level: "near" as const,
        text: `接近上限：${n} / ${model.maxChars} 字符`,
      };
    }
    if (n === model.maxChars) {
      return { level: "at" as const, text: `正好等于上限：${model.maxChars} 字符` };
    }
    return { level: "ok" as const, text: `${n} / ${model.maxChars} 字符` };
  }, [text, model]);

  const formatSupported = useMemo(() => {
    const f = OUTPUT_FORMATS.find((x) => x.id === format);
    return !f?.requiresPro;
  }, [format]);

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地 Provider…";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (!voiceId) return "请先选择音色";
    if (lengthState.level === "over") return "文本超出所选模型上限";
    if (!formatSupported) return "当前密钥不具备该输出格式所需权限";
    return null;
  }, [loading, provider, voiceId, lengthState.level, formatSupported]);

  /**
   * One intent per attempt. Re-clicking while a job is in flight reuses the
   * same id, so the server's UNIQUE index collapses it to one job.
   */
  const intentId = useMemo(
    () => `tts:${provider?.id ?? "none"}:${modelId}:${voiceId || "novoice"}`,
    [provider?.id, modelId, voiceId],
  );

  async function generate() {
    if (!provider) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await jobsApi.create({
        intentId,
        type: "text_to_speech",
        providerId: provider.id,
        modelId,
        credentialRef: provider.id,
        input: {
          text,
          voiceId,
          outputFormat: format,
          // Only parameters this model actually accepts are sent; the rest are
          // dropped rather than forwarded and rejected upstream.
          params: {
            ...Object.fromEntries(
              Object.entries(params).filter(([k]) => supported(k as ParamKey)),
            ),
            ...(supported("use_speaker_boost") ? { use_speaker_boost: speakerBoost } : {}),
          },
          acknowledgeUnknownCost: ackUnknownCost,
        },
      });
      setJob(res.job);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  const poll = useCallback(async (id: string) => {
    try {
      const list = await jobsApi.list();
      const found = list.find((j) => j.id === id) ?? null;
      setJob(found);
      if (found?.status === "succeeded") {
        // Read the artifact back through the controlled URL, never a path.
        const res = await assetsApi.list();
        const first = res.assets[0] as { url: string; displayName: string } | undefined;
        if (first) setResult({ url: first.url, name: first.displayName });
      }
    } catch {
      /* keep polling; a transient read failure is not a job failure */
    }
  }, []);

  useEffect(() => {
    if (!job) return;
    if (["succeeded", "failed", "cancelled", "unknown_submission"].includes(job.status)) return;
    const t = setInterval(() => void poll(job.id), 1200);
    return () => clearInterval(t);
  }, [job, poll]);

  return (
    <div className="stack gap-8">
      {/* ---------------- provider gate ---------------- */}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      {!loading && providers.length === 0 && (
        <Notice tone="warn">
          尚未配置 Provider。你可以浏览界面与本地项目，但真实生成会被禁用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      {provider && provider.validationState !== "available" && (
        <Notice tone="warn">
          当前密钥状态为「{provider.validationState}」
          {provider.lastError ? `：${provider.lastError}` : ""}。
          <Link to="/local/settings/providers" className="ml-1 underline">
            前往验证
          </Link>
        </Notice>
      )}

      {provider && (
        <Notice tone="info">
          能力尚未经过真实 API 核验，因此下方所有模型都标为「未验证」。
          实际可用性由你的 Provider 密钥决定，本地不会替你断言。
        </Notice>
      )}

      {/* ---------------- input ---------------- */}
      <section className="stack gap-3">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">文本</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="输入要朗读的内容…"
            className="focus-ring w-full resize-y rounded-xl border border-gray-alpha-150 bg-background p-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>
        <p
          className={`text-xs ${
            lengthState.level === "over"
              ? "text-red-700"
              : lengthState.level === "near"
                ? "text-amber-700"
                : "text-secondary"
          }`}
        >
          {lengthState.text}
        </p>
      </section>

      {/* ---------------- model + format ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">模型</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            {TTS_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}（{m.languages} 语言 / 上限 {m.maxChars} 字符）
              </option>
            ))}
          </select>
        </label>

        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">输出格式</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            {OUTPUT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
                {f.requiresPro ? "（需更高权限，未核验）" : ""}
              </option>
            ))}
          </select>
          {!formatSupported && (
            <span className="text-xs text-amber-700">
              本地无法确认当前密钥是否具备该格式权限；提交前请确认。
            </span>
          )}
        </label>
      </div>

      {/* ---------------- parameters ---------------- */}
      <section className="stack gap-4 rounded-xl border border-gray-alpha-150 p-5">
        <h2 className="text-sm font-medium text-foreground">参数</h2>
        <Slider
          label="稳定性"
          value={params.stability}
          onChange={setNum("stability")}
          enabled={supported("stability")}
        />
        <Slider
          label="相似度"
          value={params.similarity_boost}
          onChange={setNum("similarity_boost")}
          enabled={supported("similarity_boost")}
        />
        <Slider
          label="风格"
          value={params.style}
          onChange={setNum("style")}
          enabled={supported("style")}
        />
        <Slider
          label="语速"
          value={params.speed}
          min={0.7}
          max={1.2}
          step={0.01}
          onChange={setNum("speed")}
          enabled={supported("speed")}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={speakerBoost}
            disabled={!supported("use_speaker_boost")}
            onChange={(e) => setSpeakerBoost(e.target.checked)}
          />
          <span className={supported("use_speaker_boost") ? "text-foreground" : "text-subtle"}>
            说话人增强
          </span>
        </label>
        <p className="text-xs text-secondary">
          不适用于当前模型的参数不会被发送到远端。切换模型会丢弃不兼容字段，但保留草稿文本。
        </p>
      </section>

      {/* ---------------- voice ---------------- */}
      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">音色</h2>
        <VoicePicker
          value={voiceId}
          onChange={setVoiceId}
          disabled={!provider || provider.validationState !== "available"}
        />
      </section>

      {/* ---------------- cost acknowledgement ---------------- */}
      <Notice tone="warn">
        本应用无法获知你的 Provider 将收取多少费用。任何生成都记为「费用未知」，
        不会显示为 0。
      </Notice>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ackUnknownCost}
          onChange={(e) => setAckUnknownCost(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-secondary">
          我了解这次提交会产生费用，但金额未知，并同意向 {provider?.baseURL} 发送上述文本。
        </span>
      </label>

      {submitError && <Notice tone="error">{submitError}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!!blocked || submitting || !ackUnknownCost}
          onClick={generate}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800 disabled:bg-gray-400"
        >
          {submitting ? "提交中…" : "生成语音"}
        </button>
        {blocked && <span className="text-xs text-secondary">{blocked}</span>}
      </div>

      {/* ---------------- job + result ---------------- */}
      {job && <JobPanel job={job} onCancel={async () => {
        try {
          const r = await jobsApi.cancel(job.id);
          setJob(r.job);
        } catch (err) {
          setSubmitError(err instanceof ApiError ? err.message : "取消失败");
        }
      }} />}

      {result && (
        <section className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
          <h2 className="text-sm font-medium text-foreground">产物</h2>
          <audio controls src={result.url} className="w-full" />
          <a
            href={result.url}
            download={result.name}
            className="focus-ring w-fit text-sm underline"
          >
            下载 {result.name}
          </a>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- pieces -- */

function Slider({
  label,
  value,
  onChange,
  enabled = true,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  enabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="stack gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className={enabled ? "text-foreground" : "text-subtle"}>{label}</span>
        <span className="font-mono text-xs text-secondary">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full disabled:opacity-40"
      />
      {!enabled && (
        <span className="text-xs text-subtle">当前模型不支持该参数，不会发送。</span>
      )}
    </div>
  );
}

function JobPanel({ job, onCancel }: { job: JobRecord; onCancel: () => void }) {
  const canCancel = !["succeeded", "failed", "cancelled"].includes(job.status);
  return (
    <section className="stack gap-2 rounded-xl border border-gray-alpha-150 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">任务 {job.status}</h2>
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm hover:bg-gray-alpha-50"
          >
            取消
          </button>
        )}
      </div>
      <p className="text-xs text-secondary">
        本地任务 ID <span className="font-mono">{job.id.slice(0, 8)}</span>；
        重复提交同一意图会返回同一个任务，不会二次计费。
      </p>
      {job.error && (
        <p className="text-xs text-amber-700">
          {job.error.safeMessage}（提交确定性：{job.error.submissionCertainty}）
        </p>
      )}
    </section>
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
