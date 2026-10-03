import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type AssetRecord,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";
import { ArtifactList } from "@/features/media/ArtifactList";
import { useMediaDraft } from "@/features/media/drafts";
import {
  BarButton,
  Composer,
  CostAcknowledgement,
  ICONS,
  Icon,
  InertBarButton,
  Notice,
  Popover,
  PopoverTitle,
  PromptChips,
  Slider,
  SubmitArrow,
  TabStrip,
  UnknownCostPill,
} from "@/features/media/ui";
import { Toggle } from "@/features/shared/Modal";
import { JobHistory } from "@/features/media/MusicPage";

/* ==========================================================================
   Sound effects.

   Per SCOPE.md this is the user's own generation only. The upstream sound
   marketplace, licensing sales and public publishing are out of scope, so the
   探索 tab reads the local store instead and says so.

   Reference shape (088–092): a pill tab strip, a result panel, and one
   composer docked across all three tabs. Its bar is, in order, 循环 / 时长 /
   提示词影响 / 自动优化, then the cost statement and the submit arrow; 时长 is
   a panel with an 自动 switch over a bare track, and 提示词影响 is a panel
   with a 低→高 scale over a filled track.

   Duration and encoding limits upstream are plan-dependent and have not been
   verified, so the page states its own local range and lets the provider be
   the authority on the rest.
   ========================================================================== */

export type SfxTab = "explore" | "history" | "favorites";

const TABS: { id: SfxTab; to: string; label: string }[] = [
  { id: "explore", to: "/app/sound-effects", label: "探索" },
  { id: "history", to: "/app/sound-effects/history", label: "历史" },
  { id: "favorites", to: "/app/sound-effects/favorites", label: "收藏" },
];

/** The widest range this UI will send. The real cap may be lower on a given plan. */
const LOCAL_DURATION_RANGE = { min: 0.5, max: 60 };

/**
 * Prompt fragments, not upstream magic. Each chip inserts text the user can
 * read and edit; nothing here rewrites the request behind their back.
 *
 * The labels are the reference's own, which upstream leaves in English even in
 * the Chinese locale — they are part of the composer's look, not a translation
 * gap on our side.
 */
const PROMPT_CHIPS = [
  { id: "qualities", label: "Add sound qualities", insert: ", high quality, detailed, close-mic" },
  { id: "duration", label: "Specify duration", insert: ", 5 second clip" },
  { id: "context", label: "Add context", insert: ", recorded indoors, wide stereo field" },
];

interface Draft {
  prompt: string;
  /** 自动 leaves the duration out of the request instead of guessing one. */
  autoDuration: boolean;
  duration: number;
  influence: number;
  loop: boolean;
  format: "mp3" | "opus";
}

const EMPTY_DRAFT: Draft = {
  prompt: "",
  // The reference composer opens on 自动, so the first render matches it.
  autoDuration: true,
  duration: 5,
  influence: 0.3,
  loop: false,
  format: "mp3",
};

interface Result {
  jobId: string;
  url: string;
  name: string;
}

const SEARCH_PLACEHOLDER: Record<SfxTab, string> = {
  explore: "搜索音效…",
  history: "搜索音效历史记录…",
  favorites: "搜索音效历史记录…",
};

export function SfxPage({ tab }: { tab: SfxTab }) {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [draft, setDraft] = useMediaDraft<Draft>("sfx", EMPTY_DRAFT);
  const [ackCost, setAckCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(true);
  const [showChips, setShowChips] = useState(true);

  const { prompt, autoDuration, duration, influence, loop, format } = draft;

  useEffect(() => {
    (async () => {
      try {
        const list = await providersApi.list();
        setProvider(list.find((p) => p.validationState === "available") ?? list[0] ?? null);
      } catch {
        setProvider(null);
      } finally {
        setProviderLoading(false);
      }
    })();
  }, []);

  const reloadAssets = useCallback(async () => {
    try {
      const res = await assetsApi.list();
      setAssets(res.assets.filter((a) => a.mediaType.startsWith("audio/")));
      setAssetsError(null);
    } catch (err) {
      setAssetsError(err instanceof ApiError ? err.message : "读取本地音频失败");
    }
  }, []);

  useEffect(() => {
    void reloadAssets();
  }, [reloadAssets]);

  const durationState = useMemo(() => {
    if (autoDuration) return { level: "auto" as const, text: "自动：由 Provider 决定长度" };
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
  }, [autoDuration, duration]);

  /**
   * True when the amber banner is already on screen. It then carries the same
   * wording the `blocked` line would, so that line is suppressed rather than
   * printed twice.
   */
  const providerNotice = !providerLoading && !provider;

  const blocked = useMemo(() => {
    if (providerLoading) return "正在读取本地 Provider…";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (!ackCost) return "请先勾选下方的费用确认";
    if (!prompt.trim()) return "请输入音效描述";
    if (durationState.level === "over") return durationState.text;
    return null;
  }, [providerLoading, provider, ackCost, prompt, durationState]);

  const intentId = useMemo(
    () =>
      `sfx:${provider?.id ?? "none"}:${autoDuration ? "auto" : duration}:${loop ? 1 : 0}:${format}:${prompt.trim()}`,
    [provider?.id, autoDuration, duration, loop, format, prompt],
  );

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
          // 自动 deliberately omits the field: a made-up number is not "auto".
          ...(autoDuration ? {} : { durationSeconds: duration }),
          promptInfluence: influence,
          loop,
          // Recorded locally only: the runner's sound_generation dispatch has no
          // field for either of these, so they never reach the provider.
          outputFormat: format,
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
      if (out.asset) {
        const r = { jobId: out.job.id, url: out.asset.url, name: out.asset.displayName };
        setResult(r);
        void reloadAssets();
      } else if (out.reason) {
        setNote(out.reason);
      }
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  function appendToPrompt(fragment: string) {
    setDraft((d) => ({ ...d, prompt: d.prompt.trim() ? `${d.prompt.trim()}${fragment}` : fragment.trim() }));
  }

  const listProps = {
    assets,
    error: assetsError ?? undefined,
    onRetry: reloadAssets,
    searchPlaceholder: SEARCH_PLACEHOLDER[tab],
  };

  return (
    <div className="stack gap-6">
      <TabStrip tabs={TABS.map((t) => ({ to: t.to, label: t.label, active: t.id === tab }))} />

      {tab === "explore" && (
        <section className="stack gap-3">
          <Notice tone="info">
            原站的「探索」是其他用户公开发布的音效库。平台公共发布与商业销售按范围裁剪移除，
            这里的探索只列本机生成的音频。
          </Notice>
          <ArtifactList
            {...listProps}
            columns
            empty="还没有本机音效。用下面的编辑器生成一次就会出现在这里。"
          />
        </section>
      )}

      {tab === "history" && (
        <section className="stack gap-4">
          <ArtifactList
            {...listProps}
            columns
            empty="还没有音效。用下面编辑器生成后会出现在这里。"
          />
          <JobHistory types={["sound_generation"]} />
        </section>
      )}

      {tab === "favorites" && (
        <section className="stack gap-3">
          <ArtifactList
            {...listProps}
            columns
            onlyFavourites
            empty="还没有收藏的音效。在历史页点星标即可收藏，收藏记录保存在本机。"
          />
        </section>
      )}

      <Composer
        label="音效提示词"
        docked
        prompt={prompt}
        onPrompt={(v) => setDraft((d) => ({ ...d, prompt: v }))}
        placeholder="用英语描述一种音效…"
        hint={
          showHint ? (
            <>
              <Icon path={ICONS.warn} size={13} className="shrink-0 text-secondary" />
              <span className="text-foreground">
                为获得最佳效果，请用英语描述你想要的音效。更多语言即将推出。
              </span>
              <button
                type="button"
                onClick={() => setShowHint(false)}
                className="focus-ring shrink-0 rounded text-secondary underline-offset-2 hover:underline"
              >
                关闭
              </button>
            </>
          ) : null
        }
        chips={
          <PromptChips
            chips={PROMPT_CHIPS}
            hidden={!showChips}
            onToggle={() => setShowChips((v) => !v)}
            onPick={(insert) => appendToPrompt(insert.startsWith(",") ? insert : `, ${insert}`)}
          />
        }
        bar={
          <>
            <BarButton
              label={`循环：${loop ? "开启" : "关闭"}`}
              active={loop}
              onClick={() => setDraft((d) => ({ ...d, loop: !d.loop }))}
            >
              <Icon path={ICONS.loop} size={15} />
              {loop ? "开启" : "关闭"}
            </BarButton>

            <Popover
              label={`时长：${autoDuration ? "自动" : `${duration}s`}`}
              active={!autoDuration}
              summary={
                <>
                  <Icon path={ICONS.clock} size={15} />
                  {autoDuration ? "自动" : `${duration}s`}
                </>
              }
            >
              <div className="stack gap-3">
                <div className="flex items-center justify-between gap-3">
                  <PopoverTitle>时长</PopoverTitle>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-secondary">自动</span>
                    <Toggle
                      checked={autoDuration}
                      onChange={(v) => setDraft((d) => ({ ...d, autoDuration: v }))}
                      label="时长自动"
                    />
                  </div>
                </div>
                <Slider
                  title="时长"
                  value={duration}
                  min={LOCAL_DURATION_RANGE.min}
                  max={LOCAL_DURATION_RANGE.max}
                  step={0.5}
                  disabled={autoDuration}
                  onChange={(v) => setDraft((d) => ({ ...d, duration: v, autoDuration: false }))}
                />
                <p
                  className={`text-xs ${
                    durationState.level === "over"
                      ? "text-red-700"
                      : durationState.level === "at"
                        ? "text-amber-700"
                        : "text-subtle"
                  }`}
                >
                  {durationState.text}。上限随 Provider 账户方案而变，本地未核验，
                  真正的上限以 Provider 返回的错误为准。
                </p>
              </div>
            </Popover>

            <Popover
              label={`提示词影响：${Math.round(influence * 100)}%`}
              summary={
                <>
                  <Icon path={ICONS.gauge} size={15} />
                  {Math.round(influence * 100)}%
                </>
              }
            >
              <div className="stack gap-3">
                <PopoverTitle>提示词影响</PopoverTitle>
                <Slider
                  title="提示词影响"
                  value={influence}
                  min={0}
                  max={1}
                  step={0.01}
                  bubble={`${Math.round(influence * 100)}%`}
                  ends={["低", "高"]}
                  onChange={(v) => setDraft((d) => ({ ...d, influence: v }))}
                />
                <p className="text-xs text-subtle">
                  越高越贴合描述，越低越自由发挥。取值范围来自界面控件，未经真实 API 核验。
                </p>
              </div>
            </Popover>

            <InertBarButton
              label="提示词优化"
              reason="本地适配器的音效提交路径里没有提示词优化字段，勾选它不会改变发给 Provider 的内容"
            >
              <Icon path={ICONS.wand} size={15} />
              开启
            </InertBarButton>

            <Popover
              label={`输出格式：${format.toUpperCase()}（未转交）`}
              summary={
                <>
                  <Icon path={ICONS.format} size={15} />
                  {format.toUpperCase()}
                  <span className="whitespace-nowrap text-[10px] leading-none text-subtle">未转交</span>
                </>
              }
            >
              <div className="stack gap-2">
                {(["mp3", "opus"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, format: f }))}
                    className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      format === f ? "bg-gray-alpha-100 text-foreground" : "text-secondary hover:bg-gray-alpha-50"
                    }`}
                  >
                    <span>{f === "mp3" ? "MP3（标准）" : "Opus（高质量）"}</span>
                    {format === f && <span className="text-xs text-subtle">当前</span>}
                  </button>
                ))}
                <p className="text-xs text-subtle">
                  格式会写进本地任务记录。本地适配器目前不把该字段转交给 Provider，
                  产物的真实编码以 Provider 返回为准。
                </p>
              </div>
            </Popover>
          </>
        }
        submit={
          <>
            <UnknownCostPill note="本地无法获知金额，调用你自己的 Provider 可能收费" />
            <SubmitArrow
              label="生成音效"
              busy={busy}
              disabled={!!blocked || busy}
              onClick={generate}
            />
          </>
        }
        foot={
          <>
            {!providerLoading && !provider && providerNotice && (
              <Notice tone="warn">
                尚未配置 Provider。音效生成会调用你的 Provider 产生费用。
                <Link to="/local/settings/providers" className="ml-1 underline">
                  去本地设置添加密钥
                </Link>
              </Notice>
            )}
            <CostAcknowledgement
              checked={ackCost}
              onChange={setAckCost}
              target={provider?.baseURL}
              what="这次提交"
            />
            {/* Both reasons in one line; each control's tooltip has the detail. */}
            <p className="text-xs text-subtle">
              提示词优化在提交路径里没有对应字段，保持禁用；输出格式会写进本地任务记录，
              但不转交给 Provider。
            </p>
                        {/* The banner above already carries the "no provider" wording. */}
            {blocked && !providerNotice && (
              <p className="mt-1.5 text-xs text-secondary">{blocked}</p>
            )}
          </>
        }
      />

      {note && <Notice tone="error">{note}</Notice>}

      {result && (
        <section className="mx-auto w-full max-w-[680px] stack gap-3 rounded-xl border border-gray-alpha-150 p-4">
          <h2 className="text-sm font-medium text-foreground">产物</h2>
          <audio controls src={result.url} className="w-full" />
          <a href={result.url} download={result.name} className="focus-ring w-fit text-sm underline">
            下载 {result.name}
          </a>
        </section>
      )}

      {job && (
        <p className="text-center text-xs text-secondary">
          最近一次任务：{job.status}
          {job.error ? ` — ${job.error.safeMessage}（${job.error.submissionCertainty}）` : ""}
        </p>
      )}
    </div>
  );
}
