import { useEffect, useRef, useState } from "react";
import { HOME_TOOLS, type HomeTool, type ToolId } from "@/data/tools";
import {
  IconAvatarSparkle,
  IconCaption,
  IconImage,
  IconMic,
  IconMore,
  IconMusic,
  IconStudio,
  IconVideo,
  IconVoiceClones,
  IconWaveform,
} from "@/lib/icons";
import type { ComponentType, SVGProps } from "react";
import { Link, useNavigate } from "react-router-dom";

const TOOL_ICONS: Record<ToolId, ComponentType<SVGProps<SVGSVGElement>>> = {
  speech: IconWaveform,
  music: IconMusic,
  "voice-clone": IconVoiceClones,
  image: IconImage,
  video: IconVideo,
  // 配音 and 转录 had shared IconCaption, so two of the ten tiles were
  // pixel-identical. src/lib/icons ships no dubbing glyph; the mic is the
  // closest distinct one and reads as a spoken-performance tool. A real
  // dubbing icon needs an addition to the shared icon set — reported, not
  // worked around by editing another owner's file.
  dubbing: IconMic,
  avatar: IconAvatarSparkle,
  transcribe: IconCaption,
  audiobooks: IconStudio,
  more: IconMore,
};

/** Destinations the ten-tile row has no room for. */
const EXTRA_TOOLS: { label: string; href: string }[] = [
  { label: "人声分离", href: "/app/voice-isolator" },
  { label: "变声器", href: "/app/speech-synthesis/speech-to-speech" },
  { label: "工作室模板", href: "/app/studio/templates" },
  { label: "品牌套件", href: "/app/files/brand-kits" },
  { label: "生成历史", href: "/app/image-video/history" },
  { label: "音频检测", href: "/app/audio-detector" },
];

function ToolCard({ tool, onMore }: { tool: HomeTool; onMore: (open: boolean) => void }) {
  const Icon = TOOL_ICONS[tool.id];

  // The whole card is one hit target. The visible content ignores pointer
  // events so the overlay underneath owns the click, exactly as upstream.
  const overlayClass =
    "focus-ring absolute -inset-x-2 -inset-y-3.5 rounded-2xl transition-colors duration-150 hover:bg-gray-alpha-100 data-[state=open]:bg-gray-alpha-100";

  return (
    <div className="relative flex w-[81px] justify-center">
      {tool.href ? (
        <Link to={tool.href} className={overlayClass}>
          <span className="sr-only">{tool.label}</span>
        </Link>
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          aria-label="更多工具"
          onClick={() => onMore(true)}
          className={overlayClass}
        >
          <span className="sr-only">{tool.label}</span>
        </button>
      )}

      <div className="stack pointer-events-none relative items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-gray-600 shadow-natural-xs [&_svg]:h-5 [&_svg]:w-5 dark:from-gray-alpha-100 dark:to-gray-alpha-150 dark:bg-linear-to-b dark:ring-1 dark:ring-gray-alpha-150">
          <Icon className="shrink-0" />
        </div>
        <div className="line-clamp-1 text-center text-sm font-medium text-foreground">
          {tool.label}
        </div>
      </div>
    </div>
  );
}

export function ToolGrid() {
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);

  // A menu that ignores Escape and outside clicks is a menu that traps people.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [moreOpen]);

  return (
    /* Ten tiles across at the reference width, stepping down rather than
       wrapping into a ragged block.

       `w-fit` is load-bearing, not cosmetic: with `w-full` the ten 1fr columns
       each stretch to ~100px, which puts the tile pitch at 117px. The reference
       measures 97px — ten 81px columns plus nine 16px gaps, 954px in total — so
       the grid has to shrink-wrap its content and centre itself. */
    <div
      ref={wrap}
      className="relative mx-auto grid w-fit grid-cols-4 gap-x-4 gap-y-8 min-[700px]:grid-cols-5 min-[900px]:grid-cols-10"
    >
      {HOME_TOOLS.map((tool) => (
        <ToolCard key={tool.id} tool={tool} onMore={setMoreOpen} />
      ))}

      {moreOpen && (
        <div
          role="menu"
          aria-label="更多工具"
          className="absolute top-full right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-gray-alpha-150 bg-background py-1 shadow-lg"
        >
          {EXTRA_TOOLS.map((t) => (
            <button
              key={t.href}
              type="button"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                navigate(t.href);
              }}
              className="focus-ring block w-full px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-gray-alpha-50 hover:text-foreground"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
