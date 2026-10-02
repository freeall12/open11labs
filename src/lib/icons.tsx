import type { SVGProps } from "react";

/* ==========================================================================
   Icon set.

   The live page draws these as inline SVG. Its DOM snapshot exposes the
   element structure (e.g. the "more" glyph is one <path> + three <circle>)
   but the query layer strips path geometry, so the exact coordinates are not
   recoverable from the page. The shapes below are hand-built to match the
   rendered appearance at 24x24 with currentColor, and every icon here is a
   plain 2px stroke / filled path with no external dependency.

   Swap in a different `d` here if you have the original asset.
   ========================================================================== */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---------- Shell ---------- */

/** Sidebar toggle: a panel with a divider. */
export function IconPanel(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </Svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

/* ---------- Prompt bar ---------- */

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
    </Svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Svg>
  );
}

/* ---------- Homepage tool glyphs ---------- */

/** 语音 — an audio waveform, centre bars tallest. */
export function IconWaveform(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h1.5M7 8v8M10.5 4.5v15M14 7v10M17.5 9.5v5M21 12h-1.5" />
    </Svg>
  );
}

/** 音乐 — a single note with a flag. */
export function IconMusic(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Svg>
  );
}

/** 语音克隆 — four voice markers in a 2x2 block. */
export function IconVoiceClones(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="9" r="4" />
      <circle cx="15" cy="9" r="4" />
      <circle cx="9" cy="15" r="4" />
      <circle cx="15" cy="15" r="4" />
    </Svg>
  );
}

/** 图像 — a frame with a sun and a ridge. */
export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17" />
      <path d="m14 15 1.8-1.8a2 2 0 0 1 2.8 0L20 14.6" />
    </Svg>
  );
}

/** 视频 — a camera body with a viewfinder. */
export function IconVideo(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5 21 7v10l-5.5-3.5z" />
    </Svg>
  );
}

/** 配音 — a caption bubble. */
export function IconCaption(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.9A8 8 0 1 1 21 12Z" />
      <path d="M10 10.5h4M10 13.5h6" />
    </Svg>
  );
}

/** 虚拟形象 — a sparkle with swap arrows. */
export function IconAvatarSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 13.6 8 18 9.5 13.6 11 12 15.5 10.4 11 6 9.5 10.4 8z" />
      <path d="M18.5 15.5h-3l-1 2.5" />
      <path d="M5.5 15.5h3l1 2.5" />
    </Svg>
  );
}

/** 更多 — a dotted circle. Structure matches the live markup (1 path + 3 circles). */
export function IconMore(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="12" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/* ---------- Sidebar navigation ---------- */

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
    </Svg>
  );
}

export function IconLibrary(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="16" rx="1.5" />
      <path d="m17.5 5.5 3 13" />
    </Svg>
  );
}

export function IconStudio(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 12h16M4 18h10" />
      <circle cx="18" cy="18" r="2" />
    </Svg>
  );
}

export function IconFlows(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
      <path d="M10 6.5h4a2 2 0 0 1 2 2V14" />
    </Svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a7 7 0 0 1-7 7H8l-4 2.5V12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z" />
      <path d="M9 11h.01M12 11h.01M15 11h.01" />
    </Svg>
  );
}

export function IconAssets(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
    </Svg>
  );
}
