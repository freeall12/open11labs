import type { ComponentType, SVGProps } from "react";
import {
  IconAssets,
  IconAvatarSparkle,
  IconCaption,
  IconChat,
  IconDatabase,
  IconFlows,
  IconHome,
  IconImage,
  IconKey,
  IconLibrary,
  IconMic,
  IconMusic,
  IconQueue,
  IconSoundFx,
  IconStudio,
  IconWaveform,
} from "@/lib/icons";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** Trailing control on the row, e.g. the "new voice" action beside 音色. */
  action?: { label: string; href: string };
}

/**
 * Order and icons follow the reference sidebar. Each tool gets its own glyph
 * rather than a shared placeholder — a rail where ten rows share one icon
 * reads as unfinished even when the geometry is right.
 */
export const PRIMARY_NAV: NavItem[] = [
  {
    label: "主页",
    href: "/app/home",
    icon: IconHome,
    action: undefined,
  },
  {
    label: "音色",
    href: "/app/voice-library",
    icon: IconLibrary,
    // The "+" beside 音色 creates a voice; it is a real destination, not a stub.
    action: { label: "创建音色", href: "/app/voice-library?action=create" },
  },
  { label: "工作室", href: "/app/studio", icon: IconStudio },
  { label: "Flows", href: "/app/flows", icon: IconFlows },
  { label: "聊天", href: "/app/creative-agent", icon: IconChat },
  { label: "素材", href: "/app/files", icon: IconAssets },
];

export const PINNED_NAV: NavItem[] = [
  { label: "文本转语音", href: "/app/speech-synthesis/text-to-speech", icon: IconWaveform },
  { label: "创建音色", href: "/app/create-voice", icon: IconMic },
  { label: "音效", href: "/app/sound-effects", icon: IconSoundFx },
  { label: "图像和视频", href: "/app/image-video", icon: IconImage },
  { label: "人声分离", href: "/app/voice-isolator", icon: IconAvatarSparkle },
  { label: "变声器", href: "/app/speech-synthesis/speech-to-speech", icon: IconMic },
  { label: "音乐", href: "/app/music", icon: IconMusic },
  { label: "语音转文本", href: "/app/speech-to-text", icon: IconCaption },
  { label: "配音", href: "/app/dubbing", icon: IconChat },
  { label: "有声书", href: "/app/audiobooks", icon: IconStudio },
];

/**
 * Chinese labels for the reference 更多工具 sub-list, keyed by route id.
 *
 * `interaction-findings.md` states it directly: "更多工具列出模板、Audio
 * Native、作品、广告引擎及置顶按钮". Those four map one-to-one onto the
 * `pending-discovery` routes in routes.json (templates-tool, audio-native,
 * productions, ads-engine), so the sidebar renders the pending routes through
 * this map rather than a second hard-coded list — the two cannot drift.
 *
 * Every one of them has `path: null` because the upstream URL was never
 * captured, and guessing one is forbidden. They are listed, not linked, and the
 * sidebar marks each as awaiting evidence instead of rendering a control that
 * goes nowhere. A pending route with no entry here still appears, under its own
 * id, so a newly added one is never silently dropped.
 */
export const PENDING_TOOL_LABELS: Record<string, string> = {
  "templates-tool": "模板",
  "audio-native": "Audio Native",
  productions: "作品",
  "ads-engine": "广告引擎",
};

/**
 * Local BYOK configuration. SCOPE.md keeps local provider/key, storage and
 * job settings because the local build cannot run without them — but it drops
 * the upstream account, workspace, subscription and developer-portal surfaces.
 * These entries are additions, not replicas, so they sit below the tool list
 * instead of displacing an upstream row.
 */
export const LOCAL_NAV: NavItem[] = [
  { label: "Provider 与密钥", href: "/local/settings/providers", icon: IconKey },
  { label: "存储设置", href: "/local/settings/storage", icon: IconDatabase },
  { label: "任务队列", href: "/local/jobs", icon: IconQueue },
];
