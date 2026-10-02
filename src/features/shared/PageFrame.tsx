import type { ReactNode } from "react";
import type { RouteEntry } from "@/app/route-manifest";

/* ==========================================================================
   Shared page frame.

   Every routed page renders through this so the shell chrome stays
   identical, while the page body below it is per-module. It deliberately
   shows no generation controls: tool UIs arrive with the module that owns
   them (M1-T07 / M2-T08 / M2-T09 / M3-T10), not as placeholders here.
   ========================================================================== */

export function PageFrame({
  route,
  children,
  actions,
}: {
  route: RouteEntry;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-[calc(50px+9dvh)]">
      <header className="stack gap-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-balance font-waldenburg text-3xl font-normal text-foreground">
            {titleFor(route)}
          </h1>
          {actions}
        </div>
        {route.adaptation && (
          <p className="text-sm text-secondary">本地化调整：{route.adaptation}</p>
        )}
      </header>

      <div className="mt-8">{children ?? <ScopeNotice route={route} />}</div>
    </div>
  );
}

/** Chinese label for a route, falling back to the id when none is declared. */
function titleFor(route: RouteEntry): string {
  return ROUTE_TITLES[route.id] ?? route.id;
}

const ROUTE_TITLES: Record<string, string> = {
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
  "media-history": "生成历史",
  studio: "工作室",
  "studio-templates": "工作室模板",
  flows: "Flows",
  "chat": "聊天",
  files: "素材",
  "brand-kits": "品牌套件",
  audiobooks: "有声书",
  "audio-detector": "音频检测",
  // Local BYOK extensions — these are additions, not replicas.
  "local-provider-settings": "Provider 与密钥",
  "local-storage-settings": "存储设置",
  "local-jobs": "任务队列",
};

/**
 * Honest state for a route whose module has not been built yet. It names the
 * owning task and the blockers instead of rendering a convincing-looking UI
 * that does nothing.
 */
function ScopeNotice({ route }: { route: RouteEntry }) {
  const blocked = route.coverage !== "observed" && route.coverage !== "entry-only";
  return (
    <section className="stack gap-4">
      <div className="rounded-xl border border-gray-alpha-150 bg-gray-alpha-50 p-5">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Field label="路由 ID" value={route.id} mono />
          <Field label="路径" value={route.path ?? "（待补采，不猜 URL）"} mono />
          <Field label="负责角色" value={route.owner} />
          <Field label="阶段" value={route.phase} />
          <Field label="研究覆盖" value={route.coverage} />
          <Field label="证据" value={route.evidence.join(", ") || "无"} mono />
        </dl>
      </div>

      {blocked && (
        <p className="text-sm text-secondary">
          该路由的研究证据不完整（{route.coverage}），进入视觉精确验收前需要补采。
        </p>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-secondary">{label}</dt>
      <dd className={`truncate text-foreground ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
