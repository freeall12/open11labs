import { useEffect, useMemo, useState } from "react";
import { ApiError, voices as voicesApi, type VoiceRecord } from "@/lib/api";
import { Modal, SegmentedTabs } from "@/features/shared/Modal";

/* ==========================================================================
   Voice picker.

   Two behaviours matter more than the layout:
     - an unrecognised provider payload shows the reason, not an empty grid
     - if the selected voice is no longer in the list, it is reported and NOT
       quietly swapped for another one. Silently changing the voice would
       produce audio the user did not ask for, from a voice they cannot see.

   `VoicePickerDialog` is the reference's picker (019–020): a modal with a
   filter row, a 探索 / 我的音色 tab pair, a search box and the voice list.
   The inline `VoicePicker` is kept for pages that want the control in place.
   ========================================================================== */

const LANGUAGE_LABELS: Record<string, string> = {
  en: "英语", zh: "中文", es: "西班牙语", fr: "法语", de: "德语",
  it: "意大利语", pt: "葡萄牙语", pl: "波兰语", ru: "俄语", ja: "日语",
  ko: "韩语", nl: "荷兰语", tr: "土耳其语", ar: "阿拉伯语", cs: "捷克语",
  da: "丹麦语", fi: "芬兰语", el: "希腊语", hi: "印地语", hu: "匈牙利语",
  id: "印尼语", no: "挪威语", ro: "罗马尼亚语", sv: "瑞典语", th: "泰语",
  uk: "乌克兰语", vi: "越南语",
};

/** Category chips in the reference's order. */
const CATEGORIES = ["对话式", "旁白", "角色", "社交媒体", "教育类", "广告", "娱乐"];

/** Shared loader so both pickers report an unrecognised payload the same way. */
function useVoiceList() {
  const [items, setItems] = useState<VoiceRecord[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [needsProvider, setNeedsProvider] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await voicesApi.list();
        setItems(res.voices);
        setReason(res.reason);
        setNeedsProvider(Boolean(res.needsProvider));
      } catch (err) {
        setReason(err instanceof ApiError ? err.message : "音色列表不可用");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { items, reason, needsProvider, loading };
}

function languagesOf(items: VoiceRecord[]) {
  const set = new Set<string>();
  for (const v of items) for (const k of Object.keys(v.labels ?? {})) set.add(k);
  return [...set].sort();
}

function matches(v: VoiceRecord, query: string, language: string, categories: string[]) {
  if (language !== "all" && !(v.labels ?? {})[language]) return false;
  if (categories.length > 0 && !categories.includes(v.category ?? "")) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    v.name.toLowerCase().includes(q) ||
    v.voiceId.toLowerCase().includes(q) ||
    (v.category ?? "").toLowerCase().includes(q)
  );
}

/* --------------------------------------------------------------- inline -- */

export function VoicePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}) {
  const { items, reason, needsProvider, loading } = useVoiceList();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");

  const languages = useMemo(() => languagesOf(items), [items]);
  const filtered = useMemo(
    () => items.filter((v) => matches(v, query, language, [])),
    [items, query, language],
  );

  /**
   * A selected voice that has vanished is a fact the user must see. We do not
   * substitute another one.
   */
  const selectedMissing =
    value !== "" && !loading && items.length > 0 && !items.some((v) => v.voiceId === value);

  return (
    <section className="stack gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">搜索音色</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称或 ID 搜索"
            disabled={disabled || loading}
            className="focus-ring h-9 w-56 rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle disabled:opacity-50"
          />
        </label>

        <label className="stack gap-1.5 text-sm">
          <span className="text-secondary">语言</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={disabled || loading || languages.length === 0}
            className="focus-ring h-9 rounded-lg border border-gray-alpha-150 bg-background px-2 text-sm outline-none disabled:opacity-50"
          >
            <option value="all">全部（{items.length}）</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l] ?? l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p className="text-sm text-secondary">读取音色列表…</p>}

      {reason && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {needsProvider ? "尚未配置 Provider，无法读取音色。" : reason}
        </p>
      )}

      {selectedMissing && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          已选音色 <span className="font-mono">{value}</span>{" "}
          不在当前可用列表中（可能已被删除或该密钥无权访问）。
          本应用不会自动换成别的音色，请重新选择。
        </p>
      )}

      {!loading && !reason && filtered.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-6 text-center text-sm text-secondary">
          没有匹配的音色。
        </p>
      )}

      {filtered.length > 0 && (
        <ul
          className="grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3"
          role="radiogroup"
          aria-label="音色"
        >
          {filtered.map((v) => (
            <li key={v.voiceId}>
              <VoiceRow
                voice={v}
                selected={v.voiceId === value}
                disabled={disabled}
                onSelect={() => onChange(v.voiceId)}
              />
            </li>
          ))}
        </ul>
      )}

      <details className="text-xs text-secondary">
        <summary className="cursor-pointer">手动输入音色 ID</summary>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="voice_xxxxxxxxxxxx"
          disabled={disabled}
          className="focus-ring mt-2 h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none disabled:opacity-50"
        />
      </details>
    </section>
  );
}

/* --------------------------------------------------------------- dialog -- */

export function VoicePickerDialog({
  value,
  onChange,
  onClose,
}: {
  value: string;
  /** Receives the whole record so the trigger can show a name, not just an id. */
  onChange: (voice: VoiceRecord) => void;
  onClose: () => void;
}) {
  const { items, reason, needsProvider, loading } = useVoiceList();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [tab, setTab] = useState<"explore" | "mine">("explore");
  // A local/self-hosted speech server publishes no voice catalogue, so without
  // a manual entry the dialog dead-ends and TTS is unselectable there. The id
  // is the user's own; it is echoed back verbatim, never invented.
  const [manual, setManual] = useState("");

  const languages = useMemo(() => languagesOf(items), [items]);

  /**
   * The provider's shared voice list is the only data available here, so the
   * 我的音色 tab cannot invent a separate collection. It says so instead of
   * rendering an empty grid that looks like a bug.
   */
  const filtered = useMemo(
    () => (tab === "explore" ? items.filter((v) => matches(v, query, language, categories)) : []),
    [items, query, language, categories, tab],
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="选择一个音色"
      width="max-w-2xl"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="focus-ring h-9 rounded-[10px] border border-gray-alpha-200 px-3 text-sm hover:bg-gray-alpha-50"
        >
          关闭
        </button>
      }
    >
      <div className="stack gap-4">
        <p className="text-sm text-secondary">浏览并选择音色。</p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">语言</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={languages.length === 0}
              className="focus-ring h-8 appearance-none rounded-full border border-gray-alpha-150 bg-background pl-3 pr-7 text-xs outline-none disabled:opacity-50"
            >
              <option value="all">语言</option>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l] ?? l}
                </option>
              ))}
            </select>
          </label>

          {CATEGORIES.map((c) => {
            const on = categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setCategories((p) => (on ? p.filter((x) => x !== c) : [...p, c]))
                }
                className={`focus-ring h-8 rounded-full border px-3 text-xs transition-colors ${
                  on
                    ? "border-foreground bg-foreground text-background"
                    : "border-gray-alpha-150 text-secondary hover:border-gray-alpha-200"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>

        <SegmentedTabs
          options={[
            { id: "explore", label: "探索" },
            { id: "mine", label: "我的音色" },
          ]}
          value={tab}
          onChange={setTab}
          size="sm"
        />

        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="开始输入以搜索…"
            aria-label="开始输入以搜索"
            className="focus-ring h-9 flex-1 rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清除"
              className="focus-ring rounded-[10px] px-2 py-1 text-xs text-secondary hover:bg-gray-alpha-50"
            >
              清除
            </button>
          )}
        </div>

        {loading && <p className="text-sm text-secondary">读取音色列表…</p>}

        {reason && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {needsProvider ? "尚未配置 Provider，无法读取音色。" : reason}
          </p>
        )}

        {tab === "mine" && !loading && (
          <p className="rounded-lg bg-gray-alpha-50 px-3 py-2 text-xs text-secondary">
            「我的音色」需要 Provider 返回该账户自建的音色列表。当前接口未提供该区分，
            因此这里只显示共享声音库，不伪造一个空集合。
          </p>
        )}

        {!loading && !reason && tab === "explore" && filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-6 text-center text-sm text-secondary">
            没有匹配的音色。
          </p>
        )}

        {filtered.length > 0 && (
          <ul role="radiogroup" aria-label="声音库音色" className="max-h-80 space-y-1 overflow-y-auto">
            {filtered.map((v) => (
              <li key={v.voiceId}>
                <VoiceRow
                  voice={v}
                  selected={v.voiceId === value}
                  onSelect={() => onChange(v)}
                />
              </li>
            ))}
          </ul>
        )}

        <details className="text-xs text-secondary">
          <summary className="cursor-pointer">手动输入音色 ID</summary>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="voice_xxxxxxxxxxxx"
              aria-label="手动音色 ID"
              className="focus-ring h-9 flex-1 rounded-lg border border-gray-alpha-150 bg-background px-3 font-mono text-xs outline-none"
            />
            <button
              type="button"
              disabled={!manual.trim()}
              onClick={() =>
                onChange({
                  voiceId: manual.trim(),
                  name: manual.trim(),
                  category: null,
                  previewUrl: null,
                  labels: {},
                  availableForTiers: null,
                  unverified: true,
                })
              }
              className="focus-ring h-9 shrink-0 rounded-lg border border-gray-alpha-200 px-3 text-xs hover:bg-gray-alpha-50 disabled:opacity-40"
            >
              使用此 ID
            </button>
          </div>
        </details>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- row -- */

function VoiceRow({
  voice,
  selected,
  disabled,
  onSelect,
}: {
  voice: VoiceRecord;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`focus-ring flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors disabled:opacity-50 ${
        selected
          ? "border-gray-950 bg-gray-alpha-100"
          : "border-gray-alpha-150 hover:bg-gray-alpha-50"
      }`}
    >
      {voice.previewUrl ? (
        <audio
          controls
          preload="none"
          src={voice.previewUrl}
          onClick={(e) => e.stopPropagation()}
          className="h-8 w-24 shrink-0"
        />
      ) : (
        <span className="h-8 w-24 shrink-0 rounded bg-gray-alpha-100" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{voice.name}</span>
        <span className="block truncate font-mono text-xs text-subtle">{voice.voiceId}</span>
        {voice.category && <span className="text-xs text-secondary">{voice.category}</span>}
        {voice.unverified && (
          <span
            title="该音色未经过真实 API 验证"
            className="rounded bg-amber-50 px-1 text-[10px] text-amber-700"
          >
            未验证
          </span>
        )}
      </span>
    </button>
  );
}
