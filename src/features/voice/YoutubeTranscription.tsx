import { useEffect, useMemo, useState } from "react";
import { Notice } from "@/features/voice/ui";
import { Link } from "react-router-dom";
import {
  ApiError,
  assets as assetsApi,
  jobs as jobsApi,
  providers as providersApi,
  type JobRecord,
  type ProviderRecord,
} from "@/lib/api";

/* ==========================================================================
   YouTube transcription.

   Open-source and local, end to end:
     yt-dlp (open source) extracts the audio
       -> stored as a local asset
       -> transcribed by the *user's own* STT provider
   No third-party transcription service is involved, and the browser never
   sees the intermediate audio.

   What this deliberately does not do: bypass login walls, age gates or
   paywalls, and it never reads the user's cookies. `--no-cookies` is pinned in
   the argument list and asserted by a test.
   ========================================================================== */

interface ToolStatus {
  id: string;
  purpose: string;
  available: boolean;
  install: string;
}

const EXAMPLES = [
  "https://www.youtube.com/watch?v=…",
  "https://youtu.be/…",
];

/**
 * @param compact Rendered inside the transcribe dialog: the surrounding dialog
 * already supplies the title, tabs and footer, so the panel drops its own
 * heading and closing button and keeps only the source, the gates and the
 * result.
 */
export interface YoutubeControls {
  run: () => void;
  disabled: boolean;
  busy: boolean;
  label: string;
}

export function YoutubeTranscription({
  compact = false,
  onControls,
}: {
  compact?: boolean;
  /** In compact mode the host owns the submit button, so it needs the action. */
  onControls?: (c: YoutubeControls) => void;
} = {}) {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("auto");
  const [ackCost, setAckCost] = useState(false);
  const [ackRights, setAckRights] = useState(false);
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [transcript, setTranscript] = useState<{ text: string; source?: unknown } | null>(
    null,
  );

  useEffect(() => {
    (async () => {
      try {
        const [p, t] = await Promise.all([
          providersApi.list(),
          toolsApi().catch(() => []),
        ]);
        setProvider(p.find((x) => x.validationState === "available") ?? p[0] ?? null);
        setTools(t);
      } catch {
        /* the gates below report the real reason */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ytdlp = tools.find((t) => t.id === "yt-dlp");

  const blocked = useMemo(() => {
    if (loading) return "正在读取本地配置…";
    if (ytdlp && !ytdlp.available) return "本机未安装 yt-dlp";
    if (!provider) return "尚未配置 Provider";
    if (provider.validationState !== "available") {
      return `Provider 状态为「${provider.validationState}」，请先在本地设置中验证`;
    }
    if (!url.trim()) return "请粘贴 YouTube 链接";
    return null;
  }, [loading, ytdlp, provider, url]);

  // The host renders the submit button, so the gate result travels with it
  // instead of being duplicated — one source of truth for "can I submit".
  useEffect(() => {
    onControls?.({
      run: () => void run(),
      disabled: !!blocked || busy || !ackCost || !ackRights,
      busy,
      label: busy ? "下载并转写中…" : "下载并转写",
    });
  });

  async function run() {
    if (!provider) return;
    setBusy(true);
    setNote(null);
    setTranscript(null);
    try {
      const created = await jobsApi.create({
        // Identity per URL, so the same video is not transcribed twice.
        intentId: `yt:${provider.id}:${language}:${url.trim()}`,
        type: "youtube_transcription",
        providerId: provider.id,
        credentialRef: provider.id,
        input: { url: url.trim(), languageCode: language },
      });
      setJob(created.job);

      if (!created.created) {
        setNote("这个链接之前已经转写过，复用了同一个任务，不会重复计费。");
        return;
      }

      const out = await jobsApi.run(created.job.id);
      setJob(out.job);
      if (out.asset) {
        const raw = await assetsApi.readText(out.asset.id);
        try {
          setTranscript(JSON.parse(raw));
        } catch {
          setTranscript({ text: raw });
        }
        return;
      }
      if (out.reason) setNote(out.reason);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "转写失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-8">
      {ytdlp && !ytdlp.available && (
        <Notice tone="warn">
          本机未找到 <code className="font-mono text-xs">yt-dlp</code>，
          该功能不可用。安装方式：<code className="font-mono text-xs">{ytdlp.install}</code>。
        </Notice>
      )}

      {!compact && (
        <Notice tone="info">
          流程：<strong>yt-dlp（开源）</strong>下载公开视频的音轨 → 存入本机素材库 →
          用**你自己的** STT Provider 转写。全程不经过任何第三方转写服务。
        </Notice>
      )}

      <section className="stack gap-3">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">YouTube 链接</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={EXAMPLES[0]}
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none placeholder:text-subtle"
          />
        </label>
        <p className="text-xs text-subtle">
          仅接受公开链接。不绕过登录墙、年龄门槛或付费墙，也不读取你的浏览器 Cookie。
        </p>
      </section>

      <label className="stack gap-1.5 text-sm sm:max-w-xs">
        <span className="text-secondary">语言</span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
        >
          <option value="auto">自动识别</option>
          <option value="en">英语</option>
          <option value="zh">中文</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
          <option value="de">德语</option>
          <option value="fr">法语</option>
          <option value="es">西班牙语</option>
        </select>
      </label>

      <Notice tone="warn">
        下载的音轨会发送到 {provider?.baseURL ?? "你的 Provider"} 进行转写并产生费用，
        本地无法获知金额，一律记为「费用未知」。
      </Notice>

      <div className="stack gap-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ackRights}
            onChange={(e) => setAckRights(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-secondary">
            我确认对该内容有合法的处理权，仅用于本地转写，不用于再分发。
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={ackCost}
            onChange={(e) => setAckCost(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-secondary">
            我了解会产生费用、金额未知，并同意发送该音轨到{" "}
            {provider?.baseURL ?? "Provider"}。
          </span>
        </label>
      </div>

      {note && <Notice tone="error">{note}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        {!compact && (
          <button
            type="button"
            disabled={!!blocked || busy || !ackCost || !ackRights}
            onClick={run}
            className="focus-ring h-9 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background hover:bg-gray-800 disabled:bg-gray-400"
          >
            {busy ? "下载并转写中…" : "下载并转写"}
          </button>
        )}
        {blocked && <span className="text-xs text-secondary">{blocked}</span>}
      </div>

      {job && (
        <section className="stack gap-2 rounded-xl border border-gray-alpha-150 p-4">
          <h2 className="text-sm font-medium text-foreground">任务 {job.status}</h2>
          {job.error && (
            <p className="text-xs text-amber-700">
              {job.error.safeMessage}（提交确定性：{job.error.submissionCertainty}）
            </p>
          )}
        </section>
      )}

      {transcript && (
        <section className="stack gap-2 rounded-xl border border-gray-alpha-150 p-5">
          <h2 className="text-sm font-medium text-foreground">转写结果</h2>
          <p className="text-xs text-secondary">
            {transcript.text.length} 字符
            {transcript.source &&
              typeof transcript.source === "object" &&
              transcript.source !== null &&
              "durationSeconds" in transcript.source
              ? ` · 源视频时长 ${
                  (transcript.source as { durationSeconds?: number }).durationSeconds ?? "未知"
                } 秒`
              : ""}
          </p>
          <textarea
            readOnly
            value={transcript.text}
            rows={12}
            className="focus-ring w-full resize-y rounded-lg border border-gray-alpha-150 bg-background p-3 font-mono text-xs outline-none"
          />
          <p className="text-xs text-subtle">
            编辑这里的文字<strong>不会</strong>重新调用转写；如需重转请重新提交任务（会产生新费用）。
          </p>
        </section>
      )}

      <p className="text-xs text-secondary">
        需要 STT Provider？
        <Link to="/local/settings/providers" className="ml-1 underline">
          去本地设置
        </Link>
      </p>
    </div>
  );
}

async function toolsApi(): Promise<ToolStatus[]> {
  const res = await fetch("/api/v1/tools");
  const body = await res.json();
  return body.tools ?? [];
}
