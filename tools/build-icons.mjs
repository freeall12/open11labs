#!/usr/bin/env node
/**
 * Generate src/lib/icons.tsx from icons pulled out of the source site's JS
 * bundles, so the replica ships the real artwork rather than approximations.
 *
 * Re-run after bumping a bundle:
 *   node tools/build-icons.mjs
 */

import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** icon export name -> source component name in the bundle. */
const ICONS = {
  // Prompt bar
  IconPlus: "PlusIcon",
  IconMic: "MicIcon",
  IconArrowUp: "ArrowUpIcon",
  // Top bar
  IconBell: "BellIcon",
  IconPanel: "SidebarSimpleLeftSquareIcon",
  // Home tool grid
  IconWaveform: "AudioLinesIcon",
  IconMusic: "MusicIcon",
  IconVoiceClones: "NavVoicesIcon",
  IconImage: "ImageIcon",
  IconVideo: "VideoIcon",
  IconCaption: "ClosedCaptioningIcon",
  IconAvatarSparkle: "ImageAvatarSparkleIcon",
  IconMore: "CircleEllipsisHorizontalIcon",
  // Sidebar
  IconHome: "HomeIcon",
  IconLibrary: "LibraryIcon",
  IconStudio: "StudioDisplayIcon",
  IconFlows: "FolderFlowIcon",
  IconChat: "ChatBubbleSevenIcon",
  IconAssets: "FilesIcon",
  // Recents toolbar
  IconSearch: "SearchIcon",
  IconList: "BulletListIcon",
  IconGrid: "GridBoxIcon",
  // Recents row thumbnails
  IconSoundFx: "SoundFxIcon",
  // Local BYOK configuration entries
  IconKey: "KeyIcon",
  IconDatabase: "ServerIcon",
  IconQueue: "ChecklistIcon",
};

const BUNDLES = [join(root, "tools/icons-bundle.js"), join(root, "tools/nav-bundle.js")];

/** Pull one icon's SVG markup out of whichever bundle declares it. */
function pull(name) {
  for (const bundle of BUNDLES) {
    const tmp = join(here, ".pull.json");
    try {
      execFileSync(
        process.execPath,
        [join(here, "extract-icons.mjs"), bundle, name],
        { env: { ...process.env, OUT: tmp }, stdio: "ignore" },
      );
      const out = JSON.parse(readFileSync(tmp, "utf8"));
      if (out[name]) return out[name];
    } catch {
      /* try the next bundle */
    }
  }
  return null;
}

/** HTML-ish attribute names -> React-friendly JSX attributes. */
function toJsx(markup) {
  return markup.replace(/<([a-z]+)\s+([^/]*?)\/>/g, (_m, tag, attrs) => {
    const pairs = [...attrs.matchAll(/([a-z-]+)="([^"]*)"/g)].map(
      ([, k, v]) => `${k}="${v.replace(/"/g, "&quot;")}"`,
    );
    return `<${tag} ${pairs.join(" ")} />`;
  });
}

const missing = [];
const parts = [];

for (const [exportName, sourceName] of Object.entries(ICONS)) {
  const markup = pull(sourceName);
  if (!markup) {
    missing.push(sourceName);
    continue;
  }
  parts.push(
    `export function ${exportName}(props: IconProps) {
  return (
    <Svg {...props}>
      ${toJsx(markup)}
    </Svg>
  );
}`,
  );
}

if (missing.length) {
  console.error(`missing from bundles: ${missing.join(", ")}`);
  process.exit(1);
}

const header = `import type { SVGProps } from "react";

/* ==========================================================================
   Icons — GENERATED FILE, do not edit by hand.
   Regenerate with:  node tools/build-icons.mjs

   Every glyph below is the real artwork, extracted from the source site's
   JavaScript bundles by tools/extract-icons.mjs. Each icon keeps the wrapper
   attributes it ships with upstream: an 18x18 viewBox, fill="none", and
   currentColor strokes, so sizing and colour work the same as the original.

   Source bundles:
     tools/icons-bundle.js  (1816 icons, strokeWidth 1.5 wrapper)
     tools/nav-bundle.js     (219 app/nav icons, per-path strokeWidth)
   ========================================================================== */

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

`;

writeFileSync(
  join(root, "src/lib/icons.tsx"),
  header + parts.join("\n\n") + "\n",
);

console.error(`wrote src/lib/icons.tsx (${parts.length} icons)`);
