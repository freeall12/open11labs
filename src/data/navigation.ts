import type { ComponentType, SVGProps } from "react";
import {
  IconAssets,
  IconChat,
  IconFlows,
  IconHome,
  IconLibrary,
  IconStudio,
} from "@/lib/icons";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "主页", href: "/app/home", icon: IconHome },
  { label: "音色", href: "/app/voice-library", icon: IconLibrary },
  { label: "工作室", href: "/app/studio", icon: IconStudio },
  { label: "Flows", href: "/app/flows", icon: IconFlows },
  { label: "聊天", href: "/app/creative-agent", icon: IconChat },
  { label: "素材", href: "/app/files", icon: IconAssets },
];

export const PINNED_NAV: NavItem[] = [
  {
    label: "文本转语音",
    href: "/app/speech-synthesis/text-to-speech",
    icon: IconStudio,
  },
  { label: "创建音色", href: "/app/create-voice", icon: IconStudio },
  { label: "音效", href: "/app/sound-effects", icon: IconStudio },
  { label: "图像和视频", href: "/app/image-video", icon: IconStudio },
  { label: "人声分离", href: "/app/voice-isolator", icon: IconStudio },
  {
    label: "变声器",
    href: "/app/speech-synthesis/speech-to-speech",
    icon: IconStudio,
  },
  { label: "音乐", href: "/app/music", icon: IconStudio },
  { label: "语音转文本", href: "/app/speech-to-text", icon: IconStudio },
  { label: "配音", href: "/app/dubbing", icon: IconStudio },
  { label: "有声书", href: "/app/audiobooks", icon: IconStudio },
];
