import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SegmentedTabs } from "@/features/shared/Modal";
import { JobHistoryList, Notice, TableHead, useDraft, useJobHistory } from "@/features/voice/ui";
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

   Layout follows reference 113–114: an 上传 / 粘贴 URL tab pair, then the
   model, language and speaker-similarity row, then 生成, then a searchable,
   sortable history list.
   ========================================================================== */

const VERSIONS = [
  {
    id: "v2",
    label: "v2（Alpha）",
    // Reported language counts, kept separate and labelled as unverified.
    reportedLanguages: 104,
  },
  {
    id: "v1",
    label: "v1",
    reportedLanguages: 29,
  },
];

type Source = "upload" | "url";

const SOURCES: { id: Source; label: string }[] = [
  { id: "upload", label: "上传" },
  { id: "url", label: "粘贴 URL" },
];

type Sort = "newest" | "name";

const SORTS: { id: Sort; label: string }[] = [
  { id: "newest", label: "最新" },
  { id: "name", label: "名称" },
];

export function DubbingPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<Source>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [ackCost, setAckCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useJobHistory("dubbing");

  // The language and similarity choices are the expensive part to re-enter,
  // so they persist; the source file cannot and is re-picked each visit.
  const [draft, setDraft] = useDraft("dubbing", {
    version: VERSIONS[0].id,
    language: "",
    similarity: 0.75,
  });
  const { version, language, similarity } = draft;

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
    if (source === "url") return url.trim() ? null : "请粘贴音视频地址";
    if (!file) return "请先上传源音频";
    if (!language.trim()) return "请填写目标语言";
    return null;
  }, [loading, provider, source, url, file, language]);

  const poll = useCallback(
    async (id: string, attempt = 0) => {
      const out = await jobsApi.poll(id);
      setJob(out.job);
      if (out.asset) {
        await history.reload();
        return;
      }
      if (out.stillRunning && attempt < 60) {
        // Dubbing is slower than image generation; back off further.
        timer.current = setTimeout(() => void poll(id, attempt + 1), 4000 + attempt * 500);
        return;
      }
      if (out.reason) setNote(out.reason);
      await history.reload();
    },
    [history],
  );

  async function generate() {
    if (!provider) return;
    setBusy(true);
    setNote(null);
    try {
      // A URL source has no local file, so the server fetches it. The client
      // never forwards a browser cookie or key with that request.
      const identity = source === "url" ? url.trim() : `${file?.name}:${file?.size}`;
      const intentId = `dub:${provider.id}:${version}:${language}:${identity}`;

      let assetId: string;
      let fileName: string;
      if (source === "url") {
        fileName = url.trim();
        assetId = "";
      } else {
        if (!file) return;
        const { asset } = await assetsApi.upload(file);
        assetId = asset.id;
        fileName = asset.displayName;
      }

      const created = await jobsApi.create({
        intentId,
        type: "dubbing",
        providerId: provider.id,
        modelId: version,
        credentialRef: provider.id,
        input: {
          ...(assetId ? { assetId } : { url: url.trim() }),
          fileName,
          targetLanguage: language,
          speakerSimilarity: similarity,
          modelId: version,
          acknowledgeUnknownCost: ackCost,
        },
      });
      setJob(created.job);

      if (!created.created) {
        setNote("这段源在相同设置下已经处理过，已复用对应任务，不会重复计费。");
        await history.reload();
        return;
      }

      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      if (out.asset) {
        await history.reload();
        return;
      }
      if (out.reason && !/pending|running|unknown/i.test(out.reason)) {
        setNote(out.reason);
        await history.reload();
        return;
      }
      void poll(out.job.id);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The reference offers 状态 / 模型 / 来源 / 语言 filter chips (114). Only the
   * first two are backed by a field on the local job record; 来源 and 语言 live
   * in the draft, not on the stored job, so offering them would be a chip that
   * cannot filter anything.
   */
  const [statusFilter, setStatusFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  const statusOptions = useMemo(
    () => [...new Set(history.jobs.map((j) => j.status))],
    [history.jobs],
  );
  const modelOptions = useMemo(
    () => [...new Set(history.jobs.map((j) => j.modelId ?? ""))].filter(Boolean),
    [history.jobs],
  );

  const sorted = useMemo(() => {
    const base = history.jobs.filter(
      (j) =>
        (!statusFilter || j.status === statusFilter) && (!modelFilter || j.modelId === modelFilter),
    );
    if (sort === "name") return [...base].sort((a, b) => a.id.localeCompare(b.id));
    return base;
  }, [history.jobs, sort, statusFilter, modelFilter]);

  return (
    <div className="stack gap-6">
      {!loading && !provider && (
        <Notice tone="warn">
          尚未配置 Provider。配音会调用你的 Provider 产生费用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      {/* ---------------- source ---------------- */}
      <SegmentedTabs options={SOURCES} value={source} onChange={setSource} size="sm" />

      {source === "upload" ? (
        <section className="stack gap-3">
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
            选择文件
          </button>
          <p className="text-xs text-secondary">或拖到这里</p>

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
      ) : (
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">音视频地址</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/clip.mp4"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none placeholder:text-subtle"
          />
          <span className="text-xs text-subtle">
            抓取时由服务端逐跳校验地址，不携带任何本地凭据。
          </span>
        </label>
      )}

      {/* ---------------- settings ---------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-secondary">配音模型</span>
          <select
            value={version}
            onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))}
            className="focus-ring h-9 rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            {VERSIONS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-secondary">目标语言</span>
          <input
            value={language}
            onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
            placeholder="选择语言"
            aria-label="目标语言"
            className="focus-ring h-9 w-40 rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-secondary">说话人相似度</span>
          <input
            type="range"
            role="slider"
            aria-label="说话人相似度"
            min={0}
            max={1}
            step={0.01}
            value={similarity}
            onChange={(e) => setDraft((d) => ({ ...d, similarity: Number(e.target.value) }))}
            className="w-32"
          />
          <span className="font-mono text-xs text-secondary">{similarity.toFixed(2)}</span>
        </label>
      </div>

      <Notice tone="warn">
        {v.label} 报告支持约 {v.reportedLanguages} 种语言，但
        <strong>这个数字未经核验</strong>，且 v1 与 v2 的支持范围不同。
        本地不内置语言清单，也不替你断言某个语言可用——提交后由 Provider 判定，
        不支持会返回明确错误。
      </Notice>

      <Notice tone="warn">
        v1 的编辑器未采，因此本版<strong>不提供</strong>编辑器。
        没有观察过的界面画出来就是假的。
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
          {busy ? "提交中…" : "生成"}
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
            <p className="text-xs text-secondary">已生成产物，可在下方历史中播放与下载。</p>
          )}
        </section>
      )}

      {/* ---------------- history ---------------- */}
      <section className="stack gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索之前的配音…"
            aria-label="搜索之前的配音"
            className="focus-ring h-9 min-w-56 flex-1 rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="配音排序"
            className="focus-ring h-9 rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {/* 创建者 is absent by SCOPE.md, and the remaining chips are backed by
            real fields on the stored job. */}
        {(statusOptions.length > 1 || modelOptions.length > 1) && (
          <div className="flex flex-wrap items-center gap-2">
            {statusOptions.length > 1 && (
              <FilterChip label="状态" value={statusFilter} onChange={setStatusFilter}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </FilterChip>
            )}
            {modelOptions.length > 1 && (
              <FilterChip label="模型" value={modelFilter} onChange={setModelFilter}>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </FilterChip>
            )}
          </div>
        )}
        <JobHistoryList
          {...history}
          jobs={sorted}
          query={query}
          head={<TableHead columns={["名称", "状态", "操作"]} />}
          emptyText="还没有配音记录。上传源文件后会在此列出。"
        />
      </section>
    </div>
  );
}

/** Removable filter chip: the label doubles as the "clear" affordance. */
function FilterChip({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <span
      className={
        value
          ? "flex h-8 items-center gap-1 rounded-[10px] border border-gray-alpha-200 bg-gray-alpha-50 pr-1 pl-2 text-xs text-foreground"
          : "flex h-8 items-center rounded-[10px] border border-gray-alpha-150 pr-1 pl-2 text-xs"
      }
    >
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`移除筛选条件 ${label}`}
          className="focus-ring rounded p-0.5 text-secondary hover:text-foreground"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <span className={value ? "" : "text-secondary"}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="focus-ring cursor-pointer bg-transparent text-xs outline-none"
      >
        <option value="">全部</option>
        {children}
      </select>
    </span>
  );
}
