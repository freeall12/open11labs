import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, assets as assetsApi, type AssetRecord } from "@/lib/api";
import { ArtifactList } from "@/features/media/ArtifactList";
import { Notice } from "@/features/media/ui";

/* ==========================================================================
   Studio templates and local audio analysis.

   Media history used to live here as a separate page. It does not any more:
   131 shows 历史 as a *tab* of 图像和视频 with the same composer docked on it,
   so the page is one component in ImageVideoPage.tsx and both routes render it
   (see pages.tsx). Keeping a second list here would mean the history route
   showed no composer at all.
   ========================================================================== */

/** The shape `assets.probe` answers with, restated so no type import is needed. */
interface ProbeResult {
  supported: boolean;
  format: string;
  durationSeconds: number | null;
  reason: string | null;
  waveform: number[] | null;
  silenceSpans: [number, number][] | null;
  computedBy: "local";
}

function useAssets() {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await assetsApi.list();
      setAssets(res.assets);
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

  return { assets, loading, error, reload: load };
}

/**
 * Body wrapper. `title` is accepted so call sites can stay declarative, but
 * the page frame owns the heading — a body that also renders an <h1> produces
 * two competing page titles, which reads as a rendering bug.
 */
function Page({ title: _title, children }: { title: string; children: React.ReactNode }) {
  return <div className="stack gap-6">{children}</div>;
}

export function StudioTemplatesPage() {
  return (
    <Page title="工作室模板">
      <p className="text-sm text-secondary">
        模板是本地工程：一个已配置好的时间线/画布结构，可以复制成新项目再改。
        云端模板销售与团队共享按范围裁剪移除。
      </p>
      <p className="text-sm text-secondary">
        模板库尚未实现。工作室页可以创建本地项目，从那里开始搭建。
        <Link to="/app/studio" className="ml-1 underline">
          前往工作室
        </Link>
      </p>
    </Page>
  );
}

export function AudioDetectorPage() {
  const { assets, loading, error, reload } = useAssets();
  const audio = assets.filter((a) => a.mediaType.startsWith("audio/"));

  return (
    <Page title="音频检测">
      <p className="text-sm text-secondary">
        本地检测在素材库内完成，不需要 Provider 也不产生费用：读取时长、格式、静音区间与波形。
        结果由本机计算，标注为 local。
      </p>
      <ArtifactList
        assets={audio}
        loading={loading}
        error={error}
        onRetry={reload}
        empty="素材库里还没有音频。先上传或生成一个文件。"
      />
      {audio.length > 0 && <DetectorPanel assets={audio} />}
    </Page>
  );
}

function DetectorPanel({ assets }: { assets: AssetRecord[] }) {
  const [selected, setSelected] = useState<string>(assets[0].id);
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const out = await assetsApi.probe(id);
      setProbes((p) => ({ ...p, [id]: out }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "本地检测失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const probe = probes[selected];

  return (
    <section className="stack gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="选择音频"
          className="focus-ring h-9 max-w-xs rounded-xl border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
        >
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => run(selected)}
          disabled={busy}
          className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm transition-colors hover:bg-gray-alpha-50 disabled:opacity-50"
        >
          {busy ? "检测中…" : probe ? "重新检测" : "开始检测"}
        </button>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {probe && !probe.supported && <Notice tone="warn">{probe.reason ?? "无法解析该格式。"}</Notice>}

      {probe?.supported && (
        <div className="stack gap-3 rounded-xl border border-gray-alpha-150 p-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Field label="格式" value={probe.format} />
            <Field
              label="时长"
              value={probe.durationSeconds === null ? "未知" : `${probe.durationSeconds.toFixed(2)} 秒`}
            />
            <Field label="计算方" value={probe.computedBy === "local" ? "本机" : probe.computedBy} />
          </dl>

          {probe.waveform && probe.waveform.length > 0 && (
            <div className="stack gap-1.5">
              <p className="text-xs text-subtle">波形（{probe.waveform.length} 个采样点）</p>
              <Waveform peaks={probe.waveform} />
            </div>
          )}

          {probe.silenceSpans && probe.silenceSpans.length > 0 && (
            <div className="stack gap-1">
              <p className="text-xs text-subtle">静音区间</p>
              <ul className="text-xs text-secondary">
                {probe.silenceSpans.map(([from, to], i) => (
                  <li key={i}>
                    {from.toFixed(2)}s – {to.toFixed(2)}s（{(to - from).toFixed(2)} 秒）
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-secondary">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

/** Peaks drawn from the values the local probe returned — never a decorative shape. */
function Waveform({ peaks }: { peaks: number[] }) {
  return (
    <div className="flex h-16 items-center gap-px overflow-hidden rounded-lg bg-gray-alpha-50 px-1">
      {peaks.map((p, i) => (
        <span
          key={i}
          style={{ height: `${Math.max(4, Math.min(100, Math.round(p * 100)))}%` }}
          className="min-w-[1px] flex-1 rounded-full bg-gray-350"
        />
      ))}
    </div>
  );
}
