import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import type { RouteEntry } from "@/app/route-manifest";

/* ==========================================================================
   VOICE module — voice library, cloning/design, TTS, STS, STT, isolation,
   dubbing. Revenue, payouts, analytics and celebrity-licensing routes are
   excluded by SCOPE.md and are not defined here at all.
   ========================================================================== */

function page(id: string) {
  const route = routeById(id);
  if (!route) throw new Error(`unknown route: ${id}`);
  return function VoicePage() {
    return <PageFrame route={route} />;
  };
}

export const VoiceLibraryPage = page("voices-explore");
export const VoiceCreatePage = page("voice-create-query");
export const InstantClonePage = page("instant-clone");
export const VoiceDesignPage = page("voice-design");
export const CreateVoiceAliasPage = page("voice-create-alias");
export const MyVoicesPage = page("my-voices");
export const VoiceCollectionPage = page("voice-collection");
export const TtsPage = page("tts");
export const StsPage = page("sts");
export const IsolatorPage = page("isolator");
export const SttPage = page("stt");
export const SpeakersPage = page("speakers");
export const DubbingPage = page("dubbing");
export const AudioDetectorPage = page("audio-detector");

/** Re-exported so the router can type its registry without importing types twice. */
export type { RouteEntry };
