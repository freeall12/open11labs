import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ALL_ROUTES, PENDING_ROUTES, EXCLUDED_ROUTES } from "@/app/route-manifest";
import { IconSearch } from "@/lib/icons";

/* ==========================================================================
   Global search.

   Searches this build's own surface: in-scope routes, local settings and
   local projects. It deliberately does NOT index upstream content, because
   none of that is reachable from a BYOK local install.

   Excluded routes are filtered out of the index rather than shown-and-
   refused: offering a search hit for a page that must not exist would put
   the excluded surface back into the product.
   ========================================================================== */

const LABELS: Record<string, string> = {
  home: "主页",
  "voices-explore": "音色",
  "voice-create-query": "创建音色",
  "instant-clone": "即时克隆",
  "voice-design": "声音设计",
  "my-voices": "我的音色",
  tts: "文本转语音",
  sts: "变声器",
  isolator: "人声分离",
  stt: "语音转文本",
  speakers: "说话者",
  dubbing: "配音",
  sfx: "音效",
  "sfx-history": "音效历史",
  "sfx-favorites": "音效收藏",
  music: "音乐",
  "music-history": "音乐历史",
  "music-saved": "音乐收藏",
  "image-video": "图像和视频",
  "media-history": "生成历史",
  studio: "工作室",
  "studio-templates": "工作室模板",
  flows: "Flows",
  chat: "聊天",
  files: "素材",
  "brand-kits": "品牌套件",
  audiobooks: "有声书",
  "audio-detector": "音频检测",
  "local-provider-settings": "Provider 与密钥",
  "local-storage-settings": "存储设置",
  "local-jobs": "任务队列",
};

/** Grouping by owner mirrors the sidebar, so results land where users look. */
const GROUPS: Record<string, string> = {
  SHELL: "导航",
  VOICE: "音频与音色",
  MEDIA: "图像与媒体",
  EDITORS: "编辑器",
  STORAGE: "素材",
  CORE: "本地配置",
};

export function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const index = useMemo(
    () =>
      ALL_ROUTES.filter(
        (r) => !r.disposition && r.path !== null && r.kind !== "modal-query",
      ).map((r) => ({
        id: r.id,
        label: LABELS[r.id] ?? r.id,
        group: GROUPS[r.owner] ?? r.owner,
        href: r.path as string,
      })),
    [],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index;
    return index.filter(
      (r) => r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    );
  }, [index, query]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        const hit = results[cursor];
        if (hit) {
          navigate(hit.href);
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [results, cursor, navigate, onClose]);

  const byGroup = useMemo(() => {
    const m = new Map<string, typeof results>();
    for (const r of results) {
      const list = m.get(r.group) ?? [];
      list.push(r);
      m.set(r.group, list);
    }
    return [...m.entries()];
  }, [results]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="搜索所有内容"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-background shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-gray-alpha-100 px-4">
          <IconSearch size={16} className="shrink-0 text-subtle" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="搜索所有内容…"
            aria-label="搜索所有内容"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <kbd className="rounded border border-gray-alpha-150 px-1.5 py-0.5 text-[10px] text-subtle">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-secondary">
              没有匹配的页面。
            </p>
          ) : (
            byGroup.map(([group, items]) => (
              <div key={group} className="px-2 py-1">
                <p className="px-2 py-1 text-xs text-subtle">{group}</p>
                {items.map((r) => {
                  const idx = results.indexOf(r);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => {
                        navigate(r.href);
                        onClose();
                      }}
                      className={`focus-ring flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm ${
                        idx === cursor
                          ? "bg-gray-alpha-100 text-foreground"
                          : "text-secondary"
                      }`}
                    >
                      <span className="flex-1 truncate">{r.label}</span>
                      <span className="truncate font-mono text-xs text-subtle">{r.href}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-gray-alpha-100 px-4 py-2 text-xs text-subtle">
          仅搜索本版本内的创作页面与本地配置。
          已排除 {EXCLUDED_ROUTES.length} 个账号/营销路由，
          另有 {PENDING_ROUTES.length} 个路由待补采证据后再纳入。
        </div>
      </div>
    </div>
  );
}
