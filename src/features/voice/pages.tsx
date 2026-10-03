import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import type { RouteEntry } from "@/app/route-manifest";
import { TtsPage as TtsPageBody } from "@/features/voice/TtsPage";
import { StsPage as StsPageBody } from "@/features/voice/StsPage";
import { IsolatorPage as IsolatorPageBody } from "@/features/voice/IsolatorPage";
import { DubbingPage as DubbingPageBody } from "@/features/voice/DubbingPage";
import { SttPage as SttPageBody } from "@/features/voice/SttPage";
import { SpeakersPage as SpeakersPageBody } from "@/features/voice/SpeakersPage";
import {
  MyVoicesPage as MyVoicesPageBody,
  VoiceLibraryPage as VoiceLibraryPageBody,
} from "@/features/voice/VoiceLibraryPage";

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
  return <PageFrame route={route} compact><TtsPageBody /></PageFrame>;
}

export function VoiceLibraryPage() {
  const route = routeById("voices-explore");
  if (!route) throw new Error("unknown route: voices-explore");
  return <PageFrame route={route} bare><VoiceLibraryPageBody /></PageFrame>;
}
export const VoiceCreatePage = VoiceLibraryPage;
export const InstantClonePage = VoiceLibraryPage;
export const VoiceDesignPage = VoiceLibraryPage;
export const CreateVoiceAliasPage = VoiceLibraryPage;
export function MyVoicesPage() {
  const route = routeById("my-voices");
  if (!route) throw new Error("unknown route: my-voices");
  return <PageFrame route={route} bare><MyVoicesPageBody /></PageFrame>;
}
export const VoiceCollectionPage = VoiceLibraryPage;
export function SttPage() {
  const route = routeById("stt");
  if (!route) throw new Error("unknown route: stt");
  return <PageFrame route={route} bare><SttPageBody /></PageFrame>;
}

export function SpeakersPage() {
  const route = routeById("speakers");
  if (!route) throw new Error("unknown route: speakers");
  return <PageFrame route={route} bare><SpeakersPageBody /></PageFrame>;
}

export function StsPage() {
  const route = routeById("sts");
  if (!route) throw new Error("unknown route: sts");
  return <PageFrame route={route} compact><StsPageBody /></PageFrame>;
}
export function IsolatorPage() {
  const route = routeById("isolator");
  if (!route) throw new Error("unknown route: isolator");
  return <PageFrame route={route} compact><IsolatorPageBody /></PageFrame>;
}
export function DubbingPage() {
  const route = routeById("dubbing");
  if (!route) throw new Error("unknown route: dubbing");
  return <PageFrame route={route} compact><DubbingPageBody /></PageFrame>;
}
export const AudioDetectorPage = page("audio-detector");

/** Re-exported so the router can type its registry without importing types twice. */
export type { RouteEntry };
