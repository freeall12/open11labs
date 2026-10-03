import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, voices as voicesApi, type VoiceRecord } from "@/lib/api";
import { Modal, SegmentedTabs } from "@/features/shared/Modal";
import { PreviewBar } from "@/features/voice/PreviewBar";

/* ==========================================================================
   Voice library.

   Reference layout: title, two tabs (探索 / 我的音色), a search field, a
   filter cluster, category chips, then the grid.

   Removed per SCOPE.md, not hidden: the "收入" button beside 创建音色. That is
   the creator earnings entry point, and it leads to payouts, analytics and
   commercial licensing — all excluded. The dark "创建音色" button stays and
   keeps its place in the row, so the header stays balanced rather than
   leaving a hole.

   The voice list is whatever the user's own Provider reports. An empty or
   unrecognised response shows the provider's reason, never a placeholder grid
   and never a fabricated catalogue.
   ========================================================================== */

/** Category chips, in the reference's order. */
const CATEGORIES = [
  { id: "conversational", label: "对话式" },
  { id: "narrative", label: "旁白" },
  { id: "characters", label: "角色" },
  { id: "social-media", label: "社交媒体" },
  { id: "educational", label: "教育类" },
  { id: "advertising", label: "广告" },
  { id: "entertainment", label: "娱乐" },
];

/**
 * Category mark drawn inside each chip, matching the reference's chip row.
 * Decorative only: the filter itself is the button, not the glyph.
 */
function CategoryIcon({ id }: { id: string }) {
  const glyphs: Record<string, React.ReactNode> = {
    conversational: (
      <>
        <path d="M3 4.5h3l4 4 4-4h3" />
        <path d="M3 11.5h3l2-2M17 11.5h-3l-2-2" />
      </>
    ),
    narrative: (
      <>
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        <path d="M5 6h6M5 8.5h6M5 11h3.5" />
      </>
    ),
    characters: (
      <>
        <circle cx="8" cy="6" r="2.4" />
        <path d="M3.6 13.5a4.4 4.4 0 018.8 0" />
      </>
    ),
    "social-media": (
      <>
        <path d="M13 3.5a2.6 2.6 0 00-3.7 3.7L3.5 13v2.5H6L11.8 9.8" />
        <path d="M8 8l5 5" />
        <path d="M12.5 8.5h3v3" />
      </>
    ),
    educational: (
      <>
        <path d="M8 3l5.5 2.5L8 8 2.5 5.5 8 3z" />
        <path d="M4.5 6.6V10c0 1 1.6 2 3.5 2s3.5-1 3.5-2V6.6" />
      </>
    ),
    advertising: (
      <>
        <path d="M3 9.5v-3h6l4-2.5v9L9 10.5H3z" />
        <path d="M5.5 8v1.5" />
      </>
    ),
    entertainment: (
      <>
        <path d="M4 7.5h8v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5z" />
        <path d="M6 7.5V4.5h4v3" />
      </>
    ),
  };
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {glyphs[id] ?? <circle cx="8" cy="8" r="5" />}
    </svg>
  );
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: "英语", zh: "中文", es: "西班牙语", fr: "法语", de: "德语",
  it: "意大利语", pt: "葡萄牙语", pl: "波兰语", ru: "俄语", ja: "日语",
  ko: "韩语", nl: "荷兰语", tr: "土耳其语", ar: "阿拉伯语", cs: "捷克语",
  da: "丹麦语", fi: "芬兰语", el: "希腊语", hi: "印地语", hu: "匈牙利语",
  id: "印尼语", no: "挪威语", ro: "罗马尼亚语", sv: "瑞典语", th: "泰语",
  uk: "乌克兰语", vi: "越南语",
};

type Sort = "default" | "name";

export function VoiceLibraryPage() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<VoiceRecord[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [needsProvider, setNeedsProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("default");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(params.get("action") === "create");
  const [cloneType, setCloneType] = useState<string | null>(params.get("creationType"));
  const [preview, setPreview] = useState<VoiceRecord | null>(null);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const v of items) for (const k of Object.keys(v.labels ?? {})) set.add(k);
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter((v) => {
      if (language !== "all" && !(v.labels ?? {})[language]) return false;
      if (categories.length > 0) {
        const c = (v.category ?? "").toLowerCase();
        if (!categories.some((x) => c.includes(x.toLowerCase()))) return false;
      }
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.voiceId.toLowerCase().includes(q) ||
        (v.category ?? "").toLowerCase().includes(q)
      );
    });
    // The provider's list carries no creation date, so "最新" cannot be
    // ordered honestly. It is left out of the menu rather than offered as a
    // control that silently does nothing.
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [items, query, language, categories, sort]);
  const grouped = useMemo(() => {
    if (items.length === 0) return [];
    return [{ id: "all", label: "热门音色", voices: filtered.slice(0, 9) }];
  }, [items, filtered]);

  function closeCreate() {
    setCreateOpen(false);
    setCloneType(null);
    setParams((p) => {
      p.delete("action");
      p.delete("creationType");
      return p;
    });
  }

  return (
    <div className="stack gap-6 pb-24">
      <h1 className="font-waldenburg text-3xl font-normal text-foreground">音色</h1>

      <div className="flex items-end justify-between gap-4 border-b border-gray-alpha-150">
        <div className="flex items-center gap-4">
          <TabLink to="/app/voice-library" label="探索" active />
          <TabLink to="/app/voice-lab" label="我的音色" />
        </div>
        {/* The upstream 收入 control sat to the left of this button. SCOPE.md
            removes creator earnings, so the row now carries only the create
            action and nothing is left holding the gap open. */}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="focus-ring mb-2 inline-flex h-9 items-center gap-2 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          创建音色
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-64 flex-1">
          <span className="sr-only">搜索声音库中的音色</span>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索声音库中的音色…"
            className="focus-ring h-10 w-full rounded-[10px] border border-gray-alpha-150 bg-background py-0 pr-10 pl-9 text-sm outline-none placeholder:text-subtle"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 10v4h3l5 4V6L7 10H4z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </label>

        {/* The reference pairs a 筛选器 disclosure with a separate sort
            control (038/039). Collapsing them into one select made the sort
            unreachable behind a label that promised filters. */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-label="更多筛选项"
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-[10px] border border-gray-alpha-150 bg-background px-3 text-sm transition-colors hover:bg-gray-alpha-50"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="16" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="10" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          筛选器
        </button>

        <label className="relative">
          <span className="sr-only">排序</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="排序"
            className="focus-ring h-10 appearance-none rounded-[10px] border border-gray-alpha-150 bg-background pl-3 pr-8 text-sm outline-none"
          >
            <option value="default">默认排序</option>
            <option value="name">按名称</option>
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        </label>
      </div>

      {filtersOpen && (
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">语言</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="focus-ring h-9 appearance-none rounded-full border border-gray-alpha-150 bg-background pl-4 pr-8 text-sm outline-none"
          >
            <option value="all">语言</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l] ?? l}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        </label>

        {/* The reference draws a hairline between the language control and the
            category chips; without it the two read as one undifferentiated row. */}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-gray-alpha-150" />

        {CATEGORIES.map((c) => {
          const on = categories.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setCategories((p) =>
                  on ? p.filter((x) => x !== c.id) : [...p, c.id],
                )
              }
              className={`focus-ring flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors ${
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-gray-alpha-150 text-secondary hover:border-gray-alpha-200"
              }`}
            >
              <CategoryIcon id={c.id} />
              {c.label}
            </button>
          );
        })}
      </div>
      )}

      {loading && <p className="text-sm text-secondary">读取音色列表…</p>}

      {reason && (
        <div className="rounded-xl border border-gray-alpha-150 bg-gray-alpha-50 p-4 text-sm">
          {needsProvider ? (
            <>
              尚未配置 Provider，无法读取音色列表。
              <Link to="/local/settings/providers" className="ml-1 underline">
                去本地设置添加密钥
              </Link>
            </>
          ) : (
            reason
          )}
        </div>
      )}

      {!loading && !reason && filtered.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
          没有匹配的音色。调整筛选条件或搜索词。
        </p>
      )}

      {grouped.map((g) => (
        <section key={g.id} className="stack gap-4">
          <h2 className="flex items-center gap-1 text-sm font-medium text-foreground">
            {g.label}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4.5 2.5L7.5 6l-3 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </h2>
          <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {g.voices.map((v) => (
              <VoiceCard key={v.voiceId} voice={v} onPreview={() => setPreview(v)} />
            ))}
          </ul>
        </section>
      ))}

      <PreviewBar
        voice={preview}
        voices={items}
        onSelect={setPreview}
        onClose={() => setPreview(null)}
      />

      {createOpen && (
        <CreateVoiceDialog
          preset={cloneType}
          onClose={closeCreate}
          onPick={setCloneType}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------- my voices -- */

export function MyVoicesPage() {
  const [items, setItems] = useState<VoiceRecord[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<VoiceRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await voicesApi.list();
        setItems(res.voices);
        setReason(res.reason);
      } catch (err) {
        setReason(err instanceof ApiError ? err.message : "音色列表不可用");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="stack gap-6 pb-24">
      <h1 className="font-waldenburg text-3xl font-normal text-foreground">我的音色</h1>

      <div className="flex items-end justify-between gap-4 border-b border-gray-alpha-150">
        <div className="flex items-center gap-4">
          <TabLink to="/app/voice-library" label="探索" />
          <TabLink to="/app/voice-lab" label="我的音色" active />
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="focus-ring mb-2 inline-flex h-9 items-center gap-2 rounded-[10px] bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-gray-800"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          创建音色
        </button>
      </div>

      <p className="rounded-lg bg-gray-alpha-50 px-3 py-2 text-sm text-secondary">
        本地音色库。创建/克隆需要你的 Provider 具备对应能力并通过权限校验；
        云端账号配额与「已用字符数」标签按范围裁剪移除。
      </p>

      {loading && <p className="text-sm text-secondary">读取音色列表…</p>}
      {reason && <p className="text-sm text-amber-700">{reason}</p>}

      {!loading && !reason && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-alpha-200 px-4 py-10 text-center text-sm text-secondary">
          还没有音色。
        </p>
      )}

      {items.length > 0 && (
        <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((v) => (
            <VoiceCard key={v.voiceId} voice={v} onPreview={() => setPreview(v)} />
          ))}
        </ul>
      )}

      <PreviewBar voice={preview} voices={items} onSelect={setPreview} onClose={() => setPreview(null)} />
      {createOpen && <CreateVoiceDialog onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- card -- */

function VoiceCard({ voice, onPreview }: { voice: VoiceRecord; onPreview: () => void }) {
  const langs = Object.keys(voice.labels ?? {});
  return (
    <li className="group/voice flex items-center gap-3">
      <button
        type="button"
        onClick={onPreview}
        aria-label={`试听 ${voice.name}`}
        className="focus-ring relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-alpha-100"
      >
        {voice.previewUrl ? (
          <audio
            controls
            preload="none"
            src={voice.previewUrl}
            onClick={(e) => e.stopPropagation()}
            className="h-full w-full"
          />
        ) : (
          <span className="text-xs text-subtle">试听</span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{voice.name}</p>
        {voice.category && (
          <p className="truncate text-xs text-secondary">{voice.category}</p>
        )}
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-secondary">
          {langs[0] && <span>{LANGUAGE_LABELS[langs[0]] ?? langs[0]}</span>}
          {langs.length > 1 && <span className="text-subtle">+{langs.length - 1}</span>}
          {voice.unverified && (
            <span
              title="该音色未经过真实 API 验证"
              className="rounded bg-amber-50 px-1 text-[10px] text-amber-700"
            >
              未验证
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------- create -- */

const CREATE_OPTIONS = [
  {
    id: "cloneVoice",
    label: "即时克隆",
    detail: "上传或录制一段样本，快速得到一个音色",
  },
  {
    id: "voiceDesign",
    label: "声音设计",
    detail: "用文字描述想要的音色，由模型生成",
  },
  {
    id: "professional",
    label: "专业克隆",
    detail: "更长样本与质量审核，耗时更久",
  },
];

/**
 * Create-voice dialog. The upstream flow is a menu of creation types followed
 * by a type-specific form; the reference for the deeper steps was not
 * captured past the first screen, so each branch states its own gate rather
 * than pretending to a verified flow.
 */
function CreateVoiceDialog({
  preset,
  onClose,
  onPick,
}: {
  preset?: string | null;
  onClose: () => void;
  onPick?: (id: string) => void;
}) {
  const [step, setStep] = useState<"menu" | "form">(preset ? "form" : "menu");
  const [type, setType] = useState(preset ?? "cloneVoice");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sample, setSample] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const active = CREATE_OPTIONS.find((o) => o.id === type);

  return (
    <Modal
      open
      onClose={onClose}
      title="创建音色"
      footer={
        <>
          {note && <span className="mr-auto text-xs text-amber-700">{note}</span>}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-9 rounded-[10px] px-3 text-sm text-secondary hover:bg-gray-alpha-50"
          >
            取消
          </button>
          {step === "form" && (
            <button
              type="button"
              disabled
              className="focus-ring h-9 cursor-not-allowed rounded-[10px] bg-gray-300 px-4 text-sm font-medium text-white"
              title="需要 Provider 支持该能力，尚未核验"
            >
              继续
            </button>
          )}
        </>
      }
    >
      <div className="stack gap-4">
        {step === "menu" ? (
          <ul className="stack gap-2">
            {CREATE_OPTIONS.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    setType(o.id);
                    setStep("form");
                    onPick?.(o.id);
                  }}
                  className="focus-ring w-full rounded-xl border border-gray-alpha-150 px-4 py-3 text-left transition-colors hover:bg-gray-alpha-50"
                >
                  <span className="block text-sm font-medium text-foreground">{o.label}</span>
                  <span className="block text-xs text-secondary">{o.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <SegmentedTabs
              options={CREATE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
              value={type}
              onChange={(v) => setType(v)}
              size="sm"
            />
            <p className="text-sm text-secondary">{active?.detail}</p>

            <label className="stack gap-1.5 text-sm">
              <span className="text-secondary">音色名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="给这个音色起个名字"
                className="focus-ring h-9 w-full rounded-lg border border-gray-alpha-150 bg-background px-3 text-sm outline-none placeholder:text-subtle"
              />
            </label>

            {type === "voiceDesign" ? (
              <label className="stack gap-1.5 text-sm">
                <span className="text-secondary">描述你想要的音色</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="例如：沉稳的中年男声，语速偏慢，带一点磁性"
                  className="focus-ring w-full resize-y rounded-lg border border-gray-alpha-150 bg-background p-3 text-sm outline-none placeholder:text-subtle"
                />
              </label>
            ) : (
              <label className="stack gap-1.5 text-sm">
                <span className="text-secondary">样本音频</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    setSample(e.target.files?.[0] ?? null);
                    setNote(null);
                  }}
                  className="focus-ring w-full text-sm file:mr-3 file:rounded-[10px] file:border-0 file:bg-gray-alpha-100 file:px-3 file:py-1.5 file:text-sm"
                />
                {sample && <span className="text-xs text-secondary">{sample.name}</span>}
              </label>
            )}

            {type !== "voiceDesign" && (
              <label className="flex items-start gap-2 text-xs text-secondary">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  我确认对该音频拥有合法处理权，且获得被模仿者的许可。
                  未确认授权不会提交。
                </span>
              </label>
            )}

            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              克隆/设计会产生费用，金额未知；创建成功后该音色保存在你的 Provider 账户中，
              本应用只保存引用，不托管音频。
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- pieces -- */

function TabLink({ to, label, active }: { to: string; label: string; active?: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`focus-ring -mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm transition-colors ${
        active
          ? "border-foreground font-medium text-foreground"
          : "border-transparent text-secondary hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
