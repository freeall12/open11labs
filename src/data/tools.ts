export type ToolId =
  | "speech"
  | "music"
  | "voice-clone"
  | "image"
  | "video"
  | "dubbing"
  | "avatar"
  | "more";

export interface HomeTool {
  id: ToolId;
  label: string;
  /** null means the card opens a menu instead of navigating. */
  href: string | null;
}

export const HOME_TOOLS: HomeTool[] = [
  { id: "speech", label: "语音", href: "/app/speech-synthesis/text-to-speech" },
  { id: "music", label: "音乐", href: "/app/music" },
  {
    id: "voice-clone",
    label: "语音克隆",
    href: "/app/voice-library?action=create&creationType=cloneVoice",
  },
  { id: "image", label: "图像", href: "/app/image-video?modality=image" },
  { id: "video", label: "视频", href: "/app/image-video?modality=video" },
  { id: "dubbing", label: "配音", href: "/app/dubbing" },
  { id: "avatar", label: "虚拟形象", href: "/app/avatar" },
  { id: "more", label: "更多", href: null },
];
