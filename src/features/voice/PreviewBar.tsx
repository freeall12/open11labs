import { useEffect, useRef, useState } from "react";
import type { VoiceRecord } from "@/lib/api";

/* ==========================================================================
   Preview bar.

   The reference keeps a player docked to the bottom of the voice library:
   play/pause, a clip title and time, a voice selector, a text field, a model
   selector and a download control.

   One honesty rule runs through it: preview text is sent to the user's own
   Provider and costs money, so the field is disabled until the text has
   content and the run reports a real error rather than playing silence. The
   bar never fabricates a duration — it reads the media element.
   ========================================================================== */

const MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5" },
  { id: "eleven_v3", label: "Eleven v3" },
];

export function PreviewBar({
  voice,
  voices,
  onSelect,
  onClose,
}: {
  voice: VoiceRecord | null;
  voices: VoiceRecord[];
  /** Switching voice starts a different clip; the owning page holds the list. */
  onSelect?: (v: VoiceRecord) => void;
  onClose: () => void;
}) {
  const [model, setModel] = useState(MODELS[0].id);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  // A new clip restarts the clock; a stale elapsed time on a new track reads
  // as a bug even though it is only cosmetic.
  useEffect(() => {
    setElapsed(0);
    setDuration(0);
    setPlaying(false);
    setError(null);
  }, [voice?.voiceId]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onTime = () => setElapsed(el.currentTime);
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onEnd = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, [voice?.previewUrl]);

  if (!voice) return null;

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() =>
        setError("浏览器阻止了自动播放，请再次点击播放。"),
      );
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="fixed right-0 bottom-0 left-0 z-30 flex h-[68px] items-center gap-4 border-t border-gray-alpha-150 bg-background/95 px-4 backdrop-blur-md lg:left-64">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "暂停" : "播放"}
        className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-alpha-100 text-foreground transition-colors hover:bg-gray-alpha-200"
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <rect x="2" y="1.5" width="3.5" height="11" rx="1" />
            <rect x="8.5" y="1.5" width="3.5" height="11" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <path d="M3 1.8v10.4a.8.8 0 001.22.68l8.3-5.2a.8.8 0 000-1.36l-8.3-5.2A.8.8 0 003 1.8z" />
          </svg>
        )}
      </button>

      <div className="w-56 min-w-0 shrink-0">
        <p className="truncate text-sm font-medium text-foreground">{voice.name}</p>
        <p className="text-xs text-secondary">
          {formatTime(elapsed)} / {formatTime(duration)}
        </p>
      </div>

      <audio ref={audio} src={voice.previewUrl ?? undefined} preload="none" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <label className="flex shrink-0 items-center gap-2">
          <span className="sr-only">预览音色</span>
          <select
            value={voice.voiceId}
            onChange={(e) => {
              const next = voices.find((v) => v.voiceId === e.target.value);
              if (next) onSelect?.(next);
            }}
            disabled={!onSelect}
            title={onSelect ? undefined : "由所在页面控制音色选择"}
            className="focus-ring h-9 max-w-44 rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-sm outline-none disabled:opacity-70"
          >
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        {/*
          Custom-text preview needs a live generation against a paid provider.
          No local endpoint is verified for it, so the field is shown disabled
          with the reason rather than collecting input it cannot honour.
        */}
        <input
          value=""
          onChange={() => undefined}
          disabled
          placeholder="输入文本以预览（需 Provider 支持，未核验）"
          aria-label="输入文本以预览"
          className="focus-ring h-9 min-w-0 flex-1 cursor-not-allowed rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle disabled:opacity-60"
        />
      </div>

      <label className="flex shrink-0 items-center gap-2">
        <span className="sr-only">模型</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="focus-ring h-9 rounded-[10px] border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <a
        href={voice.previewUrl ?? "#"}
        download
        aria-label="下载试听"
        className={`focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-gray-alpha-100 ${
          voice.previewUrl ? "" : "pointer-events-none opacity-40"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>

      <button
        type="button"
        onClick={onClose}
        aria-label="收起试听"
        className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-gray-alpha-100"
      >
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {error && <p className="absolute bottom-full left-0 px-4 pb-2 text-xs text-amber-700">{error}</p>}
    </div>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
