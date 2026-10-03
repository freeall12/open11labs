import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type AssetRecord,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";
import {
  downloadText,
  exportTranscript,
  parseTranscript,
  speakersFromWords,
  type SubtitleFormat,
  type Transcript,
} from "@/features/voice/transcript";
import {
  YoutubeTranscription,
  type YoutubeControls,
} from "@/features/voice/YoutubeTranscription";
import { DropZone, FieldRow, Modal, SegmentedTabs, Toggle } from "@/features/shared/Modal";
import { TabLink } from "@/features/voice/ui";

/* ==========================================================================
   Speech to text.

   The page is a **library**, not a form. That is the shape the reference
   shows: a list of past transcriptions under a search box, with
   "转录文件" opening a dialog. The dialog is where the four sources live.

   Two things are deliberately absent, because SCOPE.md excludes them:
   the "创建者" filter (an upstream account filter) and any transcript
   belonging to a cloud account. Every row below is a local artifact.

   Limits shown here are this tool's observed figures and are labelled as
   unverified. They are not merged with the voice changer's 50MB or the
   isolator's 500MB — specs/pages/voice.md forbids collapsing them.
   ========================================================================== */

const DOC_OBSERVED = { maxMb: 1000, verified: false };

const LANGUAGES = [
  { id: "auto", label: "检测" },
  { id: "en", label: "英语" },
  { id: "zh", label: "中文" },
  { id: "ja", label: "日语" },
  { id: "ko", label: "韩语" },
  { id: "de", label: "德语" },
  { id: "fr", label: "法语" },
  { id: "es", label: "西班牙语" },
  { id: "pt", label: "葡萄牙语" },
  { id: "it", label: "意大利语" },
  { id: "ru", label: "俄语" },
  { id: "hi", label: "印地语" },
  { id: "pl", label: "波兰语" },
];

type Source = "upload" | "record" | "youtube" | "url";

const SOURCES: { id: Source; label: string; hint: string }[] = [
  { id: "upload", label: "上传", hint: "本地文件，先存入素材库" },
  { id: "record", label: "录制", hint: "浏览器录音" },
  { id: "youtube", label: "YouTube", hint: "yt-dlp 下载公开音轨" },
  { id: "url", label: "URL", hint: "抓取公网音频地址，逐跳做 SSRF 校验" },
];

export function SttPage() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openAsset, setOpenAsset] = useState<AssetRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await assetsApi.list();
      setAssets(res.assets);
      setError(null);
    } catch (err) {
      // Without a catch the rejection escapes the effect as an unhandled
      // promise error, which fails the run even though the UI degrades fine.
      setError(err instanceof ApiError ? err.message : "无法读取本地素材列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Transcripts are text artifacts; everything else in the library is audio
  // or video and does not belong on this page.
  const transcripts = useMemo(
    () => assets.filter((a) => a.mediaType.startsWith("text/")),
    [assets],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transcripts;
    return transcripts.filter((a) => a.displayName.toLowerCase().includes(q));
  }, [transcripts, query]);

  return (
    <div className="stack gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="stack gap-1">
          <h1 className="font-waldenburg text-3xl font-normal text-foreground">语音转文本</h1>
          <p className="text-sm text-secondary">
            使用你自己的 ASR Provider 转录音频和视频文件。转写全部保存在本机。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          转录文件
        </button>
      </div>

      <div className="flex items-center gap-4 border-b border-gray-alpha-150">
        <TabLink to="/app/speech-to-text" label="转录" active />
        <TabLink to="/app/speech-to-text/speakers" label="说话者" />
      </div>

      <label className="relative block">
        <span className="sr-only">搜索转录文本</span>
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
          width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索转录文本…"
          className="focus-ring h-10 w-full rounded-xl border border-gray-alpha-150 bg-background pl-9 pr-3 text-sm outline-none placeholder:text-subtle"
        />
      </label>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="focus-ring ml-2 underline"
          >
            重试
          </button>
        </p>
      )}

      {loading ? (
        <SkeletonRows />
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
          {transcripts.length === 0
            ? "还没有转写记录。用右上角「转录文件」开始。"
            : "没有匹配的转写。"}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-alpha-150">
          <div className="grid grid-cols-[1fr_140px_40px] items-center gap-4 border-b border-gray-alpha-100 px-4 py-2.5 text-xs text-secondary">
            <span>标题</span>
            <span>创建于</span>
            <span className="text-right">操作</span>
          </div>
          <ul>
            {filtered.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[1fr_140px_40px] items-center gap-4 border-b border-gray-alpha-100 px-4 py-3 last:border-0 hover:bg-gray-alpha-50"
              >
                <button
                  type="button"
                  onClick={() => setOpenAsset(a)}
                  className="focus-ring min-w-0 truncate text-left text-sm text-foreground"
                >
                  {a.displayName}
                </button>
                <span className="text-xs text-secondary">{relativeTime(a.createdAt)}</span>
                {/* The reference opens a per-row options menu here. That menu's
                    contents were never captured, so this opens the transcript
                    rather than inventing entries for it. */}
                <button
                  type="button"
                  onClick={() => setOpenAsset(a)}
                  aria-label={`转录选项：${a.displayName}`}
                  className="focus-ring flex h-7 w-7 items-center justify-center rounded-[10px] text-secondary hover:bg-gray-alpha-100"
                >
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M4.5 3L7.5 6l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dialogOpen && (
        <TranscribeDialog
          onClose={() => setDialogOpen(false)}
          onDone={() => {
            void load();
          }}
        />
      )}

      {openAsset && <TranscriptReader asset={openAsset} onClose={() => setOpenAsset(null)} />}
    </div>
  );
}

/* --------------------------------------------------------- transcribe -- */

function TranscribeDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [source, setSource] = useState<Source>("upload");
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("auto");
  const [tagAudioEvents, setTagAudioEvents] = useState(true);
  const [subtitles, setSubtitles] = useState(false);
  const [verbatim, setVerbatim] = useState(false);
  const [assignVoices, setAssignVoices] = useState(false);
  const [terms, setTerms] = useState<string[]>([]);
  const [termDraft, setTermDraft] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [ackCost, setAckCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  // The YouTube panel owns its own gate, so the dialog footer button is driven
  // from there instead of duplicating the rule.
  const [yt, setYt] = useState<YoutubeControls | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

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

  const pick = useCallback((f: File) => {
    if (!f.type.startsWith("audio/") && !f.type.startsWith("video/")) {
      setNote(`${f.name} 不是音频或视频文件，已忽略。`);
      return;
    }
    if (f.size > DOC_OBSERVED.maxMb * 1024 * 1024) {
      setNote(`${f.name} 超过 ${DOC_OBSERVED.maxMb}MB（网页观察值，未经 API 验证），已忽略。`);
      return;
    }
    setFile(f);
    setNote(null);
  }, []);

  async function toggleRecording() {
    if (recorder.current) {
      recorder.current.stop();
      recorder.current = null;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType });
        pick(new File([blob], `录音-${Date.now()}.webm`, { type: blob.type }));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorder.current = rec;
    } catch {
      setNote("无法录音（未授权或无可用设备）。请改用上传。");
    }
  }

  const wireOptions = useMemo(() => {
    const out: Record<string, boolean | string> = {};
    if (tagAudioEvents) out.tag_audio_events = true;
    if (subtitles) out.subtitles = true;
    if (verbatim) out.verbatim = true;
    if (assignVoices) out.speaker_diarization = true;
    if (terms.length > 0) out.keyterms = terms.join(",");
    return out;
  }, [tagAudioEvents, subtitles, verbatim, assignVoices, terms]);

  const isYoutube = useMemo(() => {
    try {
      const h = new URL(url.trim()).hostname;
      return h === "youtube.com" || h.endsWith(".youtube.com") || h === "youtu.be";
    } catch {
      return false;
    }
  }, [url]);

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地 Provider…";
    if (source === "youtube") return null;
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (source === "url") return url.trim() ? null : "请粘贴音频地址";
    return file ? null : source === "record" ? "请先录音" : "请先选择文件";
  }, [loading, source, provider, url, file]);

  async function submit() {
    if (!provider) return;
    setBusy(true);
    setNote(null);
    try {
      let type: string;
      let input: Record<string, unknown>;

      if (source === "url") {
        type = isYoutube ? "youtube_transcription" : "url_transcription";
        input = { url: url.trim(), languageCode: language, options: wireOptions };
      } else {
        if (!file) return;
        const { asset } = await assetsApi.upload(file);
        type = "speech_to_text";
        input = {
          assetId: asset.id,
          fileName: asset.displayName,
          languageCode: language,
          options: wireOptions,
          acknowledgeUnknownCost: ackCost,
        };
      }

      const identity =
        source === "url" ? url.trim() : `${file?.name ?? ""}:${file?.size ?? 0}`;
      const created = await jobsApi.create({
        intentId: `stt:${provider.id}:${identity}:${language}:${JSON.stringify(wireOptions)}`,
        type,
        providerId: provider.id,
        credentialRef: provider.id,
        input,
      });
      setJob(created.job);
      if (!created.created) {
        setNote("这次转写之前已提交过，复用了同一个任务，不会重复计费。");
        return;
      }
      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      if (out.asset) {
        setNote("转写完成。");
        onDone();
      } else if (out.reason) {
        setNote(out.reason);
      }
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "转写失败");
    } finally {
      setBusy(false);
    }
  }

  function addTerm() {
    const t = termDraft.trim();
    if (!t) return;
    if (terms.includes(t)) {
      setNote(`关键术语「${t}」已存在。`);
      return;
    }
    setTerms([...terms, t]);
    setTermDraft("");
    setNote(null);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="转录文件"
      footer={
        <>
          {note && <span className="mr-auto text-xs text-secondary">{note}</span>}
          {source === "youtube" ? (
            <button
              type="button"
              onClick={() => yt?.run()}
              disabled={!yt || yt.disabled}
              className="focus-ring h-9 rounded-[10px] bg-gray-400 px-4 text-sm font-medium text-white transition-colors enabled:hover:bg-gray-800 disabled:cursor-not-allowed"
            >
              {yt?.label ?? "下载并转写"}
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!!blocked || busy || !ackCost}
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-[10px] bg-gray-400 px-4 text-sm font-medium text-white transition-colors enabled:hover:bg-gray-800 disabled:cursor-not-allowed"
            >
              {busy ? "转写中…" : "上传文件"}
            </button>
          )}
        </>
      }
    >
      <div className="stack gap-4">
        <SegmentedTabs options={SOURCES} value={source} onChange={setSource} />

        {source === "youtube" ? (
          <YoutubeTranscription compact onControls={setYt} />
        ) : (
          <>
            {source === "upload" && (
              <DropZone
                onFile={pick}
                title="点击或将文件拖到此处上传"
                hint={`音频和视频文件，不超过 ${DOC_OBSERVED.maxMb}MB（未经 API 验证）`}
                accept="audio/*,video/*"
              />
            )}

            {source === "record" && (
              <div className="stack gap-3">
                <button
                  type="button"
                  onClick={toggleRecording}
                  className="focus-ring w-fit rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
                >
                  {recorder.current ? "停止录音" : "开始录音"}
                </button>
                {file && (
                  <p className="text-xs text-secondary">
                    {file.name} · {(file.size / 1024).toFixed(0)} KB
                  </p>
                )}
              </div>
            )}

            {source === "url" && (
              <label className="stack gap-1.5 text-sm">
                <span className="text-secondary">音频地址</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/audio.mp3"
                  className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none placeholder:text-subtle"
                />
                <span className="text-xs text-subtle">
                  抓取时不携带任何凭据，每一次重定向都重新校验内网地址。
                  {isYoutube && " 检测到 YouTube 链接，将改用 yt-dlp 下载音轨。"}
                </span>
              </label>
            )}

            {file && source !== "record" && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-alpha-150 px-3 py-2">
                <span className="min-w-0 truncate text-sm">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="focus-ring shrink-0 text-xs text-secondary underline"
                >
                  移除
                </button>
              </div>
            )}

            <div className="divide-y divide-gray-alpha-100">
              <FieldRow label="主要语言">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  aria-label="主要语言"
                  className="focus-ring h-8 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </FieldRow>

              <FieldRow label="标记音频事件" hint="把笑声、掌声等非语音事件标进转写">
                <Toggle
                  checked={tagAudioEvents}
                  onChange={setTagAudioEvents}
                  label="标记音频事件"
                />
              </FieldRow>

              <FieldRow label="包含字幕" hint="需要逐词时间戳；没有时间戳时导出会被拒绝而不是编造">
                <Toggle checked={subtitles} onChange={setSubtitles} label="包含字幕" />
              </FieldRow>

              <FieldRow label="无逐字记录" hint="关闭逐字记录，转写会更宽松地纠正口误">
                <Toggle checked={verbatim} onChange={setVerbatim} label="无逐字记录" />
              </FieldRow>

              <FieldRow label="从声音库分配音色" hint="区分说话人，可在「说话者」页查看">
                <Toggle
                  checked={assignVoices}
                  onChange={setAssignVoices}
                  label="从声音库分配音色"
                />
              </FieldRow>

              <FieldRow label="关键术语">
                <span className="flex items-center gap-1">
                  <span className="flex w-64 flex-wrap items-center gap-1 rounded-lg border border-gray-alpha-150 px-2 py-1">
                    {terms.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded bg-gray-alpha-100 px-1.5 py-0.5 text-xs"
                      >
                        {t}
                        <button
                          type="button"
                          aria-label={`移除 ${t}`}
                          onClick={() => setTerms(terms.filter((x) => x !== t))}
                          className="text-secondary hover:text-foreground"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      value={termDraft}
                      onChange={(e) => setTermDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTerm();
                        }
                      }}
                      placeholder="添加关键术语…"
                      aria-label="添加关键术语"
                      className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
                    />
                  </span>
                  <button
                    type="button"
                    aria-label="清除标签"
                    disabled={terms.length === 0}
                    onClick={() => setTerms([])}
                    className="focus-ring flex h-8 w-8 items-center justify-center rounded-[10px] text-secondary hover:bg-gray-alpha-50 disabled:opacity-40"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="关键术语选项"
                    aria-expanded={termsOpen}
                    onClick={() => setTermsOpen((v) => !v)}
                    className="focus-ring flex h-8 w-8 items-center justify-center rounded-[10px] border border-gray-alpha-150 text-secondary hover:bg-gray-alpha-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              </FieldRow>
              {termsOpen && (
                <p className="py-2 text-xs text-subtle">
                  关键术语只影响 Provider 的识别偏好，不改变音频，也不会再次计费。
                  当前 {terms.length} 个{terms.length === 0 ? "（空）" : `：${terms.join("、")}`}。
                </p>
              )}
            </div>

            <label className="flex items-start gap-2 text-xs text-secondary">
              <input
                type="checkbox"
                checked={ackCost}
                onChange={(e) => setAckCost(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                我了解会产生费用、金额未知，并同意把该文件发送到{" "}
                {provider?.baseURL ?? "你的 Provider"}。费用记为「未知」，不会显示为 0。
              </span>
            </label>

            {blocked && <p className="text-xs text-secondary">{blocked}</p>}

            {job && job.error && (
              <p className="text-xs text-amber-700">
                {job.error.safeMessage}（提交确定性：{job.error.submissionCertainty}）
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- reader -- */

function TranscriptReader({ asset, onClose }: { asset: AssetRecord; onClose: () => void }) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const raw = await assetsApi.readText(asset.id);
        const { transcript: t, reason: r } = parseTranscript(raw);
        setTranscript(t);
        setText(t?.text ?? raw);
        setReason(r);
      } catch (err) {
        setReason(err instanceof ApiError ? err.message : "无法读取转写");
      }
    })();
  }, [asset.id]);

  const speakers = useMemo(() => speakersFromWords(transcript?.words ?? null), [transcript]);

  function doExport(format: SubtitleFormat) {
    if (!transcript) return;
    const out = exportTranscript(transcript, format, text);
    if (!out.ok) {
      setExportNote(out.reason);
      return;
    }
    setExportNote(null);
    downloadText(out.filename, out.body, out.mediaType);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={asset.displayName}
      width="max-w-2xl"
      footer={
        <>
          {exportNote && <span className="mr-auto text-xs text-amber-700">{exportNote}</span>}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
          >
            关闭
          </button>
          {(["txt", "srt", "vtt"] as SubtitleFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => doExport(f)}
              className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
            >
              {f.toUpperCase()}
            </button>
          ))}
        </>
      }
    >
      <div className="stack gap-3">
        {reason && <p className="text-xs text-secondary">{reason}</p>}
        {speakers.length > 0 && (
          <p className="text-xs text-secondary">
            说话者：{speakers.map((s) => `${s.id}（${s.words} 词）`).join("、")}
          </p>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          aria-label="转写文本"
          className="focus-ring w-full resize-y rounded-lg border border-gray-alpha-150 bg-background p-3 text-sm leading-relaxed outline-none"
        />
        <p className="text-xs text-subtle">
          编辑文本是本地操作，不会重新调用转录；重新转写会产生新费用。
        </p>
        {transcript?.words === null && (
          <p className="text-xs text-subtle">
            本次转写没有逐词时间戳，因此 SRT / VTT 无法真实导出。
          </p>
        )}
        <button
          type="button"
          onClick={() => navigate("/app/speech-to-text/speakers")}
          className="focus-ring w-fit text-xs underline"
        >
          打开说话者页
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- pieces -- */

function SkeletonRows() {
  return (
    <div className="stack gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-alpha-50" />
      ))}
    </div>
  );
}

/** Relative label for the "创建于" column. */
function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "未知";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}
