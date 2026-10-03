import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ArtifactList, useFavourites } from "@/features/media/ArtifactList";
import { useMediaDraft } from "@/features/media/drafts";
import {
  Composer,
  CostAcknowledgement,
  ICONS,
  Icon,
  Notice,
  Popover,
  PopoverTitle,
  PromptChips,
  SegmentedRadio,
  SubmitArrow,
  TabLink,
  TabStrip,
  UnknownCostPill,
} from "@/features/media/ui";
import { Toggle } from "@/features/shared/Modal";

/* ==========================================================================
   Music.

   Scope decision that shapes this page: the upstream default tab is 市场 —
   a marketplace of licensed tracks, with filters by 类型 / 乐器 / 情绪, a
   per-row 时长 / BPM, and a footer telling users to upgrade for downloads and
   commercial use. All of that is a commercial surface, so SCOPE.md removes
   it and routes the main entry to the composer instead. 已发布 is the public
   publishing route and is removed for the same reason.

   What survives is the creative half (079/080): a model/finetune row above
   the prompt card, a 提示词 / 歌词 / 参考 switch, the lyric toggle, the
   suggestion row, and a bar of 时长 + 变体 + cost + 生成. 参考 has no local
   capability, so it is absent rather than present and inert.

   Cost: the upstream composer shows a credits pill. Credits are an upstream
   account concept, so it is replaced with an explicit "费用未知" statement
   plus the acknowledgement the rest of this build uses. Removing the credits
   UI is not a licence to hide that a real provider call costs something.
   ========================================================================== */

/** Main tabs, then the quieter right-hand link the reference carries. */
const TABS = [
  { to: "/app/music", label: "生成" },
  { to: "/app/music/history", label: "历史" },
  { to: "/app/music/saved", label: "已保存" },
];

const PROMPT_CHIPS = [
  { id: "euphoric", label: "Upbeat Pop Anthem", insert: "upbeat pop anthem, bright synth lead" },
  { id: "ballad", label: "Melancholy Piano Ballad", insert: "melancholy piano ballad, sparse arrangement" },
  { id: "edm", label: "Driving Electronic Track", insert: "driving electronic track, four on the floor" },
];

/**
 * The reference duration menu (077), in the reference order. The reference
 * prints the menu entries as `30s / 1m / 2m` while the closed button reads
 * `1:00`, so each entry carries both spellings rather than reusing one.
 */
const DURATIONS: { id: string; label: string; menu: string; seconds: number | null }[] = [
  { id: "auto", label: "Auto", menu: "Auto", seconds: null },
  { id: "30s", label: "0:30", menu: "30s", seconds: 30 },
  { id: "1m", label: "1:00", menu: "1m", seconds: 60 },
  { id: "2m", label: "2:00", menu: "2m", seconds: 120 },
  { id: "4m", label: "4:00", menu: "4m", seconds: 240 },
  { id: "6m", label: "6:00", menu: "6m", seconds: 360 },
];

const VARIANTS = [1, 2, 3, 4];

/**
 * Model names observed in the reference menu. The local adapter implements no
 * music task at all, so these are labels for an honest refusal rather than a
 * claim that the local build can serve them.
 */
const MODELS = [
  { id: "music_v1", label: "Music v1", hint: "原始模型，即将弃用" },
  { id: "music_v2", label: "Music v2", hint: "质量更高，更贴合提示词" },
  { id: "music_v2_5", label: "Music v2.5", hint: "最先进的模型" },
];

interface Draft {
  prompt: string;
  lyrics: string;
  /**
   * The reference's 包含歌词 switch (078, 080). Turning it off is the spec's
   * 纯器乐: the track gets no vocal at all. 自动 / 自定义 are the two states of
   * the same switch, derived from whether words were actually written, so this
   * is a decision rather than a second control.
   */
  includeLyrics: boolean;
  model: string;
  duration: string;
  variants: number;
  customSeconds: number;
}

const EMPTY_DRAFT: Draft = {
  prompt: "",
  lyrics: "",
  includeLyrics: true,
  model: "music_v2",
  duration: "1m",
  variants: 2,
  customSeconds: 90,
};

export function MusicPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") === "saved" ? "saved" : "generate";

  return (
    <div className="stack gap-6">
      <TabStrip
        tabs={TABS.map((t) => ({ ...t, active: t.label === (tab === "saved" ? "已保存" : "生成") }))}
        trailing={<TabLink to="/app/music/finetunes" label="微调" />}
      />

      {tab === "generate" ? <ComposerPanel /> : <SavedTracks />}

      <p className="text-center text-xs text-subtle">
        市场 / 已发布（商业曲目销售与平台公开发布）按范围裁剪移除，本地不提供这些入口。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ composer -- */

function ComposerPanel() {
  const [draft, setDraft] = useMediaDraft<Draft>("music", EMPTY_DRAFT);
  const [ackCost, setAckCost] = useState(false);
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [field, setField] = useState<"prompt" | "lyrics">("prompt");

  const { prompt, lyrics, includeLyrics, model, duration, variants, customSeconds } = draft;
  const modelDef = MODELS.find((m) => m.id === model) ?? MODELS[1];
  const durationDef = DURATIONS.find((d) => d.id === duration) ?? DURATIONS[2];
  const durationSeconds = duration === "custom" ? customSeconds : durationDef.seconds;
  // The three captions the reference prints beside the 包含歌词 switch. Derived,
  // so the label can never disagree with what would actually be submitted.
  const lyricsMode = !includeLyrics ? "纯器乐" : lyrics.trim() ? "自定义" : "自动";

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

  /**
   * Music generation follows the documented POST /v1/music/compose: prompt or
   * composition_plan, music_length_ms, model_id. It is 文档验证 only — no
   * authenticated call has been made, the endpoint is paid-tier, and page
   * parameters without a documented field (variants, lyricsMode) stay in the
   * local job record instead of being invented upstream.
   */
  const blocked = !prompt.trim() && !lyrics.trim()
    ? "请输入描述，或切换到「歌词」直接写词"
    : !provider
      ? "尚未配置 Provider"
      : includeLyrics && lyricsMode === "自定义" && lyrics.trim() && durationSeconds === null
        ? "自定义歌词需要确定时长（composition plan 按文档携带 durationMs）"
        : null;

  async function submit() {
    if (!provider) return;
    setBusy(true);
    setNote(null);
    try {
      const created = await jobsApi.create({
        intentId: `music:${provider.id}:${model}:${duration}:${variants}:${includeLyrics ? 1 : 0}:${prompt.trim()}:${lyrics.trim()}`,
        type: "music_generation",
        providerId: provider.id,
        modelId: model,
        credentialRef: provider.id,
        input: {
          prompt: prompt.trim(),
          // 纯器乐 (includeLyrics off) means no vocal line at all, so the
          // written lyrics are not part of the request either.
          lyrics: lyricsMode === "自定义" ? lyrics.trim() : null,
          lyricsMode,
          includeLyrics,
          ...(durationSeconds === null ? {} : { durationSeconds }),
          variants,
          acknowledgeUnknownCost: ackCost,
        },
      });
      setJob(created.job);
      if (!created.created) {
        setNote("这次提交之前已经存在，已复用同一个任务，不会重复计费。");
        return;
      }
      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      setNote(out.reason ?? out.asset?.displayName ?? null);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="stack gap-3">
        <Notice tone="warn">
          音乐生成按官方文档 POST /v1/music/compose 实现（文档验证；该端点为付费档位，未经真实调用核验）。
          仅发送文档字段：描述（或自定义歌词组成的 composition plan）、时长、模型；
          变体数与歌词模式没有公开字段，保留在本地任务记录中，不会编造上传。
        </Notice>
        <div className="flex flex-wrap items-center gap-2">
          <Popover
            label="音乐模型"
            width="w-72"
            bordered
            summary={
              <>
                <Icon path={ICONS.model} size={15} />
                {modelDef.label}
              </>
            }
          >
            <div className="stack gap-1">
              <p className="px-2 pb-1 text-xs text-subtle">模型 · 均未核验</p>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, model: m.id }))}
                  className={`focus-ring rounded-lg px-2 py-1.5 text-left transition-colors ${
                    m.id === model ? "bg-gray-alpha-50" : "hover:bg-gray-alpha-50"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm text-foreground">
                    {m.label}
                    {m.id === model && <span className="text-xs">✓</span>}
                  </span>
                  <span className="block text-xs text-subtle">{m.hint}</span>
                </button>
              ))}
              <p className="px-2 pt-1 text-xs text-subtle">
                模型名来自参考界面；本地适配器未实现音乐任务，选择模型不会改变结果。
              </p>
            </div>
          </Popover>

          <Link
            to="/app/music/finetunes"
            className="focus-ring flex h-8 items-center gap-1.5 rounded-lg border border-gray-alpha-200 bg-background px-2.5 text-[13px] text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
          >
            <Icon path={ICONS.wand} size={15} />
            暂无微调
          </Link>
        </div>

        <Composer
          label="音乐描述"
          docked
          prompt={field === "prompt" ? prompt : lyrics}
          onPrompt={(v) =>
            setDraft((d) => (field === "prompt" ? { ...d, prompt: v } : { ...d, lyrics: v }))
          }
          placeholder={
            field === "prompt"
              ? "描述你想创作的歌曲…"
              : "开始输入以使用自定义歌词…"
          }
          chips={
            <SegmentedRadio
              label="输入类型"
              value={field}
              onChange={setField}
              options={[
                { id: "prompt", label: "提示词" },
                { id: "lyrics", label: "歌词" },
              ]}
            />
          }
          inputSlot={
            <div className="mt-2 stack gap-3">
              {field === "prompt" && (
                <PromptChips
                  chips={PROMPT_CHIPS}
                  onPick={(insert) =>
                    setDraft((d) => ({
                      ...d,
                      prompt: d.prompt.trim() ? `${d.prompt.trim()}, ${insert}` : insert,
                    }))
                  }
                />
              )}
              {field === "lyrics" && (
                <div className="stack gap-2">
                  {/* The reference has one control here: the 包含歌词 switch with
                      a mode caption beside it (078, 080). The caption is derived
                      from what the user actually did rather than being a second
                      switch, because 自动/自定义/纯器乐 are the three states of
                      that one decision. */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-secondary">歌词</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-subtle">{lyricsMode}</span>
                      <Toggle
                        checked={includeLyrics}
                        onChange={(v) => setDraft((d) => ({ ...d, includeLyrics: v }))}
                        label="包含歌词（自动或自定义）。纯音乐请关闭。"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-subtle">
                    {includeLyrics
                      ? lyricsMode === "自定义"
                        ? "已填写的歌词会随请求一起记录；留空则由 Provider 自行写词。"
                        : "关闭上面的开关即为纯器乐：本次不提交任何歌词，只用描述来生成。"
                      : "纯器乐：本次不提交任何歌词，只用描述来生成。"}
                  </p>
                </div>
              )}
              <p className="mt-2 text-xs text-subtle">
                「参考」是原站按引用音频继续生成的入口；本地没有对应能力，因此这里不提供该控件。
              </p>
            </div>
          }
        bar={
          <>
            <Popover
              label={`时长：${duration === "custom" ? `${customSeconds}s` : durationDef.label}`}
              summary={
                <>
                  <Icon path={ICONS.clock} size={15} />
                  {duration === "custom" ? `${customSeconds}s` : durationDef.label}
                </>
              }
            >
              <div className="stack gap-1">
                <PopoverTitle>时长</PopoverTitle>
                {DURATIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDraft((x) => ({ ...x, duration: d.id }))}
                    className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      duration === d.id
                        ? "bg-gray-alpha-100 text-foreground"
                        : "text-secondary hover:bg-gray-alpha-50"
                    }`}
                  >
                    <span>{d.menu}</span>
                    {duration === d.id && <span className="text-xs text-subtle">当前</span>}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDraft((x) => ({ ...x, duration: "custom" }))}
                  className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    duration === "custom"
                      ? "bg-gray-alpha-100 text-foreground"
                      : "text-secondary hover:bg-gray-alpha-50"
                  }`}
                >
                  <span>自定义</span>
                  {duration === "custom" && <span className="text-xs text-subtle">当前</span>}
                </button>
                {duration === "custom" && (
                  <label className="mt-1 flex items-center gap-2 px-2 text-xs text-secondary">
                    秒
                    <input
                      type="number"
                      min={10}
                      max={600}
                      value={customSeconds}
                      onChange={(e) =>
                        setDraft((x) => ({ ...x, customSeconds: Number(e.target.value) || 10 }))
                      }
                      className="focus-ring w-20 rounded-lg border border-gray-alpha-150 bg-background px-2 py-1 text-sm"
                    />
                  </label>
                )}
                <p className="pt-1 text-xs text-subtle">
                  Auto 表示不传时长，由 Provider 决定；其余取值未经真实 API 核验。
                </p>
              </div>
            </Popover>

            <Popover
              label={`变体：${variants}`}
              summary={
                <>
                  <Icon path={ICONS.layers} size={15} />
                  {variants}
                </>
              }
            >
              <div className="stack gap-1">
                <PopoverTitle>变体</PopoverTitle>
                {VARIANTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, variants: n }))}
                    className={`focus-ring flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      variants === n
                        ? "bg-gray-alpha-100 text-foreground"
                        : "text-secondary hover:bg-gray-alpha-50"
                    }`}
                  >
                    <span>{n}</span>
                    {variants === n && <span className="text-xs text-subtle">当前</span>}
                  </button>
                ))}
                <p className="pt-1 text-xs text-subtle">
                  变体数量会写进本地任务记录；一次提交仍只产生一次 Provider 调用。
                </p>
              </div>
            </Popover>
          </>
        }
        submit={
          <>
            <UnknownCostPill note="本地无法获知金额，调用你自己的 Provider 可能收费" />
            <SubmitArrow label="生成" busy={busy} disabled={!!blocked || busy} onClick={submit} />
          </>
        }
        foot={
          <>
            <CostAcknowledgement
              checked={ackCost}
              onChange={setAckCost}
              target={provider?.baseURL}
              what="这次生成"
            />
            {blocked && <p className="mt-1.5 text-xs text-secondary">{blocked}</p>}
          </>
        }
      />
      </div>

      <div className="stack gap-3">
        <ProjectHistory />

        {providerLoading && <p className="text-xs text-secondary">正在读取本地 Provider…</p>}
        {note && <Notice tone="error">{note}</Notice>}

        {job && (
          <p className="text-xs text-secondary">
            任务 {job.status}
            {job.error ? ` — ${job.error.safeMessage}（${job.error.submissionCertainty}）` : ""}
          </p>
        )}

        <p className="text-xs text-subtle">
          需要一个支持音乐生成的 Provider。
          <Link to="/local/settings/providers" className="ml-1 underline">
            查看已配置的 Provider
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- project history -- */

/**
 * The reference's 项目历史 panel: a search box, a sort order, four filter
 * chips and an empty state that names the action which fills it. Every chip
 * here filters the local job store — none of them pretends to reach a cloud
 * project list.
 */
function ProjectHistory() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [favOnly, setFavOnly] = useState(false);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [source, setSource] = useState("");
  const fav = useFavourites();

  const load = useCallback(async () => {
    try {
      setJobs(await jobsApi.list());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取任务失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sources = useMemo(() => Array.from(new Set(jobs.map((j) => j.providerId))), [jobs]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = jobs.filter((j) => j.type === "music_generation");
    if (q) list = list.filter((j) => `${j.id} ${j.modelId ?? ""} ${j.status}`.toLowerCase().includes(q));
    if (favOnly) list = list.filter((j) => fav.ids.includes(j.id));
    if (after) list = list.filter((j) => j.createdAt >= new Date(after).toISOString());
    if (before) {
      const end = new Date(before);
      end.setHours(23, 59, 59, 999);
      list = list.filter((j) => j.createdAt <= end.toISOString());
    }
    if (source) list = list.filter((j) => j.providerId === source);
    return [...list].sort((a, b) =>
      sort === "new" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
    );
  }, [jobs, query, favOnly, after, before, source, sort, fav.ids]);

  return (
    <section className="stack gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索项目历史"
          aria-label="搜索项目历史"
          className="focus-ring h-9 min-w-0 flex-1 rounded-xl border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "new" | "old")}
          aria-label="排序"
          className="focus-ring h-9 rounded-xl border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
        >
          <option value="new">最新在前</option>
          <option value="old">最早在前</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={favOnly} onClick={() => setFavOnly((v) => !v)} label="收藏" />
        <DateChip label="创建时间晚于" value={after} onChange={setAfter} />
        <DateChip label="创建时间早于" value={before} onChange={setBefore} />
        {sources.length > 0 && (
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="来源"
            className="focus-ring h-8 rounded-lg border border-gray-alpha-200 bg-transparent px-2 text-xs text-secondary outline-none"
          >
            <option value="">来源</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="stack gap-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-alpha-50" />
          ))}
        </div>
      ) : error ? (
        <div className="stack gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>读取项目历史失败：{error}</p>
          <button
            type="button"
            onClick={load}
            className="focus-ring w-fit rounded-[10px] border border-red-300 px-2.5 py-1 text-xs hover:bg-red-100"
          >
            重试
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-secondary">
          {jobs.some((j) => j.type === "music_generation")
            ? "没有符合当前筛选条件的项目。"
            : "提交提示词以开始第一个项目。"}
        </p>
      ) : (
        <ul className="divide-y divide-gray-alpha-100 overflow-hidden rounded-xl border border-gray-alpha-150">
          {rows.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="font-mono text-xs text-subtle">{j.id.slice(0, 8)}</span>
              <span className="text-foreground">{j.modelId ?? "未指定模型"}</span>
              <span className="rounded-full bg-gray-alpha-100 px-2 py-0.5 text-xs text-foreground">
                {j.status}
              </span>
              <span className="ml-auto text-xs text-secondary">
                {j.createdAt.slice(0, 19).replace("T", " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring h-8 rounded-lg border px-2.5 text-xs transition-colors ${
        active
          ? "border-gray-350 bg-gray-alpha-100 text-foreground"
          : "border-gray-alpha-200 text-secondary hover:bg-gray-alpha-50"
      }`}
    >
      {active ? `✓ ${label}` : `+ ${label}`}
    </button>
  );
}

function DateChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-alpha-200 px-2.5 text-xs text-secondary">
      {value ? "✓ " : "+ "}
      {label}
      <input
        type="date"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring w-24 bg-transparent text-xs outline-none"
      />
    </label>
  );
}

/* --------------------------------------------------- saved / finetunes -- */

function SavedTracks() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await assetsApi.list();
      setAssets(res.assets.filter((a) => a.mediaType.startsWith("audio/")));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取本地产物失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="stack gap-3">
      <ArtifactList
        onlyFavourites
        assets={assets}
        loading={loading}
        error={error}
        onRetry={load}
        empty="还没有保存任何歌曲。生成后点星标即可保存，方便下次找到。"
      />
      <p className="text-xs text-subtle">
        已保存按本地收藏标记统计，不会上传到任何账户。音乐生成已按文档接入（未核验），
        这里列出你在本地收藏的音频。
      </p>
    </section>
  );
}

export function MusicSavedPage() {
  return (
    <div className="stack gap-6">
      <TabStrip
        tabs={TABS.map((t) => ({ ...t, active: t.to === "/app/music/saved" }))}
        trailing={<TabLink to="/app/music/finetunes" label="微调" />}
      />
      <SavedTracks />
    </div>
  );
}

export function MusicHistoryPage() {
  return (
    <div className="stack gap-6">
      <TabStrip
        tabs={TABS.map((t) => ({ ...t, active: t.to === "/app/music/history" }))}
        trailing={<TabLink to="/app/music/finetunes" label="微调" />}
      />
      <JobHistory types={["music_generation"]} />
    </div>
  );
}

export function MusicFinetunesPage() {
  return (
    <div className="stack gap-6">
      <TabStrip
        tabs={TABS.map((t) => ({ ...t, active: false }))}
        trailing={<TabLink to="/app/music/finetunes" label="微调" />}
      />
      <FinetunesPanel />
    </div>
  );
}

/**
 * Upstream this route is nothing but a subscription wall (084: 升级以创建
 * Finetunes, with Creator / Pro / Scale / Business pricing). Pricing and
 * upgrades are removed by SCOPE, so what is left has to be the real blocker
 * instead: there is no verified training endpoint. The column headers are the
 * reference's own minus 创作者, which in an account-less local build would
 * always name the same person and so carries no information.
 */
function FinetunesPanel() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await assetsApi.list();
    setAssets(res.assets.filter((a) => a.mediaType.startsWith("audio/")));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack gap-4">
      <Notice tone="warn">
        本地没有已核验的音乐微调训练端点，也没有审核流程，因此不会代为提交。
        原站在这一页展示的套餐与升级引导按范围裁剪移除。
      </Notice>

      <label className="stack gap-1.5 text-sm">
        <span className="text-secondary">训练样本（先存入本地素材库{busy ? "，上传中…" : ""}）</span>
        <input
          type="file"
          accept="audio/*"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              await assetsApi.upload(f);
              setNote(`${f.name} 已存入素材库。`);
              await load();
            } catch (err) {
              setNote(err instanceof ApiError ? err.message : "上传失败");
            } finally {
              setBusy(false);
            }
          }}
          className="focus-ring text-sm file:mr-3 file:rounded-[10px] file:border-0 file:bg-gray-alpha-100 file:px-3 file:py-1.5"
        />
      </label>

      {note && <p className="text-sm text-secondary">{note}</p>}

      <button
        type="button"
        disabled
        title="微调训练需要供应商侧的训练端点与审核流程，尚未核验"
        className="focus-ring w-fit cursor-not-allowed rounded-[10px] bg-gray-300 px-4 py-2 text-sm font-medium text-white"
      >
        开始微调（未核验）
      </button>

      {assets.length > 0 && <ArtifactList title="可用样本" assets={assets} empty="" />}

      <div className="flex items-center gap-3 border-b border-gray-alpha-150 pb-2 text-xs text-secondary">
        <span className="flex-1">标题</span>
        <span className="w-24">标签</span>
        <span className="w-20">状态</span>
        <span className="w-28">用于提示词</span>
        <span className="w-20">已加书签</span>
        <span className="w-16 text-right">操作</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- shared -- */

/**
 * Local job list. Exported because the sfx and media history pages show the
 * same rows for their own task types.
 */
export function JobHistory({ types }: { types: string[] }) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await jobsApi.list();
      setJobs(all.filter((j) => types.includes(j.type)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取任务失败");
    } finally {
      setLoading(false);
    }
  }, [types]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [jobs],
  );

  if (loading) return <p className="text-sm text-secondary">读取任务…</p>;

  if (error) {
    return (
      <div className="stack gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <p>读取任务失败：{error}</p>
        <button
          type="button"
          onClick={load}
          className="focus-ring w-fit rounded-[10px] border border-red-300 px-2.5 py-1 text-xs hover:bg-red-100"
        >
          重试
        </button>
      </div>
    );
  }

  if (rows.length === 0) return <p className="text-sm text-secondary">还没有记录。</p>;

  return (
    <ul className="divide-y divide-gray-alpha-100 overflow-hidden rounded-xl border border-gray-alpha-150">
      {rows.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="font-mono text-xs text-subtle">{j.id.slice(0, 8)}</span>
          <span className="text-sm text-foreground">{j.type}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              j.status === "succeeded"
                ? "bg-gray-alpha-100 text-foreground"
                : j.status === "unknown_submission"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-gray-alpha-50 text-secondary"
            }`}
          >
            {j.status}
          </span>
          <span className="ml-auto text-xs text-secondary">
            {j.createdAt.slice(0, 19).replace("T", " ")}
          </span>
          {j.error && (
            <span className="w-full text-xs text-amber-700">
              {j.error.safeMessage}（{j.error.submissionCertainty}）
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
