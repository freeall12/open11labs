import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";
import { VoicePicker } from "@/features/voice/VoicePicker";

/* ==========================================================================
   Voice changer.

   The queue is the point: several files are staged and converted together.
   Two rules from specs/pages/voice.md drive the design:
     - the 50MB figure is a *web page observation for this tool only*; it is
       not a global upload limit, and it is labelled as unverified here
     - a TTS model id must never be used for STS, so the selector only offers
       STS models and the server rejects anything else as well
   ========================================================================== */

const STS_MODELS = [
  { id: "eleven_multilingual_sts_v2", label: "Multilingual STS v2" },
  { id: "eleven_voice_changer_v1", label: "Voice Changer v1" },
];

/** Observed on the upstream page for this tool; not a verified API limit. */
const OBSERVED_WEB_LIMIT_MB = 50;

const ACCEPTED = "audio/*";
const MAX_BYTES = OBSERVED_WEB_LIMIT_MB * 1024 * 1024;

interface QueueItem {
  id: string;
  file: File;
  /** Kept out of the intent id; the file name must not become a path. */
  sizeLabel: string;
}

export function StsPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [modelId, setModelId] = useState(STS_MODELS[0].id);
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [style, setStyle] = useState(0);
  const [removeNoise, setRemoveNoise] = useState(false);
  const [ackCost, setAckCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [results, setResults] = useState<Record<string, { url: string; name: string }>>({});
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

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: QueueItem[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("audio/")) {
        rejected.push(`${file.name}（非音频）`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        // The limit is per-tool and unverified; say so instead of silently
        // dropping the file.
        rejected.push(`${file.name}（超过 ${OBSERVED_WEB_LIMIT_MB}MB 网页观察上限）`);
        continue;
      }
      next.push({
        id: `${file.name}:${file.size}:${file.lastModified}`,
        file,
        sizeLabel: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      });
    }
    setQueue((q) => [...q, ...next]);
    setNote(rejected.length ? `已跳过：${rejected.join("；")}` : null);
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
        addFiles([
          new File([blob], `录音-${Date.now()}.webm`, { type: blob.type }),
        ]);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorder.current = rec;
    } catch {
      // Permission denied or no device: fall back to upload, do not retry.
      setNote("无法录音（未授权或无可用设备）。请改用上传音频。");
    }
  }

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地 Provider…";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (queue.length === 0) return "请先上传或录制音频";
    if (!voiceId) return "请选择目标音色";
    return null;
  }, [loading, provider, queue.length, voiceId]);

  async function convert() {
    if (!provider) return;
    setBusy(true);
    setNote(null);
    try {
      for (const item of queue) {
        // Upload first, so the job snapshot references an asset instead of
        // carrying audio bytes.
        const { asset } = await assetsApi.upload(item.file);

        // Identity per (asset, voice, model). The same upload twice resolves to
        // the same local job rather than billing twice.
        const intentId = `sts:${provider.id}:${modelId}:${voiceId}:${asset.id}`;

        const created = await jobsApi.create({
          intentId,
          type: "speech_to_speech",
          providerId: provider.id,
          modelId,
          credentialRef: provider.id,
          input: {
            assetId: asset.id,
            voiceId,
            fileName: item.file.name,
            params: {
              stability,
              similarity_boost: similarity,
              style,
              remove_background_noise: removeNoise,
            },
            acknowledgeUnknownCost: ackCost,
          },
        });

        if (!created.created) {
          setNote("队列中有文件与上次完全相同，已复用对应任务，不会重复计费。");
          continue;
        }

        const run = await jobsApi.run(created.job.id);
        setJobs((j) => [run.job, ...j]);
        if (run.asset) {
          setResults((r) => ({
            ...r,
            [run.job.id]: { url: run.asset!.url, name: run.asset!.displayName },
          }));
        } else if (run.reason) {
          setNote(run.reason);
        }
      }
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "加入队列失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-8">
      {!loading && !provider && (
        <Notice tone="warn">
          尚未配置 Provider。变声器会调用你的 Provider 产生费用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">音频队列</h2>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            multiple
            className="sr-only"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
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
          <button
            type="button"
            disabled={queue.length === 0}
            onClick={() => {
              setQueue([]);
              setNote(null);
            }}
            className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-100 disabled:opacity-40"
          >
            清空队列
          </button>
        </div>

        <p className="text-xs text-secondary">
          单文件上限 {OBSERVED_WEB_LIMIT_MB}MB 来自上游网页对该工具的观察，**未经 API 验证**，
          也不适用于其他工具的上传限制。
        </p>

        {queue.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-8 text-center text-sm text-secondary">
            队列为空。上传或录制音频后会显示在这里。
          </p>
        ) : (
          <ul className="stack gap-2">
            {queue.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-xl border border-gray-alpha-150 p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {item.file.name}
                  </span>
                  <span className="text-xs text-secondary">{item.sizeLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setQueue((q) => q.filter((x) => x.id !== item.id))}
                  className="focus-ring rounded-[10px] px-2 py-1 text-sm text-secondary hover:bg-gray-alpha-100"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">模型</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            {STS_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-subtle">
            仅列出变声器模型。文本转语音的模型 ID 在此无效，服务端也会拒绝。
          </span>
        </label>

        <div className="stack gap-1.5 text-sm">
          <span className="text-secondary">背景噪音</span>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={removeNoise}
              onChange={(e) => setRemoveNoise(e.target.checked)}
            />
            <span>移除背景噪音</span>
          </label>
        </div>
      </div>

      <section className="stack gap-4 rounded-xl border border-gray-alpha-150 p-5">
        <h2 className="text-sm font-medium text-foreground">参数</h2>
        {[
          { label: "稳定性", value: stability, set: setStability },
          { label: "相似度", value: similarity, set: setSimilarity },
          { label: "风格", value: style, set: setStyle },
        ].map((p) => (
          <div key={p.label} className="stack gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground">{p.label}</span>
              <span className="font-mono text-xs text-secondary">{p.value}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={p.value}
              onChange={(e) => p.set(Number(e.target.value))}
              className="w-full"
            />
          </div>
        ))}
      </section>

      <section className="stack gap-3">
        <h2 className="text-sm font-medium text-foreground">目标音色</h2>
        <VoicePicker
          value={voiceId}
          onChange={setVoiceId}
          disabled={!provider || provider.validationState !== "available"}
        />
      </section>

      <Notice tone="warn">
        变声器按输入音频时长计费，本地无法获知金额，提交后一律记为「费用未知」。
      </Notice>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ackCost}
          onChange={(e) => setAckCost(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-secondary">
          我了解队列中 {queue.length} 个文件都会提交给{" "}
          {provider?.baseURL ?? "Provider"}，会产生未知费用。
        </span>
      </label>

      {note && <Notice tone="info">{note}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!!blocked || busy || !ackCost}
          onClick={convert}
          className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background hover:bg-gray-800 disabled:bg-gray-400"
        >
          {busy ? "加入队列中…" : `转换 ${queue.length || ""} 个文件`}
        </button>
        {blocked && <span className="text-xs text-secondary">{blocked}</span>}
      </div>

      {jobs.length > 0 && (
        <section className="stack gap-2">
          <h2 className="text-sm font-medium text-foreground">本次队列</h2>
          {jobs.map((j) => (
            <div
              key={j.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-gray-alpha-150 p-3 text-sm"
            >
              <span className="truncate text-secondary">
                {j.id.slice(0, 8)} · {j.status}
              </span>
              {results[j.id] && (
                <a
                  href={results[j.id].url}
                  download={results[j.id].name}
                  className="focus-ring underline"
                >
                  下载
                </a>
              )}
            </div>
          ))}
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
