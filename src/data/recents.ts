import type { ComponentType, SVGProps } from "react";

import {
  IconSoundFx,
  IconFlows,
  IconCaption,
  IconWaveform,
} from "@/lib/icons";

export type RecentIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface RecentItem {
  id: string;
  title: string;
  /** Product area shown in the second column. */
  category: string;
  /** Row thumbnail, taken from the real app icon set. */
  icon: RecentIcon;
  /** Pre-formatted relative time, matching the site's own formatter output. */
  time: string;
  href: string;
}

/* Placeholder rows. Wire this to your own project store later — the shape is
   what the panel renders, so any source can fill it. */
export const RECENT_ITEMS: RecentItem[] = [
  {
    id: "r1",
    title: "雨夜街角的环境音",
    category: "Sound Effects",
    icon: IconSoundFx,
    time: "上周",
    href: "/app/sound-effects/history",
  },
  {
    id: "r2",
    title: "新品发布短片",
    category: "Flows",
    icon: IconFlows,
    time: "上周",
    href: "/app/flows",
  },
  {
    id: "r3",
    title: "未命名 Flow",
    category: "Flows",
    icon: IconFlows,
    time: "上周",
    href: "/app/flows",
  },
  {
    id: "r4",
    title: "木工刨削比赛，比谁刨的木片最薄。",
    category: "Dubbing",
    icon: IconCaption,
    time: "上个月",
    href: "/app/dubbing",
  },
  {
    id: "r5",
    title: "角色设定图",
    category: "Flows",
    icon: IconFlows,
    time: "上个月",
    href: "/app/flows",
  },
  {
    id: "r6",
    title: "晨间新闻播报",
    category: "Text to Speech",
    icon: IconWaveform,
    time: "上个月",
    href: "/app/speech-synthesis/text-to-speech",
  },
];
