import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import { ImageVideoPage as ImageVideoPageBody } from "@/features/media/ImageVideoPage";

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

export const SfxPage = page("sfx");
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
