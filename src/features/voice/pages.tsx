import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import type { RouteEntry } from "@/app/route-manifest";
import { TtsPage as TtsPageBody } from "@/features/voice/TtsPage";
import { StsPage as StsPageBody } from "@/features/voice/StsPage";

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

/** TTS is the first BYOK page and has a real implementation. */
export function TtsPage() {
  const route = routeById("tts");
  if (!route) throw new Error("unknown route: tts");
  return <PageFrame route={route}><TtsPageBody /></PageFrame>;
}

export const VoiceLibraryPage = page("voices-explore");
export const VoiceCreatePage = page("voice-create-query");
export const InstantClonePage = page("instant-clone");
export const VoiceDesignPage = page("voice-design");
export const CreateVoiceAliasPage = page("voice-create-alias");
export const MyVoicesPage = page("my-voices");
export const VoiceCollectionPage = page("voice-collection");
export function StsPage() {
  const route = routeById("sts");
  if (!route) throw new Error("unknown route: sts");
  return <PageFrame route={route}><StsPageBody /></PageFrame>;
}
export const IsolatorPage = page("isolator");
export const SttPage = page("stt");
export const SpeakersPage = page("speakers");
export const DubbingPage = page("dubbing");
export const AudioDetectorPage = page("audio-detector");

/** Re-exported so the router can type its registry without importing types twice. */
export type { RouteEntry };
