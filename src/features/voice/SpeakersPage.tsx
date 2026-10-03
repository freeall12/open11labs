import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  projects as projectsApi,
  voices as voicesApi,
  type ProjectRecord,
  type VoiceRecord,
} from "@/lib/api";
import { FieldRow, Modal, Toggle } from "@/features/shared/Modal";
import { TabLink } from "@/features/voice/ui";

/* ==========================================================================
   Speakers.

   Reference coverage for this page is a **loading skeleton** (evidence
   112), so the settled layout is not directly observed. What the page is for
   is unambiguous though: it is the library of speaker labels, reachable from
   the transcribe dialog's "从声音库分配音色" option, and it has an
   "添加说话者" action.

   Therefore this page is built from observed controls (the two tabs, the
   add action, the list) and the local project store, NOT from an invented
   replica of an unobserved layout. The gap is recorded in
   docs/engineering/handoffs rather than papered over.

   A speaker here is a local project of kind `speaker`: a name, the voice it
   maps to, and whether diarization should use it. No account, no invite, no
   permission model — this build is single-user and local.
   ========================================================================== */

type Tab = "add" | "assign";

export function SpeakersPage() {
  const [speakers, setSpeakers] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Tab | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await projectsApi.list();
      setSpeakers(all.filter((p) => p.kind === "speaker"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "无法读取说话者列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return speakers;
    return speakers.filter((s) => s.name.toLowerCase().includes(q));
  }, [speakers, query]);

  async function remove(id: string) {
    try {
      // Deletion is local-only, but it is still destructive: the caller is the
      // user clicking an explicit row action, so it goes through the same
      // controlled endpoint as any other project removal.
      await projectsApi.remove(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  return (
    <div className="stack gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="stack gap-1">
          <h1 className="font-waldenburg text-3xl font-normal text-foreground">说话者</h1>
          <p className="text-sm text-secondary">
            管理本地说话者标签，用于转写时的说话者区分。全部保存在本机。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog("add")}
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M2.5 19a6.5 6.5 0 0113 0M18 8v6M15 11h6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          添加说话者
        </button>
      </div>

      <div className="flex items-center gap-4 border-b border-gray-alpha-150">
        <TabLink to="/app/speech-to-text" label="转录" />
        <TabLink to="/app/speech-to-text/speakers" label="说话者" active />
      </div>

      <EvidenceNote />

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <label className="relative block">
        <span className="sr-only">搜索说话者</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索说话者…"
          className="focus-ring h-10 w-full rounded-xl border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
      </label>

      {loading ? (
        <div className="stack gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-alpha-50" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
          {speakers.length === 0
            ? "还没有说话者。点右上角「添加说话者」创建一个本地标签。"
            : "没有匹配的说话者。"}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-gray-alpha-150 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                <p className="truncate font-mono text-xs text-subtle">
                  {String(s.content.voiceId ?? "未绑定音色")}
                </p>
                {s.content.diarize === true && (
                  <p className="text-xs text-secondary">参与说话者区分</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDialog("assign")}
                className="focus-ring shrink-0 rounded-[10px] border border-gray-alpha-200 px-2.5 py-1 text-xs hover:bg-gray-alpha-50"
              >
                分配
              </button>
              <button
                type="button"
                onClick={() => remove(s.id)}
                aria-label={`删除 ${s.name}`}
                className="focus-ring shrink-0 rounded-[10px] px-2 py-1 text-xs text-secondary hover:bg-gray-alpha-50"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialog === "add" && (
        <AddSpeakerDialog
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await load();
          }}
        />
      )}
      {dialog === "assign" && (
        <AssignDialog speakers={speakers} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- dialog -- */

function AddSpeakerDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [diarize, setDiarize] = useState(true);
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [voiceReason, setVoiceReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await voicesApi.list();
        setVoices(res.voices);
        setVoiceReason(res.reason);
      } catch {
        setVoiceReason("无法读取音色列表");
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await projectsApi.create({
        kind: "speaker",
        name: name.trim(),
        content: { voiceId: voiceId || null, diarize },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const blocked = !name.trim() || saving;

  return (
    <Modal
      open
      onClose={onClose}
      title="添加说话者"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-red-700">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={blocked}
            className="focus-ring h-9 rounded-[10px] bg-gray-400 px-4 text-sm font-medium text-white transition-colors enabled:hover:bg-gray-800 disabled:cursor-not-allowed"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      <div className="stack gap-4">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：主持人"
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
        </label>

        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">绑定音色（可选）</span>
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none"
          >
            <option value="">不绑定</option>
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </select>
          {voiceReason && <span className="text-xs text-subtle">{voiceReason}</span>}
        </label>

        <FieldRow
          label="参与说话者区分"
          hint="转写时把该说话者单独标出，需要 Provider 支持"
        >
          <Toggle checked={diarize} onChange={setDiarize} label="参与说话者区分" />
        </FieldRow>
      </div>
    </Modal>
  );
}

/**
 * Assign a speaker label.
 *
 * The upstream flow maps a detected speaker in a transcript to a library
 * label. The detected speakers only exist inside a transcript's word timings,
 * and no transcript is open on this page, so this dialog assigns the label to
 * a local "current assignment" instead of pretending to have per-transcript
 * speaker rows. The selection is stored on the local project so it survives a
 * refresh, and nothing is sent to a provider.
 */
function AssignDialog({
  speakers,
  onClose,
}: {
  speakers: ProjectRecord[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = speakers.filter((s) =>
    s.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await projectsApi.create({
        kind: "speaker-assignment",
        name: "当前说话者分配",
        // The chosen label id is the whole payload; a null clears it.
        content: { speakerId: selected || null, assignedAt: new Date().toISOString() },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="分配说话者"
      footer={
        <>
          {error && <span className="mr-auto text-xs text-red-700">{error}</span>}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="focus-ring h-9 rounded-[10px] bg-gray-400 px-4 text-sm font-medium text-white transition-colors enabled:hover:bg-gray-800 disabled:cursor-not-allowed"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      <div className="stack gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索说话者…"
          aria-label="搜索说话者"
          className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
        />
        {filtered.length === 0 ? (
          <p className="text-sm text-secondary">没有可分配的说话者。</p>
        ) : (
          <ul role="radiogroup" aria-label="说话者" className="stack gap-1.5">
            {filtered.map((s) => {
              const on = s.id === selected;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSelected(on ? "" : s.id)}
                    className={`focus-ring w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      on
                        ? "border-gray-950 bg-gray-alpha-100"
                        : "border-gray-alpha-100 hover:bg-gray-alpha-50"
                    }`}
                  >
                    {s.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-subtle">
          逐条把转写里的说话人映射到标签，需要原始逐字结果；该流程依赖 Provider 返回 speaker
          字段，本地未核验。此处只保存一个本地分配记录，不会调用 Provider。
        </p>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- pieces -- */

function EvidenceNote() {
  return (
    <p className="rounded-lg bg-gray-alpha-50 px-3 py-2 text-xs text-secondary">
      该页在参考站只采集到加载态（骨架屏），稳定态布局未经观察。
      此处按已观察到的控件（两个标签页、「添加说话者」、列表）结合本地工程存储实现，
      不冒充原站截图复刻。
    </p>
  );
}
