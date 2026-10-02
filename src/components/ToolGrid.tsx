import { HOME_TOOLS, type HomeTool, type ToolId } from "@/data/tools";
import {
  IconAvatarSparkle,
  IconCaption,
  IconImage,
  IconMore,
  IconMusic,
  IconVideo,
  IconVoiceClones,
  IconWaveform,
} from "@/lib/icons";
import type { ComponentType, SVGProps } from "react";

const TOOL_ICONS: Record<ToolId, ComponentType<SVGProps<SVGSVGElement>>> = {
  speech: IconWaveform,
  music: IconMusic,
  "voice-clone": IconVoiceClones,
  image: IconImage,
  video: IconVideo,
  dubbing: IconCaption,
  avatar: IconAvatarSparkle,
  more: IconMore,
};

function ToolCard({ tool }: { tool: HomeTool }) {
  const Icon = TOOL_ICONS[tool.id];

  // The whole card is one hit target. The visible content ignores pointer
  // events so the overlay link underneath owns the click, exactly as upstream.
  const overlayClass =
    "focus-ring absolute -inset-x-2 -inset-y-3.5 rounded-2xl transition-colors duration-150 hover:bg-gray-alpha-100 data-[state=open]:bg-gray-alpha-100";

  return (
    <div className="relative flex w-[81px] justify-center">
      {tool.href ? (
        <a href={tool.href} className={overlayClass}>
          <span className="sr-only">{tool.label}</span>
        </a>
      ) : (
        <button type="button" className={overlayClass}>
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
  return (
    /* Upstream drops to six columns on narrower viewports, but the eight-across
       row already fits around 880px, so that is the breakpoint used here. */
    <div className="grid w-full grid-cols-4 gap-x-4 gap-y-8 justify-center *:mx-auto min-[700px]:grid-cols-6 min-[880px]:grid-cols-8">
      {HOME_TOOLS.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}
    </div>
  );
}
