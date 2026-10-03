import type { ComponentType, SVGProps } from "react";

import {
  IconCaption,
  IconImage,
  IconMusic,
  IconSoundFx,
  IconStudio,
  IconVideo,
  IconWaveform,
  IconChat,
} from "@/lib/icons";

export type RecentIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/* ==========================================================================
   Home "最近" row presentation.

   The rows themselves are NOT defined here. They come from the local job
   ledger at render time (`jobs.list()` in @/lib/api), because a hardcoded
   array here would be invented projects with invented timestamps — exactly the
   thing the fidelity rules forbid. This file only holds presentation:

     - how a job `type` reads in Chinese
     - which glyph stands for it
     - how a real `createdAt` becomes a relative label

   A type with no entry below falls back to its raw value and the generic
   caption glyph, so a job kind added on the server later still renders
   honestly instead of being mislabelled as something else.
   ========================================================================== */

const JOB_TYPE_LABELS: Record<string, string> = {
  tts: "文本转语音",
  stt: "语音转文本",
  sts: "变声器",
  isolation: "人声分离",
  sfx: "音效",
  image: "图像",
  video: "视频",
  chat: "对话",
  music: "音乐",
  dubbing: "配音",
  audiobook: "有声书",
  lipsync: "口型",
};

const JOB_TYPE_ICONS: Record<string, RecentIcon> = {
  tts: IconWaveform,
  stt: IconCaption,
  sfx: IconSoundFx,
  image: IconImage,
  video: IconVideo,
  music: IconMusic,
  chat: IconChat,
};

export function labelForJobType(type: string): string {
  return JOB_TYPE_LABELS[type] ?? type;
}

export function iconForJobType(type: string): RecentIcon {
  return JOB_TYPE_ICONS[type] ?? IconStudio;
}

/**
 * Relative label computed from the record's own timestamp.
 *
 * Deliberately never returns "0" or an empty string for a missing or
 * unparseable date — an unparseable timestamp reads "时间未知" rather than
 * silently becoming "刚刚", which would be a fabricated fact.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "时间未知";

  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months} 个月前`;

  return `${Math.round(months / 12)} 年前`;
}
