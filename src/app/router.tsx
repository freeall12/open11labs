import { Component, ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/app/AppShell";
import { EXCLUDED_PATHS, LOCAL_DYNAMIC_ROUTES, ROUTABLE_ROUTES } from "@/app/route-manifest";

import { HomePage } from "@/components/HomePage";
import {
  AudioDetectorPage,
  CreateVoiceAliasPage,
  DubbingPage,
  InstantClonePage,
  IsolatorPage,
  MyVoicesPage,
  SpeakersPage,
  StsPage,
  SttPage,
  TtsPage,
  VoiceCollectionPage,
  VoiceCreatePage,
  VoiceDesignPage,
  VoiceLibraryPage,
} from "@/features/voice/pages";
import {
  ImageVideoPage,
  MediaHistoryPage,
  MusicFinetunesPage,
  MusicHistoryPage,
  MusicPage,
  MusicSavedPage,
  SfxFavoritesPage,
  SfxHistoryPage,
  SfxPage,
} from "@/features/media/pages";
import {
  AudiobooksPage,
  ChatPage,
  ChatSessionPage,
  FlowEditorPage,
  FlowsPage,
  StudioEditorPage,
  StudioPage,
  StudioTemplatesPage,
} from "@/features/editors/pages";
import {
  BrandKitsPage,
  FilesPage,
  LocalJobsPage,
  LocalProviderSettingsPage,
  LocalStorageSettingsPage,
} from "@/features/storage/pages";
import { NotFoundPage, OutOfScopePage } from "@/app/StatusPages";

/* ==========================================================================
   Page registry.

   One entry per route id, so "do these two URLs render different things?" is
   a lookup rather than an archaeology exercise. The home route keeps the
   existing high-fidelity prototype; everything else gets its module's own
   component. No URL falls back to HomePage.
   ========================================================================== */

const PAGES: Record<string, ComponentType> = {
  // shell
  home: HomePage,
  // voice
  "voices-explore": VoiceLibraryPage,
  "voice-create-query": VoiceCreatePage,
  "instant-clone": InstantClonePage,
  "voice-design": VoiceDesignPage,
  "voice-create-alias": CreateVoiceAliasPage,
  "my-voices": MyVoicesPage,
  "voice-collection": VoiceCollectionPage,
  tts: TtsPage,
  sts: StsPage,
  isolator: IsolatorPage,
  stt: SttPage,
  speakers: SpeakersPage,
  dubbing: DubbingPage,
  "audio-detector": AudioDetectorPage,
  // media
  sfx: SfxPage,
  "sfx-history": SfxHistoryPage,
  "sfx-favorites": SfxFavoritesPage,
  music: MusicPage,
  "music-history": MusicHistoryPage,
  "music-saved": MusicSavedPage,
  "music-finetunes": MusicFinetunesPage,
  "image-video": ImageVideoPage,
  "media-history": MediaHistoryPage,
  // editors
  studio: StudioPage,
  "studio-templates": StudioTemplatesPage,
  flows: FlowsPage,
  "flow-editor": FlowEditorPage,
  chat: ChatPage,
  "chat-session": ChatSessionPage,
  audiobooks: AudiobooksPage,
  // storage
  files: FilesPage,
  "brand-kits": BrandKitsPage,
  // local BYOK extensions
  "local-provider-settings": LocalProviderSettingsPage,
  "local-storage-settings": LocalStorageSettingsPage,
  "local-jobs": LocalJobsPage,
};

function pageFor(id: string): ComponentType {
  const C = PAGES[id];
  if (!C) throw new Error(`no component registered for route id: ${id}`);
  return C;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Out-of-scope upstream paths answer locally; they must never render
          the upstream account UI. Redirecting keeps the URL out of history. */}
      {EXCLUDED_PATHS.map((r) => (
        <Route
          key={r.id}
          path={r.path}
          element={
            <Navigate to="/app/out-of-scope" replace state={{ from: r.path, reason: r.reason }} />
          }
        />
      ))}

      <Route element={<AppShell />}>
        {ROUTABLE_ROUTES.map((r) => {
          const Page = pageFor(r.id);
          return (
            <Route
              key={r.id}
              path={r.path!}
              element={
                <PageBoundary id={r.id}>
                  <Page />
                </PageBoundary>
              }
            />
          );
        })}

        {/* Local-only dynamic routes; see LOCAL_DYNAMIC_ROUTES. */}
        {LOCAL_DYNAMIC_ROUTES.map((r) => (
          <Route
            key={r.id}
            path={r.pattern}
            element={
              <PageBoundary id={r.id}>
                <StudioEditorPage />
              </PageBoundary>
            }
          />
        ))}

        <Route path="/app/out-of-scope" element={<OutOfScopePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/**
 * Per-route error boundary. A single broken page must not blank the whole
 * app, and the failing route id has to be visible so the failure is
 * attributable rather than mysterious.
 */
class PageBoundary extends Component<
  { id: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[route ${this.props.id}] crashed`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-[calc(50px+9dvh)]">
        <p className="text-sm text-secondary">页面渲染失败</p>
        <h1 className="mt-1 text-balance font-waldenburg text-3xl font-normal text-foreground">
          路由 {this.props.id} 出错
        </h1>
        <p className="mt-3 max-w-prose text-sm text-secondary">
          {this.state.error.message}
        </p>
      </div>
    );
  }
}

/* Kept for the tests that assert registry coverage against routes.json. */
export const ROUTE_IDS = Object.keys(PAGES);

