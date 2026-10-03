import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type AssetRecord,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";
import { useMediaDraft } from "@/features/media/drafts";
import { ArtifactList } from "@/features/media/ArtifactList";
import { JobHistory } from "@/features/media/MusicPage";
import {
  BarButton,
  Composer,
  CostAcknowledgement,
  FilterChips,
  ICONS,
  Icon,
  InertBarButton,
  Notice,
  Popover,
  PopoverTitle,
  PromptChips,
  SegmentedRadio,
  SubmitArrow,
  TabStrip,
  UnknownCostPill,
  type FilterGroup,
} from "@/features/media/ui";

/* ==========================================================================
   Image, video and lipsync — one page, two tabs.

   探索 and 历史 are one page upstream, not two: reference 131 is the 历史 tab
   with the *same* composer that 121/122 show on 探索, and both keep the
   modality (131 is 口型同步). So this component takes a `tab` and renders both
   from one state tree, exactly as SfxPage does for 探索/历史/收藏. Splitting
   them would mean the second route has no composer at all, which is the gap
   this file exists to close.

   Tab state survives a switch because the draft is persisted per mode by
   `useMediaDraft` (see drafts.ts) rather than held in component state: the
   route change unmounts this component, and a local component variable would
   take the half-written prompt with it.

   These are the asynchronous capabilities: the provider answers with a remote
   id and the result is polled. That shapes the whole UI — there is a real
   "in flight" period, and the honest states during it (submitted remotely,
   polling, gave up, unknown submission) matter more than the success state.

   What the local adapter forwards (server/lib/runner.mjs → adapter.submitAsync)
   is: prompt, modelId, imageUrl, durationSeconds, aspectRatio, resolution,
   sound, loop — each only when the caller actually set it. So 纵横比 / 分辨率 /
   声音 are real controls now. Whether the upstream endpoint *honours* them is a
   separate question: no authenticated call has ever been made, so every one of
   them is labelled 未核验 rather than presented as a promise about the output.

   生成次数 (variant count) is the exception. No such field exists anywhere in
   the submit path, so it stays disabled with that reason on screen instead of
   being silently dropped.

   The reference bar order (122, 131) is: model, 纵横比, 分辨率, 质量,
   生成次数, 提示词优化, then cost and submit.
   ========================================================================== */

const MODES = [
  { id: "image", label: "图像", taskType: "image_generation" },
  { id: "video", label: "视频", taskType: "video_generation" },
  { id: "lipsync", label: "口型同步", taskType: "video_generation" },
] as const;

type ModeId = (typeof MODES)[number]["id"];

export type MediaTab = "explore" | "history";

const TABS: { id: MediaTab; to: string; label: string }[] = [
  { id: "explore", to: "/app/image-video", label: "探索" },
  { id: "history", to: "/app/image-video/history", label: "历史" },
];

/**
 * Prompt fragments, not upstream magic. Each chip inserts text the user can
 * read and edit; nothing here rewrites the request behind their back. The
 * history tab's example cards are drawn from this same set, so a card's `+`
 * puts a real, readable prompt into the composer rather than a hidden one.
 */
const PROMPT_CHIPS = [
  { id: "surreal", label: "Surreal Landscape", insert: "surreal landscape, dramatic light" },
  { id: "cyber", label: "Cyberpunk Alley", insert: "cyberpunk alley, neon reflections, rain" },
  { id: "forest", label: "Enchanted Forest", insert: "enchored forest, soft volumetric light" },
];

/** Forwarded by the local adapter, so the control is real. */
const DURATIONS = [4, 5, 8, 10];

/**
 * The reference's value sets (122 image, 131 lipsync). These are the labels the
 * upstream menus show; which of them a given model actually accepts is not
 * knowable without an authenticated call, so every one of them is marked
 * 未核验 rather than presented as supported.
 */
const ASPECT_RATIOS = ["16:9", "1:1", "9:16", "4:3", "3:4"];
const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
/**
 * 1080p first, not as a claim about what lipsync "should" be: 131 shows the
 * lipsync composer sitting on 1080p, so that is the value a mode switch must
 * land on to match the reference rather than the lower entry.
 */
const LIPSYNC_RESOLUTIONS = ["1080p", "720p"];

/**
 * Present in the reference bar with no field in the submit path at all. Kept
 * visible and disabled, with the reason attached, so the control inventory
 * still matches the reference without pretending it works.
 */
const INERT: { label: string; icon: string; reason: string }[] = [
  { label: "质量", icon: ICONS.quality, reason: "质量在本地适配器的提交路径里没有对应字段" },
  {
    label: "生成次数",
    icon: ICONS.count,
    reason: "生成次数在提交路径里没有任何对应字段，一次提交固定产出一个结果",
  },
  {
    label: "提示词优化",
    icon: ICONS.wand,
    reason: "提示词优化在提交路径里没有对应字段，本地不会替你改写描述",
  },
];

const MAX_POLLS = 40;

interface Draft {
  prompt: string;
  model: string;
  manualModel: string;
  duration: number;
  referenceUrl: string;
  aspectRatio: string;
  resolution: string;
  sound: boolean;
}

const EMPTY_DRAFT: Draft = {
  prompt: "",
  model: "",
  manualModel: "",
  duration: 5,
  referenceUrl: "",
  // 16:9 is what the reference composer opens on.
  aspectRatio: "16:9",
  resolution: "1K",
  sound: false,
};

export function ImageVideoPage({ tab }: { tab: MediaTab }) {
  const [params, setParams] = useSearchParams();
  const modeParam = params.get("modality") as ModeId | null;
  const mode: ModeId = MODES.some((m) => m.id === modeParam) ? (modeParam as ModeId) : "image";
  const modeDef = MODES.find((m) => m.id === mode)!;

  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  // Keyed by mode, not by tab: switching tabs must not swap the draft, and
  // the reference keeps 探索 and 历史 on the same modality (131 is 口型同步).
  const [draft, setDraft] = useMediaDraft<Draft>(`image-video:${mode}`, EMPTY_DRAFT);
  const [ackCost, setAckCost] = useState(false);

  const [job, setJob] = useState<JobRecord | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [reference, setReference] = useState<AssetRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { prompt, model, manualModel, duration, referenceUrl, aspectRatio, resolution, sound } = draft;
  const modelId = model || manualModel.trim() || undefined;
  const resolutionOptions = mode === "lipsync" ? LIPSYNC_RESOLUTIONS : IMAGE_RESOLUTIONS;
  // Switching mode can strand a resolution the new menu does not offer; fall
  // back to that menu's first entry rather than showing an unselectable value.
  const activeResolution = resolutionOptions.includes(resolution)
    ? resolution
    : resolutionOptions[0];
  const [showChips, setShowChips] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await providersApi.list();
        setProvider(list.find((x) => x.validationState === "available") ?? list[0] ?? null);
      } catch {
        setProvider(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // The provider is the only authority on which models exist. An empty list is
  // a real answer, and it is why the composer falls back to a typed name.
  const loadModels = useCallback(async (id: string) => {
    try {
      const res = await providersApi.models(id);
      setModels(res.models.map((m) => m.id));
      setModelsNote(res.models.length === 0 ? "Provider 返回了空模型列表。" : null);
    } catch (err) {
      setModels([]);
      setModelsNote(err instanceof ApiError ? err.message : "读取模型列表失败");
    }
  }, []);

  useEffect(() => {
    if (provider?.validationState === "available") void loadModels(provider.id);
  }, [provider, loadModels]);

  /**
   * True when the amber banner is already on screen. It then says the same
   * thing the `blocked` line would, so the line is suppressed rather than
   * printed twice.
   */
  const providerNotice = !loading && !provider;

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地 Provider…";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (mode === "lipsync") {
      return "本地适配器没有口型同步端点：虚拟形象与音频无法转交给 Provider，因此本页不提交口型同步";
    }
    if (!ackCost) return "请先勾选下方的费用确认";
    if (!prompt.trim()) return "请输入描述";
    if (!modelId) return models.length > 0 ? "请选择一个模型" : "请填写模型名";
    return null;
  }, [loading, provider, prompt, modelId, mode, models.length, ackCost]);

  const intentId = useMemo(
    () =>
      `${mode}:${provider?.id ?? "none"}:${modelId ?? "none"}:${aspectRatio}:${activeResolution}:${sound ? 1 : 0}:${prompt.trim().slice(0, 64)}`,
    [mode, provider?.id, modelId, aspectRatio, activeResolution, sound, prompt],
  );

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // Each mode keeps its own draft and parameters (spec: 图像/视频/口型分别存
  // 草稿). A mode switch therefore also drops the previous mode's in-flight
  // view: the local poll stops so its artifact cannot appear under the new
  // mode. The remote task is untouched and stays in the history route.
  useEffect(() => {
    stopPolling();
    setResult(null);
    setPolls(0);
  }, [mode, stopPolling]);

  const poll = useCallback(
    async (id: string, attempt = 0) => {
      setPolls(attempt + 1);
      let out: Awaited<ReturnType<typeof jobsApi.poll>>;
      try {
        out = await jobsApi.poll(id);
      } catch (err) {
        // A failed read is not a failed generation: the remote task may still
        // be running, so the note says so instead of implying anything.
        setNote(
          `查询远端状态失败：${err instanceof ApiError ? err.message : "网络错误"}。远端任务可能仍在处理，可稍后重新查询。`,
        );
        return;
      }
      setJob(out.job);
      if (out.asset) {
        setResult({ url: out.asset.url, name: out.asset.displayName });
        return;
      }
      if (out.stillRunning && attempt < MAX_POLLS) {
        // Back off gently. Polling a paid provider should not be a hot loop.
        timer.current = setTimeout(() => void poll(id, attempt + 1), 2000 + attempt * 250);
        return;
      }
      if (out.stillRunning) {
        setNote("本地轮询次数已用尽，远端可能仍在处理。任务已保存，可以稍后重新查询。");
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
    setPolls(0);
    try {
      const created = await jobsApi.create({
        intentId,
        type: modeDef.taskType,
        providerId: provider.id,
        modelId,
        credentialRef: provider.id,
        input: {
          prompt: prompt.trim(),
          // Only a URL the provider can actually fetch is forwarded. A local
          // asset lives on this machine and is invisible to the provider.
          ...(referenceUrl.trim() ? { imageUrl: referenceUrl.trim() } : {}),
          ...(mode === "video" ? { durationSeconds: duration } : {}),
          // Forwarded by the adapter (runner → submitAsync), each only because
          // the user actually chose it. The endpoint honouring them is unproven.
          aspectRatio,
          resolution: activeResolution,
          sound,
          acknowledgeUnknownCost: ackCost,
        },
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

  async function uploadReference(file: File) {
    setNote(null);
    try {
      const res = await assetsApi.upload(file);
      setReference(res.asset);
      setNote(
        `${res.asset.displayName} 已存入本地素材库。供应商无法访问本机地址，因此它不会被转交给 Provider；需要参考图时请填写一个可公开访问的 URL。`,
      );
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "参考图上传失败");
    }
  }

  const running = job?.status === "running" || job?.status === "submitting";
  const canResume = !!job && !running && job.status !== "succeeded" && !!job.requestId;

  function appendToPrompt(fragment: string) {
    setDraft((d) => ({
      ...d,
      prompt: d.prompt.trim() ? `${d.prompt.trim()}, ${fragment}` : fragment,
    }));
  }

  return (
    <div className="stack gap-6">
      {/* The modality rides along on the tab link. 131's own URL is
          `/app/image-video/history?modality=lipsync`: upstream carries the mode
          across the tab switch, and dropping it here would reset 图像/视频/口型同步
          to 图像 every time the user opened 历史. */}
      <TabStrip
        tabs={TABS.map((t) => ({
          to: mode === "image" ? t.to : `${t.to}?modality=${mode}`,
          label: t.label,
          active: t.id === tab,
        }))}
      />

      {tab === "history" && (
        <MediaHistoryPanel
          models={models}
          modelsNote={modelsNote}
          loading={loading}
          onPickExample={appendToPrompt}
        />
      )}

      <Composer
        label={`${modeDef.label}描述`}
        docked
        prompt={prompt}
        onPrompt={(v) => setDraft((d) => ({ ...d, prompt: v }))}
        placeholder={
          mode === "image"
            ? "用英语描述你想生成的图片，或使用 @ 引用…"
            : "用英语描述你想生成的视频，或使用 @ 引用…"
        }
        chips={
          /* Two rows, in the reference's order: the suggestion pills sit above
             the mode switch (122), and when they are collapsed the row that is
             left is the mode switch with the restore control at its right
             (130, 131 — whose a11y tree names that button 显示建议). Keeping
             the restore button on the mode row is what puts it there; a plain
             `justify-between` sibling would have floated it to the far left. */
          <div className="stack gap-2">
            {showChips && (
              <PromptChips chips={PROMPT_CHIPS} onToggle={() => setShowChips(false)} onPick={appendToPrompt} />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedRadio
                label="模态"
                value={mode}
                onChange={(id) => setParams(id === "image" ? {} : { modality: id })}
                options={MODES.map((m) => ({ id: m.id, label: m.label }))}
              />
              {!showChips && (
                <button
                  type="button"
                  onClick={() => setShowChips(true)}
                  aria-label="显示建议"
                  className="focus-ring flex h-8 w-8 items-center justify-center rounded-[10px] border border-gray-alpha-200 text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
                >
                  <Icon path={ICONS.filter} size={15} />
                </button>
              )}
            </div>
          </div>
        }
        inputSlot={
          <div className="mt-3 stack gap-3 border-t border-gray-alpha-100 pt-3">
            {mode === "lipsync" ? (
              <div className="flex flex-wrap gap-2">
                <ReferenceSlot
                  label="虚拟形象"
                  accept="image/*"
                  onFile={uploadReference}
                  preview={reference?.url}
                />
                <ReferenceSlot label="语音" accept="audio/*" onFile={uploadReference} />
                <p className="w-full text-xs text-subtle">
                  口型同步需要把形象与音频一起发给供应商。本地适配器没有这个端点，
                  上面两个文件只会存入本地素材库，不会被提交。
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <ReferenceSlot
                    label="参考图"
                    accept="image/*"
                    onFile={uploadReference}
                    preview={reference?.url}
                  />
                  <label className="flex h-16 min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-alpha-200 px-3 text-sm text-secondary">
                    <span className="shrink-0 whitespace-nowrap">参考图 URL</span>
                    <input
                      value={referenceUrl}
                      onChange={(e) => setDraft((d) => ({ ...d, referenceUrl: e.target.value }))}
                      placeholder="https://…（供应商可访问）"
                      aria-label="参考图 URL"
                      className="focus-ring w-full bg-transparent text-sm outline-none placeholder:text-subtle"
                    />
                  </label>
                </div>
                <p className="text-xs text-subtle">
                  {reference
                    ? "本地参考图已存入素材库，但它不会被转交给供应商。"
                    : "参考图需要一个供应商能访问的 URL；本机文件只留在素材库里。"}
                </p>
              </>
            )}
          </div>
        }
        bar={
          <>
            {/* Named with the current value, not a bare 模型: the history tab
                has a filter chip with the same visible word, and two controls
                answering to the same accessible name is ambiguous for anyone
                navigating by label. */}
            <Popover
              label={modelId ? `模型：${modelId}` : "模型：未选择"}
              width="w-72"
              summary={
                <>
                  <Icon path={ICONS.model} size={14} />
                  {modelId || "选择模型"}
                </>
              }
            >
              <div className="stack gap-2">
                {modelsNote && <p className="text-xs text-subtle">{modelsNote}</p>}
                {models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, model: m, manualModel: "" }))}
                    className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      model === m ? "bg-gray-alpha-50 text-foreground" : "text-secondary hover:bg-gray-alpha-50"
                    }`}
                  >
                    <span className="truncate">{m}</span>
                    {model === m && <span className="text-xs text-subtle">当前</span>}
                  </button>
                ))}
                <label className="stack gap-1 text-xs text-subtle">
                  手动填写模型名
                  <input
                    value={manualModel}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, manualModel: e.target.value, model: "" }))
                    }
                    placeholder="model id"
                    className="focus-ring h-8 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm text-foreground outline-none"
                  />
                </label>
                <p className="text-xs text-subtle">
                  菜单里的模型名是 Provider 自己报告的；空列表时请手动填写，不要猜名字。
                </p>
              </div>
            </Popover>

            {mode === "video" && (
              <Popover
                label="时长"
                summary={
                  <>
                    <Icon path={ICONS.clock} size={14} />
                    {duration}s
                  </>
                }
              >
                <div className="stack gap-1">
                  <p className="px-2 pb-1 text-xs text-subtle">时长 · 本地可转交</p>
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDraft((x) => ({ ...x, duration: d }))}
                      className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                        duration === d ? "bg-gray-alpha-50 text-foreground" : "text-secondary hover:bg-gray-alpha-50"
                      }`}
                    >
                      <span>{d}s</span>
                      {duration === d && <span className="text-xs text-subtle">✓</span>}
                    </button>
                  ))}
                </div>
              </Popover>
            )}

            <Popover
              label={`纵横比：${aspectRatio}`}
              width="w-48"
              summary={
                <>
                  <Icon path={ICONS.ratio} size={15} />
                  {aspectRatio}
                </>
              }
            >
              <div className="stack gap-1">
                <PopoverTitle>纵横比</PopoverTitle>
                {ASPECT_RATIOS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, aspectRatio: r }))}
                    className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      aspectRatio === r
                        ? "bg-gray-alpha-100 text-foreground"
                        : "text-secondary hover:bg-gray-alpha-50"
                    }`}
                  >
                    <span>{r}</span>
                    {aspectRatio === r && <span className="text-xs text-subtle">当前</span>}
                  </button>
                ))}
                <p className="pt-1 text-xs text-subtle">
                  会随请求发给 Provider；远端是否接受这个比例未核验。
                </p>
              </div>
            </Popover>

            <Popover
              label={`分辨率：${activeResolution}`}
              width="w-48"
              summary={
                <>
                  <Icon path={ICONS.resolution} size={15} />
                  {activeResolution}
                </>
              }
            >
              <div className="stack gap-1">
                <PopoverTitle>分辨率</PopoverTitle>
                {resolutionOptions.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, resolution: r }))}
                    className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      activeResolution === r
                        ? "bg-gray-alpha-100 text-foreground"
                        : "text-secondary hover:bg-gray-alpha-50"
                    }`}
                  >
                    <span>{r}</span>
                    {activeResolution === r && <span className="text-xs text-subtle">当前</span>}
                  </button>
                ))}
                <p className="pt-1 text-xs text-subtle">
                  可选值按参考界面分模式列出；具体模型支持哪些未核验。
                </p>
              </div>
            </Popover>

            {mode === "video" && (
              <BarButton
                label={`声音：${sound ? "开启" : "关闭"}`}
                active={sound}
                onClick={() => setDraft((d) => ({ ...d, sound: !d.sound }))}
              >
                <Icon path={ICONS.sound} size={15} />
                {sound ? "开启" : "关闭"}
              </BarButton>
            )}

            {INERT.map((c) => (
              <InertBarButton key={c.label} label={c.label} reason={c.reason}>
                <Icon path={c.icon} size={15} />
                {c.label}
              </InertBarButton>
            ))}
          </>
        }
        submit={
          <>
            <UnknownCostPill note="本地无法获知金额，调用你自己的 Provider 可能收费" />
            <SubmitArrow
              label="生成"
              busy={busy || running}
              disabled={!!blocked || busy || running}
              onClick={generate}
            />
          </>
        }
        foot={
          <>
            {/* The lipsync refusal is a fact about this build, not about the
                Provider's state: there is no lipsync task type in the contract
                and no adapter path, so it holds even with a working key. It is
                stated here unconditionally for that reason — otherwise
                configuring a provider would silently hide it behind whatever
                other reason the submit is blocked by. */}
            {mode === "lipsync" && (
              <Notice tone="warn">
                本地适配器没有口型同步端点：虚拟形象与音频无法转交给 Provider，因此本页不提交口型同步。
                上面两个文件只会存入本地素材库。
              </Notice>
            )}
            {!loading && !provider && (
              <Notice tone="warn">
                尚未配置 Provider。图像与视频都会调用你的 Provider 产生费用。
                <Link to="/local/settings/providers" className="ml-1 underline">
                  去本地设置添加密钥
                </Link>
              </Notice>
            )}
            {provider?.validationState === "available" && (
              <Notice tone="info">
                模型列表来自你的 Provider（{models.length} 个）。比例、分辨率与声音会随请求一起发出去，
                但从未做过一次带密钥的调用，所以远端是否照做<b className="font-medium">未核验</b>；
                参数能否组合、是否需要审批，同样以 Provider 的返回为准。
              </Notice>
            )}
            {/* One sentence for the three inert controls: the per-control reason
                is on each button's tooltip, and repeating it three times here
                would be the noise the marker size is meant to avoid. */}
            <p className="text-xs text-subtle">
              质量、生成次数、提示词优化在提交路径里没有对应字段，保持禁用（悬停可见各自原因）。
            </p>
            <CostAcknowledgement
              checked={ackCost}
              onChange={setAckCost}
              target={provider?.baseURL}
              what="这次提交"
            />
            {/* The banner above already carries the "no provider" wording; a second
                copy of the same sentence is noise, not detail. */}
            {blocked && !providerNotice && (
              <p className="mt-1.5 text-xs text-secondary">{blocked}</p>
            )}
          </>
        }
      />
      {note && <Notice tone="error">{note}</Notice>}

      {job && (
        <section className="stack gap-2 rounded-xl border border-gray-alpha-150 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">任务 {job.status}</h2>
            <div className="flex items-center gap-2">
              {running && (
                <button
                  type="button"
                  onClick={async () => {
                    stopPolling();
                    try {
                      const r = await jobsApi.cancel(job.id);
                      setJob(r.job);
                      setNote(`已取消：${r.scope.stops}；不涉及：${r.scope.doesNot.join("、")}`);
                    } catch (err) {
                      setNote(err instanceof ApiError ? err.message : "取消失败");
                    }
                  }}
                  className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm hover:bg-gray-alpha-50"
                >
                  取消
                </button>
              )}
              {canResume && (
                <button
                  type="button"
                  onClick={() => {
                    setPolls(0);
                    void poll(job.id);
                  }}
                  className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-2.5 text-sm hover:bg-gray-alpha-50"
                >
                  重新查询
                </button>
              )}
            </div>
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
              远端仍在处理，本应用正在轮询（第 {polls} 次）。关闭页面不会丢失任务，
              远端任务 ID 就在上面，重开后可以继续查询。
            </p>
          )}
        </section>
      )}

      {result && (
        <section className="stack gap-3 rounded-xl border border-gray-alpha-150 p-5">
          <h2 className="text-sm font-medium text-foreground">产物</h2>
          {result.name.match(/\.(mp4|webm|mov)$/i) ? (
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

/* ------------------------------------------------------------- history -- */

/**
 * The 历史 body: search, the three additive filter chips the reference puts
 * above the list (130, 131), the list, and the task rows.
 *
 * Every filter option comes from a field the local store actually records. The
 * reference's chips are speculative upstream, so the honest local equivalent
 * filters on what exists here: 类型 and 来源 are real columns on `assets`, and
 * 模型 is a real field on the local job record. A chip with nothing to filter
 * is disabled and says why, rather than opening an empty menu that looks
 * broken.
 */
function MediaHistoryPanel({
  models,
  modelsNote,
  loading,
  onPickExample,
}: {
  models: string[];
  modelsNote: string | null;
  loading: boolean;
  /** Feeds a card's prompt into the composer above, which owns the draft. */
  onPickExample: (insert: string) => void;
}) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [query, setQuery] = useState("");

  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState<string[]>([]);

  const reloadAssets = useCallback(async () => {
    setAssetsLoading(true);
    try {
      const res = await assetsApi.list();
      setAssets(res.assets);
      setAssetsError(null);
    } catch (err) {
      setAssetsError(err instanceof ApiError ? err.message : "读取本地产物失败");
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadAssets();
  }, [reloadAssets]);

  // The jobs list is what makes 模型 filterable: `assets` has no model column,
  // but each local job records the model it ran with, so a generated asset can
  // be attributed to a model through the job that produced it.
  useEffect(() => {
    (async () => {
      try {
        const all = await jobsApi.list();
        setJobs(all.filter((j) => j.type === "image_generation" || j.type === "video_generation"));
      } catch {
        // The list below already reports its own read failure; a missing
        // attribution index only means 模型 cannot narrow anything.
        setJobs([]);
      }
    })();
  }, []);

  const media = useMemo(
    () => assets.filter((a) => a.mediaType.startsWith("image/") || a.mediaType.startsWith("video/")),
    [assets],
  );

  /** Model id -> the assets that job produced. Empty for an uploaded file. */
  const modelOfAsset = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of jobs) {
      if (!j.modelId) continue;
      for (const id of j.outputAssetIds) map.set(id, j.modelId);
    }
    return map;
  }, [jobs]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.filter((a) => {
      if (q && !a.displayName.toLowerCase().includes(q)) return false;
      if (typeFilter.length > 0) {
        const kind = a.mediaType.startsWith("image/") ? "图像" : "视频";
        if (!typeFilter.includes(kind)) return false;
      }
      if (sourceFilter.length > 0 && !sourceFilter.includes(a.origin)) return false;
      if (modelFilter.length > 0) {
        const m = modelOfAsset.get(a.id);
        // An asset with no producing job has no model, so it cannot satisfy a
        // model filter. Dropping it is the correct answer, not a bug to hide.
        if (!m || !modelFilter.includes(m)) return false;
      }
      return true;
    });
  }, [media, query, typeFilter, sourceFilter, modelFilter, modelOfAsset]);

  const countBy = (pick: (a: AssetRecord) => string | null) => {
    const out = new Map<string, number>();
    for (const a of media) {
      const k = pick(a);
      if (k) out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  };

  const typeCounts = countBy((a) => (a.mediaType.startsWith("image/") ? "图像" : "视频"));
  const sourceCounts = countBy((a) => a.origin);
  // Only models the provider actually reported, intersected with the ones a
  // local job recorded — an option no stored row can ever match is a filter
  // that silently does nothing, so it is not offered.
  const modelCounts = countBy((a) => modelOfAsset.get(a.id) ?? null);
  const modelOptions = models
    .filter((m) => modelCounts.has(m))
    .map((m) => ({ value: m, label: m, count: modelCounts.get(m) }));

  const SOURCE_LABELS: Record<string, string> = {
    generated: "生成",
    uploaded: "上传",
    local: "本地",
    youtube: "YouTube",
    url: "URL 导入",
  };

  const groups: FilterGroup[] = [
    {
      id: "model",
      label: "模型",
      options: modelOptions,
      emptyReason: loading
        ? "正在读取本地 Provider…"
        : modelsNote ?? (models.length === 0 ? "Provider 没有报告任何模型，无法按模型筛选。" : "本地产物里没有记录模型信息。"),
      selected: modelFilter,
      onChange: setModelFilter,
    },
    {
      id: "type",
      label: "类型",
      options: [...typeCounts].map(([value, count]) => ({ value, label: value, count })),
      emptyReason: "本地产物库里还没有图像或视频。",
      selected: typeFilter,
      onChange: setTypeFilter,
    },
    {
      id: "source",
      label: "来源",
      options: [...sourceCounts].map(([value, count]) => ({
        value,
        label: SOURCE_LABELS[value] ?? value,
        count,
      })),
      emptyReason: "本地产物库里还没有图像或视频。",
      selected: sourceFilter,
      onChange: setSourceFilter,
    },
  ];

  const filtered = matches.length !== media.length;

  return (
    <section className="stack gap-4">
      {/* The reference keeps the search field above an *empty* history (130,
          131), so this page owns the field rather than letting the list hide it
          until there is something to search. */}
      <label className="relative block">
        <span className="sr-only">搜索生成内容</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索生成内容…"
          className="focus-ring h-10 w-full rounded-xl border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
      </label>

      <FilterChips groups={groups} />

      <ArtifactList
        assets={matches}
        loading={assetsLoading}
        error={assetsError}
        onRetry={reloadAssets}
        columns
        hideSearch
        query={query}
        onQuery={setQuery}
        empty="还没有图像或视频产物。用下面的编辑器生成后会出现在这里。"
        emptySlot={
          <div className="stack gap-6">
            <p className="pt-6 text-center text-sm text-secondary">
              {filtered
                ? "没有符合当前筛选条件的产物。取消筛选可以看到全部。"
                : "生成或重混下方任一示例，即可开始使用"}
            </p>
            <ExampleGrid onPick={onPickExample} />
          </div>
        }
      />

      <JobHistory types={["image_generation", "video_generation"]} />
    </section>
  );
}

/**
 * The reference's example row (131), each card with a `+` that feeds the
 * composer. The upstream thumbnails are third-party images with no local
 * licence, so the cards are drawn as neutral placeholders and the prompt text
 * is shown instead of a picture we cannot ship — the deviation is deliberate,
 * not an omission.
 */
function ExampleGrid({ onPick }: { onPick: (insert: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PROMPT_CHIPS.map((c) => (
        <article
          key={c.id}
          className="relative overflow-hidden rounded-xl border border-gray-alpha-150 bg-gray-alpha-50"
        >
          <button
            type="button"
            onClick={() => onPick(c.insert)}
            aria-label={`用示例「${c.label}」填入描述`}
            className="focus-ring absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-gray-alpha-200 bg-background text-foreground shadow-natural-xs transition-colors hover:bg-gray-alpha-50"
          >
            <Icon path={ICONS.plus} size={14} />
          </button>
          <div className="flex h-32 items-end p-3">
            <p className="text-xs text-secondary">{c.insert}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- pieces -- */

function ReferenceSlot({
  label,
  accept,
  onFile,
  preview,
}: {
  label: string;
  accept: string;
  onFile: (f: File) => void;
  preview?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="focus-ring flex h-16 w-28 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-gray-alpha-200 text-xs text-secondary transition-colors hover:bg-gray-alpha-50"
      >
        {preview ? (
          <img src={preview} alt={label} className="h-full w-full object-cover" />
        ) : (
          <>
            <Icon path={label === "语音" ? ICONS.sound : ICONS.ratio} size={16} />
            {label}
          </>
        )}
      </button>
    </>
  );
}
