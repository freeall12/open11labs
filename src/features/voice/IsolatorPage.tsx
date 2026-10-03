import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { JobHistoryList, Notice, TableHead, useJobHistory } from "@/features/voice/ui";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";

/* ==========================================================================
   Voice isolator.

   One thing this page must get right: limits are per-tool. The docs mention
   500MB / 1 hour for *this* endpoint, the voice changer page observed 50MB,
   and transcription was observed at 1000MB. docs/pages/voice.md is explicit
   that these must not be merged into one global upload cap, so this page
   states its own figure and labels it as a documentation observation rather
   than a verified API limit.
   ========================================================================== */

/** From the docs page for this endpoint. Not verified against the API. */
const DOC_OBSERVED = { maxMb: 500, maxHours: 1, verified: false };

export function IsolatorPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [ackCost, setAckCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);
  const [source, setSource] = useState<{ url: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const history = useJobHistory("audio_isolation");
  const fileInput = useRef<HTMLInputElement>(null);
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
    if (!f.type.startsWith("audio/")) {
      setNote(`${f.name} 不是音频文件，已忽略。`);
      return;
    }
    if (f.size > DOC_OBSERVED.maxMb * 1024 * 1024) {
      setNote(
        `${f.name} 超过 ${DOC_OBSERVED.maxMb}MB（该工具的文档观察值，未经 API 验证），已忽略。`,
      );
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
      setNote("无法录音（未授权或无可用设备）。请改用上传音频。");
    }
  }

  const blocked = loading
    ? "正在读取本地 Provider…"
    : !provider
      ? "尚未配置 Provider"
      : provider.validationState !== "available"
        ? `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`
        : !file
          ? "请先上传或录制音频"
          : null;

  async function process() {
    if (!provider || !file) return;
    setBusy(true);
    setNote(null);
    setResult(null);
    try {
      const { asset } = await assetsApi.upload(file);
      // Keep the original around so the result can be compared against it.
      setSource({ url: asset.url, name: asset.displayName });

      const created = await jobsApi.create({
        intentId: `isolate:${provider.id}:${asset.id}`,
        type: "audio_isolation",
        providerId: provider.id,
        credentialRef: provider.id,
        input: {
          assetId: asset.id,
          fileName: asset.displayName,
          mimeType: file.type,
          acknowledgeUnknownCost: ackCost,
        },
      });
      setJob(created.job);

      if (!created.created) {
        setNote("这段音频之前已经处理过，已复用对应任务，不会重复计费。");
        return;
      }

      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      await history.reload();
      if (out.asset) {
        setResult({ url: out.asset.url, name: out.asset.displayName });
      } else if (out.reason) {
        setNote(out.reason);
      }
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "处理失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-8">
      {!loading && !provider && (
        <Notice tone="warn">
          尚未配置 Provider。人声分离会调用你的 Provider 产生费用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      <Notice tone="info">
        人声分离用于去除背景噪声，<strong>不是</strong>音乐分轨或乐器分离。
      </Notice>

      <section className="stack gap-3">
        <span className="text-sm font-medium text-foreground">输入音频</span>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
          >
            上传音频
          </button>
          <button
            type="button"
            onClick={toggleRecording}
            className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
          >
            {recorder.current ? "停止录音" : "录音"}
          </button>
        </div>

        <p className="text-xs text-secondary">
          本工具的文档观察上限为 {DOC_OBSERVED.maxMb}MB / {DOC_OBSERVED.maxHours} 小时，
          <strong>未经 API 验证</strong>。这个数字只属于人声分离，
          不适用于变声器或语音转文本的上传限制。
        </p>

        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-gray-alpha-150 p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{file.name}</span>
              <span className="text-xs text-secondary">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setSource(null);
              }}
              className="focus-ring rounded-[10px] px-2 py-1 text-sm text-secondary hover:bg-gray-alpha-100"
            >
              移除
            </button>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-8 text-center text-sm text-secondary">
            尚未选择音频。
          </p>
        )}
      </section>

      <Notice tone="warn">
        文档计量方式为「每分钟 1000 字符」，但<strong>未经真实调用核验</strong>。
        本地不会把它换算成金额，一律记为「费用未知」。
      </Notice>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ackCost}
          onChange={(e) => setAckCost(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-secondary">
          我了解这次处理会产生费用、金额未知，并同意把音频发送到{" "}
          {provider?.baseURL ?? "Provider"}。
        </span>
      </label>

      {note && <Notice tone="error">{note}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!!blocked || busy || !ackCost}
          onClick={process}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background hover:bg-gray-800 disabled:bg-gray-400"
        >
          {busy ? "处理中…" : "开始分离"}
        </button>
        {blocked && <span className="text-xs text-secondary">{blocked}</span>}
      </div>

      {(result || source) && (
        <section className="stack gap-4 rounded-xl border border-gray-alpha-150 p-5">
          <h2 className="text-sm font-medium text-foreground">对比</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {source && (
              <div className="stack gap-2">
                <p className="text-xs text-secondary">原始音频</p>
                <audio controls src={source.url} className="w-full" />
              </div>
            )}
            {result && (
              <div className="stack gap-2">
                <p className="text-xs text-secondary">分离后</p>
                <audio controls src={result.url} className="w-full" />
                <a
                  href={result.url}
                  download={result.name}
                  className="focus-ring w-fit text-sm underline"
                >
                  下载 {result.name}
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {job && job.status !== "succeeded" && (
        <p className="text-xs text-secondary">
          最近一次任务：{job.status}
          {job.error ? ` — ${job.error.safeMessage}` : ""}
        </p>
      )}

      {/* The reference lists past isolations under a 搜索历史 box with
          名称 / 时长 / 格式 / 操作 columns (097–098). */}
      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">历史</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索历史"
          aria-label="搜索历史"
          className="focus-ring h-9 w-full rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
        <JobHistoryList
          {...history}
          query={query}
          head={<TableHead columns={["名称", "时长", "格式", "操作"]} />}
          emptyText="还没有分离历史。上传一段音频后会在此列出。"
        />
      </section>
    </div>
  );
}
