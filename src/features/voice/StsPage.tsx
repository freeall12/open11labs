import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type ProviderRecord,
} from "@/lib/api";
import { VoicePickerDialog } from "@/features/voice/VoicePicker";
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
  {
    id: "eleven_multilingual_sts_v2",
    label: "Multilingual STS v2",
    note: "跨语言语音转语音模型。",
    langs: ["English", "Japanese", "Chinese"],
  },
  {
    id: "eleven_voice_changer_v1",
    label: "Voice Changer v1",
    note: "英语语音转语音模型。",
    langs: ["English"],
  },
];

/** Observed on the upstream page for this tool; not a verified API limit. */
const OBSERVED_WEB_LIMIT_MB = 50;

const ACCEPTED = "audio/*,video/*";
const MAX_BYTES = OBSERVED_WEB_LIMIT_MB * 1024 * 1024;

interface QueueItem {
  id: string;
  file: File;
  /** Kept out of the intent id; the file name must not become a path. */
  sizeLabel: string;
}

type Tab = "settings" | "history";

export function StsPage() {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [voiceDialog, setVoiceDialog] = useState(false);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("settings");
  const [modelDialog, setModelDialog] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  // Slider positions survive a refresh; queued files cannot, because a File
  // handle is not persistable and re-uploading would cost a second time.
  const [draft, setDraft] = useDraft("sts", {
    voiceId: "",
    modelId: STS_MODELS[0].id,
    stability: 0.5,
    similarity: 0.75,
    style: 0,
    removeNoise: false,
    speakerBoost: false,
  });
  const { voiceId, modelId, stability, similarity, style, removeNoise, speakerBoost } = draft;
  const [ackCost, setAckCost] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const history = useJobHistory("speech_to_speech", tab === "history");

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
      if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
        rejected.push(`${file.name}（非音视频）`);
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
        addFiles([new File([blob], `录音-${Date.now()}.webm`, { type: blob.type })]);
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
              use_speaker_boost: speakerBoost,
            },
            acknowledgeUnknownCost: ackCost,
          },
        });

        if (!created.created) {
          setNote("队列中有文件与上次完全相同，已复用对应任务，不会重复计费。");
          continue;
        }

        await jobsApi.run(created.job.id);
      }
      await history.reload();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "加入队列失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-6">
      {!loading && !provider && (
        <Notice tone="warn">
          尚未配置 Provider。变声器会调用你的 Provider 产生费用。
          <Link to="/local/settings/providers" className="ml-1 underline">
            去本地设置添加密钥
          </Link>
        </Notice>
      )}

      {/* Same two-column shape as TTS upstream (100-103): queue on the left,
          settings rail on the right. The credits readout the reference puts
          on the left of the footer is a plan balance, so it is gone. */}
      <div className="flex items-start">
        <StageColumn>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            multiple
            className="sr-only"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />

          {queue.length === 0 ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
              }}
              className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-alpha-200 p-6 text-center"
            >
              <p className="text-sm text-foreground">点击上传，或拖放</p>
              <p className="text-xs text-secondary">
                每个音频或视频文件最大 {OBSERVED_WEB_LIMIT_MB}MB
              </p>
              <p className="text-xs text-subtle">或</p>
              <button
                type="button"
                onClick={toggleRecording}
                className="focus-ring flex h-8 items-center gap-1.5 rounded-[10px] border border-gray-alpha-200 px-3 text-sm text-foreground hover:bg-gray-alpha-50"
              >
                {recorder.current ? "停止录音" : "录制音频"}
              </button>
            </div>
          ) : (
            <ul className="stack gap-2">
              {queue.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-alpha-150 p-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{item.file.name}</span>
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
              <li>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="focus-ring flex h-8 items-center gap-1.5 rounded-[10px] border border-gray-alpha-200 px-3 text-sm text-foreground hover:bg-gray-alpha-50"
                >
                  继续添加
                </button>
              </li>
            </ul>
          )}

          <p className="text-xs text-subtle">
            单文件上限 {OBSERVED_WEB_LIMIT_MB}MB 来自上游网页对该工具的观察，
            <strong>未经 API 验证</strong>，也不适用于其他工具的上传限制。
          </p>

          <label className="flex items-start gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              checked={ackCost}
              onChange={(e) => setAckCost(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              我了解队列中 {queue.length} 个文件都会提交给{" "}
              {provider?.baseURL ?? "Provider"}，会产生未知费用。
            </span>
          </label>

          {note && <Notice tone="info">{note}</Notice>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-secondary">总时长 0:00</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={queue.length === 0}
                onClick={() => {
                  setQueue([]);
                  setNote(null);
                }}
                className="focus-ring h-8 rounded-[10px] border border-gray-alpha-200 px-3 text-sm text-foreground hover:bg-gray-alpha-50 disabled:opacity-40"
              >
                清空队列
              </button>
              <button
                type="button"
                disabled={!!blocked || busy || !ackCost}
                onClick={convert}
                className="focus-ring h-8 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800 disabled:bg-gray-300 disabled:text-secondary"
              >
                {busy ? "提交中…" : "生成语音 ⌘+Enter"}
              </button>
            </div>
          </div>
          {blocked && <p className="text-xs text-secondary">{blocked}</p>}
        </StageColumn>

        <SettingsRail>
          <RailTabs value={tab} onChange={setTab} />
          <div className="stack gap-5 pt-5">
            {tab === "history" ? (
              <>
                <TableHead columns={["名称", "状态", "操作"]} />
                <JobHistoryList {...history} emptyText="本地还没有转换历史。" />
              </>
            ) : (
              <>
                <RailField label="音色">
                  <div className="flex items-center gap-2">
                    <SelectPill
                      label={voiceName ?? "选择音色"}
                      leading={voiceName ? <VoiceDot name={voiceName} /> : undefined}
                      disabled={!provider || provider.validationState !== "available"}
                      onClick={() => setVoiceDialog(true)}
                      ariaLabel={voiceName ? `选择音色 - ${voiceName}` : "选择音色"}
                    />
                  </div>
                </RailField>

                <RailField label="模型">
                  <SelectPill
                    label={STS_MODELS.find((m) => m.id === modelId)?.label ?? modelId}
                    onClick={() => setModelDialog(true)}
                    ariaLabel={`选择模型 - ${STS_MODELS.find((m) => m.id === modelId)?.label ?? modelId}`}
                  />
                  <p className="text-xs text-secondary">
                    仅列出变声器模型。文本转语音的模型 ID 在此无效，服务端也会拒绝。
                  </p>
                </RailField>

                <RailSlider
                  label="稳定性"
                  low="更具变化性"
                  high="更稳定"
                  value={stability}
                  onChange={(v) => setDraft((d) => ({ ...d, stability: v }))}
                />
                <RailSlider
                  label="相似度"
                  low="低"
                  high="高"
                  value={similarity}
                  onChange={(v) => setDraft((d) => ({ ...d, similarity: v }))}
                />
                <RailSlider
                  label="风格夸张"
                  low="无"
                  high="夸张"
                  value={style}
                  onChange={(v) => setDraft((d) => ({ ...d, style: v }))}
                />

                <div className="stack gap-3">
                  <AdvancedToggle open={advanced} onClick={() => setAdvanced((v) => !v)} />
                  {advanced && (
                    <div className="stack gap-3">
                      <RailRow label="去除背景噪音">
                        <Toggle
                          label="去除背景噪音"
                          checked={removeNoise}
                          onChange={(v) => setDraft((d) => ({ ...d, removeNoise: v }))}
                        />
                      </RailRow>
                      <RailRow label="输出格式">
                        <span className="text-sm text-subtle">
                          变声器输出格式由 Provider 决定，本地未核验可选项。
                        </span>
                      </RailRow>
                      <RailRow label="说话人增强">
                        <Toggle
                          label="说话人增强"
                          checked={speakerBoost}
                          onChange={(v) => setDraft((d) => ({ ...d, speakerBoost: v }))}
                        />
                      </RailRow>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </SettingsRail>
      </div>

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

      {voiceDialog && (
        <VoicePickerDialog
          value={voiceId}
          onChange={(v) => {
            setDraft((d) => ({ ...d, voiceId: v.voiceId }));
            setVoiceName(v.name);
            setVoiceDialog(false);
          }}
          onClose={() => setVoiceDialog(false)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------- model picker -- */

/**
 * STS model chooser (101). Only speech-to-speech models are offered: reusing
 * a TTS model id here would produce a request the provider rejects, and the
 * failure would read as a UI bug rather than a wrong id.
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
          {STS_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={value === m.id}
              onClick={() => onChange(m.id)}
              className={`focus-ring flex w-full flex-col gap-1 rounded-xl px-3 py-3 text-left transition-colors ${
                value === m.id ? "bg-gray-alpha-100" : "hover:bg-gray-alpha-50"
              }`}
            >
              <span className="text-sm font-medium text-foreground">{m.label}</span>
              <span className="text-xs text-secondary">{m.note}</span>
              <span className="flex flex-wrap items-center gap-1">
                {m.langs.map((l) => (
                  <span
                    key={l}
                    className="rounded-full bg-gray-alpha-50 px-1.5 py-px text-[11px] leading-4 text-secondary"
                  >
                    {l}
                  </span>
                ))}
              </span>
              <span className="text-xs text-subtle">能力未经真实调用核验</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
