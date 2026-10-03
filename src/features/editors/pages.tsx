import { PageFrame } from "@/features/shared/PageFrame";
import { routeById } from "@/app/route-manifest";
import { ChatPageBody } from "@/features/editors/ChatPage";
import { StudioPage as StudioBody, StudioEditorPage as StudioEditorBody } from "@/features/editors/StudioPage";
import { FlowsPage as FlowsBody, NewFlowButton } from "@/features/editors/FlowsPage";
import { FlowCanvas } from "@/features/editors/FlowCanvas";
import {
  AudiobooksBody,
  AudiobooksCreateButton,
  AudiobooksProvider,
} from "@/features/editors/BooksAndKits";
import { ChatSessionPage as ChatSessionBody } from "@/features/editors/ChatSessionPage";
import { StudioTemplatesPage as StudioTemplatesBody } from "@/features/media/HistoryPages";

/* ==========================================================================
   EDITORS 模块 —— 工作室、Flows、聊天、有声书、品牌套件。

   团队邀请、成员角色、创建者/所有者筛选与公开分享由 SCOPE.md 排除，这里根本
   没有定义。

   routes.json 里的四个 `path: null`（工作室编辑器、模板、Audio Native、
   Productions、广告引擎）保持不可路由：上游 URL 从未被采集，猜一个是被明确
   禁止的。工作室编辑器从刚创建的真实项目 id 进入，那是本地路由，不是编出来
   的上游地址。
   ========================================================================== */

function frame(id: string, children: React.ReactNode) {
  return function EditorsPage() {
    const route = routeById(id);
    if (!route) throw new Error(`unknown route: ${id}`);
    return <PageFrame route={route}>{children}</PageFrame>;
  };
}

/** 参考把「你想创建什么?」放在页面标题该在的位置，所以自己带 h1。 */
export const StudioPage = function StudioPageRoute() {
  const route = routeById("studio");
  if (!route) throw new Error("unknown route: studio");
  return (
    <PageFrame route={route} bare>
      <StudioBody />
    </PageFrame>
  );
};

export const FlowsPage = function FlowsPageRoute() {
  const route = routeById("flows");
  if (!route) throw new Error("unknown route: flows");
  // 052 里「+ 新建 Flow」和标题在同一行，所以走 PageFrame 的 actions 而不是
  // 在正文里再排一行。
  return (
    <PageFrame route={route} actions={<NewFlowButton />}>
      <FlowsBody />
    </PageFrame>
  );
};

export const AudiobooksPage = function AudiobooksPageRoute() {
  const route = routeById("audiobooks");
  if (!route) throw new Error("unknown route: audiobooks");
  // 头部的按钮和书架正文是并列子树，共用 provider 里的同一份状态。
  return (
    <AudiobooksProvider>
      <PageFrame route={route} actions={<AudiobooksCreateButton />}>
        <AudiobooksBody />
      </PageFrame>
    </AudiobooksProvider>
  );
};

// 品牌套件由 storage 模块挂载（见 features/storage/pages.tsx），这里不重复导出。
export const StudioTemplatesPage = frame("studio-templates", <StudioTemplatesBody />);

export function ChatPage() {
  const route = routeById("chat");
  if (!route) throw new Error("unknown route: chat");
  // 063/064 的标题也是「你想创建什么?」，所以聊天页同样自己带 h1。
  return (
    <PageFrame route={route} bare>
      <ChatPageBody />
    </PageFrame>
  );
}

export const ChatSessionPage = frame("chat-session", <ChatSessionBody />);

/** 画布占满窗口：应用外壳会把它裁掉。 */
export const FlowEditorPage = function FlowEditorPageRoute() {
  const route = routeById("flow-editor");
  if (!route) throw new Error("unknown route: flow-editor");
  return (
    <PageFrame route={route} bare>
      {/* 画布没有标题栏，标题只为读屏与页面名存在，不画出来。 */}
      <h1 className="sr-only">Flow 画布</h1>
      <FlowCanvas />
    </PageFrame>
  );
};

export const StudioEditorPage = function StudioEditorPageRoute() {
  const route = routeById("studio-editor");
  if (!route) throw new Error("unknown route: studio-editor");
  return (
    <PageFrame route={route}>
      <StudioEditorBody />
    </PageFrame>
  );
};
