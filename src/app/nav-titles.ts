import { ALL_ROUTES, LOCAL_ROUTES } from "@/app/route-manifest";

/* ==========================================================================
   Top-bar titles.

   Derived from the route manifest so the label follows the same source of
   truth as routing. Dynamic segments are matched by prefix, because
   `/app/flows/:id` and `/app/creative-agent/chats/:id` do not have a literal
   path to look up.
   ========================================================================== */

const TITLES: Record<string, string> = {
  home: "主页",
  "voices-explore": "音色",
  "voice-create-query": "创建音色",
  "instant-clone": "即时克隆",
  "voice-design": "声音设计",
  "voice-create-alias": "创建音色",
  "my-voices": "我的音色",
  "voice-collection": "音色合集",
  tts: "文本转语音",
  sts: "变声器",
  isolator: "人声分离",
  stt: "语音转文本",
  speakers: "说话者",
  dubbing: "配音",
  sfx: "音效",
  "sfx-history": "音效历史",
  "sfx-favorites": "音效收藏",
  music: "音乐",
  "music-history": "音乐历史",
  "music-saved": "音乐收藏",
  "music-finetunes": "音乐微调",
  "image-video": "图像和视频",
  // 130/131 show the parent 图像和视频 as the heading with 历史 as the active
  // tab, so the breadcrumb follows the parent too.
  "media-history": "图像和视频",
  studio: "工作室",
  "studio-templates": "工作室模板",
  flows: "Flows",
  "flow-editor": "Flows",
  chat: "聊天",
  "chat-session": "聊天",
  files: "素材",
  // 073 shows 素材 as the heading with 素材/品牌套件 as a tablist, so the
  // page title follows the parent and the tab carries the sub-page name.
  "brand-kits": "素材",
  audiobooks: "有声书",
  "audio-detector": "音频检测",
  "studio-editor": "工作室",
};

/** Concrete prefixes for routes that carry a path parameter. */
const DYNAMIC_PREFIXES: [string, string][] = [
  ["/app/flows/", "flow-editor"],
  ["/app/creative-agent/chats/", "chat-session"],
  ["/app/voice-library/collections/", "voice-collection"],
  // The local editor. This path is not in routes.json (the upstream editor URL
  // was never captured), so it needs a title of its own here.
  ["/app/studio/", "studio-editor"],
];

export function titleForPath(pathname: string): string {
  for (const local of LOCAL_ROUTES) {
    if (pathname === local.path) return local.title;
  }

  const [stripped, query] = splitOnce(pathname, "?");

  for (const [prefix, id] of DYNAMIC_PREFIXES) {
    if (stripped.startsWith(prefix)) return TITLES[id] ?? id;
  }

  // Modal/mode query routes share their page's title; the owning page decides.
  const match = ALL_ROUTES.find((r) => r.path === stripped);
  if (match) return TITLES[match.id] ?? match.id;

  // `?action=create&creationType=cloneVoice` and friends.
  if (query) {
    if (query.includes("cloneVoice")) return TITLES["instant-clone"];
    if (query.includes("voiceDesign")) return TITLES["voice-design"];
    if (query.includes("action=create")) return TITLES["voice-create-query"];
    if (query.includes("modality=video")) return "图像和视频";
  }

  if (stripped === "/app/out-of-scope") return "已移除";
  return "ElevenLabs";
}

function splitOnce(value: string, sep: string): [string, string] {
  const i = value.indexOf(sep);
  return i < 0 ? [value, ""] : [value.slice(0, i), value.slice(i + 1)];
}
