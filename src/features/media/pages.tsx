import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import { ImageVideoPage as ImageVideoPageBody } from "@/features/media/ImageVideoPage";
import { SfxPage as SfxPageBody } from "@/features/media/SfxPage";

/* ==========================================================================
   MEDIA module — sound effects, music, image/video/lipsync.
   The music marketplace, commercial publishing and subscription sub-routes
   are excluded by SCOPE.md and are not defined here.
   ========================================================================== */

function page(id: string) {
  const route = routeById(id);
  if (!route) throw new Error(`unknown route: ${id}`);
  return function MediaPage() {
    return <PageFrame route={route} />;
  };
}

export function SfxPage() {
  const route = routeById("sfx");
  if (!route) throw new Error("unknown route: sfx");
  return <PageFrame route={route}><SfxPageBody /></PageFrame>;
}
export const SfxHistoryPage = page("sfx-history");
export const SfxFavoritesPage = page("sfx-favorites");
export const MusicPage = page("music");
export const MusicHistoryPage = page("music-history");
export const MusicSavedPage = page("music-saved");
export const MusicFinetunesPage = page("music-finetunes");
/** Image/video/lipsync share one page; the mode comes from ?modality=. */
export function ImageVideoPage() {
  const route = routeById("image-video");
  if (!route) throw new Error("unknown route: image-video");
  return <PageFrame route={route}><ImageVideoPageBody /></PageFrame>;
}
export const MediaHistoryPage = page("media-history");
