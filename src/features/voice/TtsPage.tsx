import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { VoicePickerDialog } from "@/features/voice/VoicePicker";
import { PROMPT_HANDOFF_KEY } from "@/components/PromptBar";
import {
  AdvancedToggle,
  JobHistoryList,
  Notice,
  RailField,
  RailRow,
  RailSlider,
  RailTabs,
  SelectPill,
  SettingsRail,
  StageColumn,
  TableHead,
  Toggle,
  useDraft,
  useJobHistory,
  VoiceDot,
} from "@/features/voice/ui";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type JobRecord,
  type ProviderRecord,
  type VoiceRecord,
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

   Layout follows the reference (013–025): a text box with a row of example
   prompts beneath it, then a 设置 / 历史 tab pair, then the voice and model
   rows, the four sliders, and a collapsible 高级设置 block holding language,
   output format and speaker boost.

   Nothing here invents a price, a limit, or a success state.
   ========================================================================== */

const TTS_MODELS = [
  {
    id: "eleven_multilingual_v2",
    label: "Eleven Multilingual v2",
    badge: "V2",
    note: "我们最逼真、情感丰富的模型，支持 29 种语言。",
    sampleLangs: ["English", "Japanese", "Chinese"],
    languages: 29,
    maxChars: 10000,
  },
  {
    id: "eleven_turbo_v2_5",
    label: "Eleven Flash v2.5",
    badge: "V2.5",
    note: "低延迟优化版本，字符上限更高。",
    sampleLangs: ["English", "Japanese", "Chinese"],
    languages: 32,
    maxChars: 40000,
  },
  {
    id: "eleven_v3",
    label: "Eleven v3",
    badge: "V3",
    note: "我们表现力最强的模型，支持 70 多种语言。",
    sampleLangs: ["Afrikaans", "Arabic", "Armenian"],
    languages: 70,
    maxChars: 5000,
  },
  {
    id: "eleven_v4",
    label: "Eleven v4",
    badge: "V4",
    note: "速度最快、情感表现最丰富，支持 90+ 种语言。",
    sampleLangs: ["Afrikaans", "Arabic", "Armenian"],
    languages: 90,
    maxChars: 10000,
  },
];

/** Parameters and which models actually accept them. */
const PARAM_MODELS = {
  stability: TTS_MODELS.map((m) => m.id),
  similarity_boost: TTS_MODELS.map((m) => m.id),
  style: ["eleven_turbo_v2_5", "eleven_v3"],
  use_speaker_boost: ["eleven_turbo_v2_5", "eleven_v3"],
  speed: TTS_MODELS.map((m) => m.id),
} as const;

type ParamKey = keyof typeof PARAM_MODELS;
/** The slider-backed parameters; `use_speaker_boost` is a boolean and is separate. */
type NumericParam = "stability" | "similarity_boost" | "style" | "speed";

const OUTPUT_FORMATS = [
  { id: "mp3_44100_128", label: "MP3 44.1kHz (128kbps)" },
  { id: "mp3_44100_192", label: "MP3 44.1kHz (192kbps)", requiresPro: true },
  { id: "pcm_44100", label: "PCM 44.1kHz", requiresPro: true },
];

/** Language coverage. `auto` is the reference default and needs no guess. */
const LANGUAGE_COVERAGE = [
  { id: "auto", label: "自动（推荐）" },
  { id: "zh", label: "中文" },
  { id: "en", label: "英语" },
  { id: "ja", label: "日语" },
  { id: "ko", label: "韩语" },
  { id: "es", label: "西班牙语" },
  { id: "fr", label: "法语" },
  { id: "de", label: "德语" },
  { id: "pt", label: "葡萄牙语" },
  { id: "it", label: "意大利语" },
];

/**
 * The reference's starter prompts. They are prompts, not generations: the
 * upstream page actually synthesises when one is clicked, which costs money
 * against a real key, so clicking here only fills the text box. Generating
 * stays an explicit, separately-confirmed action.
 */
const EXAMPLES = [
  "讲述一个故事",
  "讲个无厘头笑话",
  "录制广告",
  "用不同语言说话",
  "导演一幕戏剧性电影场景",
  "听听电子游戏角色的音色",
  "介绍你的播客",
  "引导冥想课程",
];

const EXAMPLE_TEXT: Record<string, string> = {
  讲述一个故事: "从前有一座山，山里有一座庙，庙里有一位老和尚。",
  讲个无厘头笑话: "为什么冰箱总是很冷静？因为它从来不发脾气。",
  录制广告: "这杯咖啡，凌晨四点现磨，第一口是清醒，第二口是今天。",
  用不同语言说话: "同一句话，用三种语言各说一遍，看看口型与节奏的差别。",
  导演一幕戏剧性电影场景:
    "雨停了。门轴发出一声长响，她终于看清了那张空椅子。",
  听听电子游戏角色的音色: "别动——我数到三。一、二……你怎么还在这儿？",
  介绍你的播客: "欢迎收听本期节目，今天我们聊聊声音本身。",
  引导冥想课程: "闭上眼睛。肩膀放松，呼吸慢慢变长，慢慢变深。",
};

/**
 * Category mark for each starter prompt. The reference draws a glyph in
 * every chip; these are decorative and carry no claim about the prompt.
 */
function ExampleIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    讲述一个故事: <path d="M3 3.5h5a2 2 0 012 2v6a1.5 1.5 0 00-1.5-1.5H3zM12 3.5H8.5" />,
    讲个无厘头笑话: (
      <>
        <circle cx="8" cy="8.5" r="5.5" />
        <path d="M6.4 7.2a1.7 1.7 0 013.2.7M6.6 10.4h2.8" />
      </>
    ),
    录制广告: (
      <>
        <rect x="5.8" y="2.5" width="4.4" height="7" rx="2.2" />
        <path d="M3.5 8v1a4.5 4.5 0 009 0V8M8 13.5V15" />
      </>
    ),
    用不同语言说话: (
      <>
        <path d="M2.5 4h5M5 4v1.5M6.4 4c0 3-1.6 5-3.9 5.6M4 7.2c.6 1.6 2 2.7 3.6 3" />
        <path d="M8.6 9.5l4 4M12.6 9.5l-4 4" />
      </>
    ),
    导演一幕戏剧性电影场景: (
      <>
        <rect x="1.8" y="4.5" width="12.4" height="8" rx="1.5" />
        <path d="M1.8 10.6h12.4M4.6 4.5l1.6 6.1M11.4 4.5l-1.6 6.1" />
      </>
    ),
    听听电子游戏角色的音色: (
      <>
        <rect x="2" y="6" width="12" height="6" rx="3" />
        <path d="M5 8.4v1.2M7 8.4v1.2M9 8.4v1.2M11 8.4v1.2M6 13.5h4" />
      </>
    ),
    介绍你的播客: (
      <>
        <circle cx="8" cy="6" r="2.2" />
        <path d="M4 13.5a4 4 0 018 0" />
      </>
    ),
    引导冥想课程: (
      <>
        <circle cx="8" cy="8.5" r="5.5" />
        <path d="M8 5.6v5.8M6.2 8.1c0 1.2.8 2 1.8 2s1.8-.8 1.8-2" />
      </>
    ),
  };
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-secondary"
    >
      {paths[name] ?? <circle cx="8" cy="8.5" r="5" />}
    </svg>
  );
}

type Tab = "settings" | "history";

export function TtsPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("settings");
  const [voiceDialog, setVoiceDialog] = useState(false);
  const [modelDialog, setModelDialog] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);

  // A refresh should not lose a half-written script.
  const [draft, setDraft] = useDraft("tts", {
    text: "",
    modelId: TTS_MODELS[0].id,
    voiceId: "",
    format: OUTPUT_FORMATS[0].id,
    language: LANGUAGE_COVERAGE[0].id,
    params: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0 },
    speakerBoost: true,
  });

  // The home prompt bar hands its text over here rather than generating on the
  // home page, because that is a paid call and this page carries the cost gate.
  // Consume-and-clear: a later visit must not resurrect a prompt already sent.
  useEffect(() => {
    let handed: string | null = null;
    try {
      handed = sessionStorage.getItem(PROMPT_HANDOFF_KEY);
      if (handed) sessionStorage.removeItem(PROMPT_HANDOFF_KEY);
    } catch {
      handed = null;
    }
    if (handed) {
      setDraft((d) => ({ ...d, text: handed as string }));
      setHandoff(true);
    }
  }, [setDraft]);

  const [ackUnknownCost, setAckUnknownCost] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { text, modelId, voiceId, format, language, params, speakerBoost } = draft;
  const [voice, setVoice] = useState<VoiceRecord | null>(null);

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

  const history = useJobHistory("text_to_speech", tab === "history");
  const supported = (k: ParamKey) => (PARAM_MODELS[k] as readonly string[]).includes(modelId);
  const setNum = (k: NumericParam) => (v: number) =>
    setDraft((d) => ({ ...d, params: { ...d.params, [k]: v } }));

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
      return { level: "near" as const, text: `接近上限：${n} / ${model.maxChars} 字符` };
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
          languageCode: language,
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
        // Read back only the assets this job produced. Taking "the newest
        // asset" would attach an unrelated file after a refresh.
        const res = await assetsApi.list();
        const mine = res.assets.filter((a) => found.outputAssetIds.includes(a.id));
        const first = mine[0];
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

  // ⌘+Enter is the reference's generate shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !blocked && ackUnknownCost) {
        e.preventDefault();
        void generate();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="stack gap-6">
      {/* ---------------- provider gate ---------------- */}
      {loadError && <Notice tone="error">{loadError}</Notice>}

      {handoff && (
        <Notice tone="info">
          已从主页接收这段文本。检查音色、模型与参数，确认费用后再生成。
          <button
            type="button"
            onClick={() => setHandoff(false)}
            className="focus-ring ml-2 underline"
          >
            知道了
          </button>
        </Notice>
      )}

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

      {/* The reference is a two-column page: the script fills the left, the
          settings rail owns the right. The tab pair belongs to the rail, so
          it moves across with it rather than spanning the page. */}
      <div className="flex items-start">
        <StageColumn>
          <label className="flex min-h-[320px] flex-1 flex-col">
            <span className="sr-only">文本</span>
            <textarea
              value={text}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              placeholder="在此输入或粘贴任何你想转换为逼真语音的文本…"
              aria-label="主文本区域"
              className="focus-ring w-full flex-1 resize-none rounded-xl border border-gray-alpha-150 bg-background p-3 text-sm leading-relaxed outline-none placeholder:text-subtle"
            />
          </label>

          {text.length === 0 ? (
            <div className="stack gap-2">
              <p className="text-sm text-foreground">开始使用</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, text: EXAMPLE_TEXT[label] ?? label }))}
                    className="focus-ring flex items-center gap-1.5 rounded-[10px] border border-gray-alpha-150 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:border-gray-alpha-200 hover:bg-gray-alpha-50"
                  >
                    <ExampleIcon name={label} />
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-subtle">
                参考站在点击这些提示后会直接开始生成并计费；本地只填入文本，生成需要你显式确认。
              </p>
            </div>
          ) : (
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
          )}

          <label className="flex items-start gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              checked={ackUnknownCost}
              onChange={(e) => setAckUnknownCost(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              我了解这次提交会产生费用，但金额未知，并同意向 {provider?.baseURL} 发送上述文本。
            </span>
          </label>

          {submitError && <Notice tone="error">{submitError}</Notice>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!!blocked || submitting || !ackUnknownCost}
              onClick={generate}
              className="focus-ring h-8 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800 disabled:bg-gray-300 disabled:text-secondary"
            >
              {submitting ? "提交中…" : text.length === 0 ? "生成语音" : "重新生成语音"}
            </button>
            {blocked && <span className="text-xs text-secondary">{blocked}</span>}
          </div>

          {job && (
            <JobPanel
              job={job}
              onCancel={async () => {
                try {
                  const r = await jobsApi.cancel(job.id);
                  setJob(r.job);
                  history.reload();
                } catch (err) {
                  setSubmitError(err instanceof ApiError ? err.message : "取消失败");
                }
              }}
            />
          )}

          {result && (
            <section className="stack gap-3 rounded-xl border border-gray-alpha-150 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-foreground">{result.name}</span>
                <a
                  href={result.url}
                  download={result.name}
                  className="focus-ring shrink-0 rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50"
                >
                  下载音频
                </a>
              </div>
              <audio controls src={result.url} className="h-9 w-full" />
            </section>
          )}
        </StageColumn>

        <SettingsRail>
          <RailTabs value={tab} onChange={setTab} />
          <div className="stack gap-5 pt-5">
            {tab === "history" ? (
              <>
                <TableHead columns={["名称", "状态", "操作"]} />
                <JobHistoryList {...history} emptyText="本地还没有语音生成历史。" />
              </>
            ) : (
              <>
                <RailField label="音色">
                  <div className="flex items-center gap-2">
                    <SelectPill
                      label={voice ? voice.name : "选择音色"}
                      leading={voice ? <VoiceDot name={voice.name} /> : undefined}
                      disabled={!provider || provider.validationState !== "available"}
                      onClick={() => setVoiceDialog(true)}
                      ariaLabel={voice ? `选择音色 - ${voice.name}` : "选择音色"}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!voiceId) return;
                        try {
                          await navigator.clipboard.writeText(voiceId);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1600);
                        } catch {
                          setCopied(false);
                          setSubmitError("无法访问剪贴板，请手动复制音色 ID。");
                        }
                      }}
                      disabled={!voiceId}
                      aria-label="复制音色 ID"
                      title={copied ? "已复制" : "复制音色 ID"}
                      className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-gray-alpha-150 text-secondary transition-colors hover:bg-gray-alpha-50 disabled:opacity-40"
                    >
                      {copied ? <CheckMark /> : <CopyMark />}
                    </button>
                  </div>
                </RailField>

                <RailField label="模型">
                  <SelectPill
                    label={model.label}
                    badge={model.badge}
                    onClick={() => setModelDialog(true)}
                    ariaLabel={`选择模型 - ${model.label}`}
                  />
                  <p className="text-xs text-secondary">{model.note}</p>
                </RailField>

                <RailSlider
                  label="速度"
                  low="更慢"
                  high="更快"
                  value={params.speed}
                  min={0.7}
                  max={1.2}
                  onChange={setNum("speed")}
                  enabled={supported("speed")}
                  reason="当前模型不支持该参数，不会发送。"
                />
                <RailSlider
                  label="稳定性"
                  low="更具变化性"
                  high="更稳定"
                  value={params.stability}
                  onChange={setNum("stability")}
                  enabled={supported("stability")}
                  reason="当前模型不支持该参数，不会发送。"
                />
                <RailSlider
                  label="相似度"
                  low="低"
                  high="高"
                  value={params.similarity_boost}
                  onChange={setNum("similarity_boost")}
                  enabled={supported("similarity_boost")}
                  reason="当前模型不支持该参数，不会发送。"
                />
                <RailSlider
                  label="风格夸张"
                  low="无"
                  high="夸张"
                  value={params.style}
                  onChange={setNum("style")}
                  enabled={supported("style")}
                  reason="当前模型不支持该参数，不会发送。"
                />

                <div className="stack gap-3">
                  <AdvancedToggle open={advanced} onClick={() => setAdvanced((v) => !v)} />
                  {advanced && (
                    <div className="stack gap-3">
                      <RailRow label="语言">
                        <select
                          value={language}
                          onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
                          aria-label="语言覆盖"
                          className="focus-ring h-8 max-w-[200px] rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
                        >
                          {LANGUAGE_COVERAGE.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </RailRow>
                      <RailRow label="输出格式">
                        <select
                          value={format}
                          onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value }))}
                          aria-label="输出格式"
                          className="focus-ring h-8 max-w-[220px] rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
                        >
                          {OUTPUT_FORMATS.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </RailRow>
                      {!formatSupported && (
                        <p className="text-xs text-amber-700">
                          本地无法确认当前密钥是否具备该格式权限；提交前请确认。
                        </p>
                      )}
                      <RailRow label="说话人增强">
                        <Toggle
                          label="说话人增强"
                          checked={speakerBoost}
                          disabled={!supported("use_speaker_boost")}
                          onChange={(v) => setDraft((d) => ({ ...d, speakerBoost: v }))}
                        />
                      </RailRow>
                      {!supported("use_speaker_boost") && (
                        <p className="text-xs text-subtle">当前模型不支持说话人增强，不会发送。</p>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-xs text-subtle">
                  不适用于当前模型的参数不会被发送到远端。切换模型会丢弃不兼容字段，但保留草稿文本。
                </p>
              </>
            )}
          </div>
        </SettingsRail>
      </div>

      {voiceDialog && (
        <VoicePickerDialog
          value={voiceId}
          onChange={(v) => {
            setDraft((d) => ({ ...d, voiceId: v.voiceId }));
            setVoice(v);
            setVoiceDialog(false);
          }}
          onClose={() => setVoiceDialog(false)}
        />
      )}

      {modelDialog && (
        <ModelDialog
          value={modelId}
          onChange={(id) => {
            setDraft((d) => ({ ...d, modelId: id }));
            setModelDialog(false);
          }}
          onClose={() => setModelDialog(false)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- model picker -- */

/**
 * Model chooser. Every entry carries the character ceiling and language count
 * the local build gates on. The upstream "便宜 50%" and "工作室质量" badges
 * are not reproduced: the first is a price claim and the second a plan
 * comparison, and SCOPE.md removes both.
 */
function ModelDialog({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择模型"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-background shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4 px-5 pb-3 pt-4">
          <span className="text-sm font-medium text-foreground">选择模型</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="focus-ring rounded-[10px] p-1 text-secondary hover:bg-gray-alpha-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div role="radiogroup" aria-label="模型" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {TTS_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={value === m.id}
              onClick={() => onChange(m.id)}
              className={`focus-ring flex w-full flex-col gap-1.5 rounded-xl px-3 py-3 text-left transition-colors ${
                value === m.id ? "bg-gray-alpha-100" : "hover:bg-gray-alpha-50"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-foreground">{m.label}</span>
                <span className="rounded-full border border-gray-alpha-200 px-1.5 py-px text-[11px] leading-4 text-secondary">
                  {m.badge}
                </span>
              </span>
              <span className="text-xs text-secondary">{m.note}</span>
              <span className="flex flex-wrap items-center gap-1">
                {m.sampleLangs.map((l) => (
                  <span
                    key={l}
                    className="rounded-full bg-gray-alpha-50 px-1.5 py-px text-[11px] leading-4 text-secondary"
                  >
                    {l}
                  </span>
                ))}
                <span className="text-[11px] leading-4 text-subtle">
                  +{Math.max(m.languages - m.sampleLangs.length, 0)} 个…
                </span>
              </span>
              <span className="text-xs text-subtle">
                上限 {m.maxChars} 字符 · 能力未经真实调用核验
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- pieces -- */

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

function CopyMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 3.5h-7a1 1 0 00-1 1v7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
