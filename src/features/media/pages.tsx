import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import { ImageVideoPage as ImageVideoPageBody } from "@/features/media/ImageVideoPage";
import { SfxPage as SfxPageBody, type SfxTab } from "@/features/media/SfxPage";
import {
  MusicFinetunesPage as MusicFinetunesBody,
  MusicHistoryPage as MusicHistoryBody,
  MusicPage as MusicPageBody,
  MusicSavedPage as MusicSavedBody,
} from "@/features/media/MusicPage";
import { AudioDetectorPage as AudioDetectorBody } from "@/features/media/HistoryPages";

/* ==========================================================================
   MEDIA module — sound effects, music, image/video/lipsync.

   The music marketplace, per-track commercial licensing and the public
   publishing route are excluded by SCOPE.md and are not defined here. The
   music entry point opens the composer instead.

   The three sound-effects routes share one page, because upstream keeps a
   single composer docked across 探索 / 历史 / 收藏. Only the frame's title
   and the tab strip differ between them.

   图像和视频 does the same for its two routes: 探索 and 历史 are one page
   upstream (131 is 历史 *with* the composer), so both render the same body
   with a different tab.
   ========================================================================== */

const TOOL_ROUTES = new Set(["sfx", "music"]);

function frame(id: string) {
  return function MediaPage() {
    const route = routeById(id);
    if (!route) throw new Error(`unknown route: ${id}`);
    // Sound effects, dubbing-adjacent tools and the media composers are tool
    // pages: the reference names them in the top bar rather than printing a
    // large page heading.
    return <PageFrame route={route} compact={TOOL_ROUTES.has(id)}>{body(id)}</PageFrame>;
  };
}

function body(id: string) {
  switch (id) {
    case "music":
      return <MusicPageBody />;
    case "music-saved":
      return <MusicSavedBody />;
    case "music-history":
      return <MusicHistoryBody />;
    case "music-finetunes":
      return <MusicFinetunesBody />;
    case "audio-detector":
      return <AudioDetectorBody />;
    default:
      throw new Error(`no media body for route: ${id}`);
  }
}

export const MusicPage = frame("music");
export const MusicSavedPage = frame("music-saved");
export const MusicHistoryPage = frame("music-history");
export const MusicFinetunesPage = frame("music-finetunes");
export const AudioDetectorPage = frame("audio-detector");

const SFX_TABS: Record<string, SfxTab> = {
  sfx: "explore",
  "sfx-history": "history",
  "sfx-favorites": "favorites",
};

function sfxPage(id: string) {
  return function SfxTabPage() {
    const route = routeById(id);
    if (!route) throw new Error(`unknown route: ${id}`);
    const tab = SFX_TABS[id];
    return (
      <PageFrame route={route}>
        <SfxPageBody tab={tab} />
      </PageFrame>
    );
  };
}

export const SfxPage = sfxPage("sfx");
export const SfxHistoryPage = sfxPage("sfx-history");
export const SfxFavoritesPage = sfxPage("sfx-favorites");

/**
 * 图像和视频: one body, two tabs.
 *
 * The history route is deliberately framed with the *parent* route entry, not
 * its own. Reference 131 shows 历史 under the 图像和视频 heading with 历史 as
 * the active tab, so there is no separate 生成历史 page — the same pattern
 * PageFrame already applies to 073's 素材/品牌套件 pair. Using the parent's
 * entry also keeps exactly one <h1> per URL, which the routing test asserts.
 */
function imageVideoPage(id: "image-video" | "media-history", tab: "explore" | "history") {
  return function ImageVideoTabPage() {
    const route = routeById(id === "media-history" ? "image-video" : id);
    if (!route) throw new Error(`unknown route: ${id}`);
    return (
      <PageFrame route={route} compact showCompactHeading>
        <ImageVideoPageBody tab={tab} />
      </PageFrame>
    );
  };
}

export const ImageVideoPage = imageVideoPage("image-video", "explore");
export const MediaHistoryPage = imageVideoPage("media-history", "history");
