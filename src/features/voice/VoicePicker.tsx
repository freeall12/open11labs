import { useEffect, useMemo, useState } from "react";
import { ApiError, voices as voicesApi, type VoiceRecord } from "@/lib/api";

/* ==========================================================================
   Voice picker.

   Two behaviours matter more than the layout:
     - an unrecognised provider payload shows the reason, not an empty grid
     - if the selected voice is no longer in the list, it is reported and NOT
       quietly swapped for another one. Silently changing the voice would
       produce audio the user did not ask for, from a voice they cannot see.
   ========================================================================== */

const LANGUAGE_LABELS: Record<string, string> = {
  en: "英语", zh: "中文", es: "西班牙语", fr: "法语", de: "德语",
  it: "意大利语", pt: "葡萄牙语", pl: "波兰语", ru: "俄语", ja: "日语",
  ko: "韩语", nl: "荷兰语", tr: "土耳其语", ar: "阿拉伯语", cs: "捷克语",
  da: "丹麦语", fi: "芬兰语", el: "希腊语", hi: "印地语", hu: "匈牙利语",
  id: "印尼语", no: "挪威语", ro: "罗马尼亚语", sv: "瑞典语", th: "泰语",
  uk: "乌克兰语", vi: "越南语",
};

export function VoicePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<VoiceRecord[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [needsProvider, setNeedsProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");

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

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const v of items) for (const k of Object.keys(v.labels ?? {})) set.add(k);
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((v) => {
      if (language !== "all" && !(v.labels ?? {})[language]) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.voiceId.toLowerCase().includes(q) ||
        (v.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, language]);

  /**
   * A selected voice that has vanished is a fact the user must see. We do not
   * substitute another one.
   */
  const selectedMissing =
    value !== "" &&
    !loading &&
    items.length > 0 &&
    !items.some((v) => v.voiceId === value);

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
          {needsProvider ? (
            <>
              尚未配置 Provider，无法读取音色。
            </>
          ) : (
            reason
          )}
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
          {filtered.map((v) => {
            const selected = v.voiceId === value;
            return (
              <li key={v.voiceId}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onChange(v.voiceId)}
                  className={`focus-ring flex w-full items-center gap-2 rounded-xl border p-2 text-left transition-colors disabled:opacity-50 ${
                    selected
                      ? "border-gray-950 bg-gray-alpha-100"
                      : "border-gray-alpha-150 hover:bg-gray-alpha-50"
                  }`}
                >
                  {v.previewUrl ? (
                    <audio
                      controls
                      preload="none"
                      src={v.previewUrl}
                      onClick={(e) => e.stopPropagation()}
                      className="h-8 w-24 shrink-0"
                    />
                  ) : (
                    <span className="h-8 w-24 shrink-0 rounded bg-gray-alpha-100" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {v.name}
                    </span>
                    <span className="block truncate font-mono text-xs text-subtle">
                      {v.voiceId}
                    </span>
                    {v.category && (
                      <span className="text-xs text-secondary">{v.category}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
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
