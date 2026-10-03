# 并行协作契约（多 Agent 共享同一工作目录）

> **两份契约的关系**：zcode 维护 `docs/engineering/COORDINATION.md`（跨 Agent 分工、
> worktree、任务认领），本文件负责**代码 lane 的规则与已验证现状**。两者冲突时以
> `COORDINATION.md` 为准（用户授权 zcode 维护），本文件的不同之处只有第 2 节
> 「已完成现状」与共享原语一节。视觉对照见 `docs/engineering/visual-reference-map.md`。

**为什么有这份文件**：`/Volumes/YANG/11` 同时有多个 Agent 在写代码。共享 cwd 下
「同时只允许一个 writer」这条规则如果没有落到具体文件上，就会变成互相覆盖。
本文件把所有权落到目录级，任何 Agent 开工前先读它。

## 铁律

1. **只写自己那一格。** 表外的文件一律不碰。需要改动表外文件时，在
   `docs/engineering/handoffs/` 写一份「契约变更请求」，由集成者统一改。
2. **不执行 `git commit` / `git push` / `git reset` / `git clean` / `git stash`。**
   共享工作树里这些操作会连带提交别人的半成品。只有集成者（CORE）提交。
3. **不删除别人的改动。** 看到不认识的文件或 diff，默认是别人的，保留。
4. **不重写已完成的页面。** 先读现状再动手；发现对方已经实现，先对齐再补差。
5. **不 `npm install` / 不改 `package.json` / lock。** 依赖变更由集成者统一做。

## 文件所有权分区

| 区域 | 路径 | 归属 |
|---|---|---|
| 应用壳 | `src/app/**`、`src/components/**`、`src/data/**`、`src/index.css`、`src/fonts.css` | 集成者 |
| 路由与规格 | `src/app/route-manifest.ts`、`src/app/router.tsx`、`specs/routes.json` | 集成者 |
| 共享契约 | `src/lib/api.ts`、`packages/contracts/**` | 集成者 |
| 本地配置页 | `src/features/core/**` | 集成者 |
| 依赖/构建 | `package.json`、`vite.config.ts`、`tsconfig*.json`、`vitest.config.ts` | 集成者 |
| VOICE 模块 | `src/features/voice/**` | voice-agent |
| MEDIA 模块 | `src/features/media/**` | media-agent |
| EDITORS 模块 | `src/features/editors/**` | editors-agent |
| STORAGE 模块 | `src/features/storage/**` | storage-agent |
| 服务端 Provider | `packages/providers/**` | provider-agent |
| 服务端运行时 | `server/**` | server-agent |
| 测试 | `tests/**` | qa-agent（只写自己负责的用例） |
| 文档/决策 | `docs/**` | 集成者 |

## 已完成现状（避免重复劳动）

以下已在 2026-10-03 实现并通过 `npm run typecheck` + 331 项 `npm test`：

- 应用壳重建：侧边栏（正确顺序 + 各自图标 + 真实 active 态）、顶栏（面包屑 /
  居中搜索 + ⌘K / 本地帮助）、`GlobalSearch`、首页 10 宫格工具、试听条
- **全局颜色 token 修复**：`src/index.css` 里 HSL 通道值未包 `hsl()`，导致
  `bg-background` / `bg-gray-*` / `text-foreground` 全部渲染为透明。已全部包裹。
- STT 转录库 + 「转录文件」弹层（上传/录制/YouTube/URL 四页签）+ `url_transcription`
  后端（SSRF 逐跳校验）；speakers 说话者页
- 音色库 / 我的音色 / 创建·克隆·设计弹层 + 底部试听条
- 音乐页（去市场）+ 历史/收藏/微调；sfx/media 历史与收藏页；音频检测页
- Studio（提示 + 灵感模板 + 项目列表）、Studio 编辑器、变体派生
- Flows 列表 + **可交互节点画布**（拖拽/连线/保存/真实 TTS 节点运行）
- 聊天会话页、有声书（分章 + 逐章生成 + 导出）、品牌套件
- **BYOK 多平台注册表** `packages/providers/registry.mjs`：ElevenLabs / OpenAI /
  Anthropic / Google Gemini / OpenAI 兼容自托管；域名白名单按平台隔离，
  跨厂商与未登记域名一律拒绝
- 字体合规：删除原站专有 Waldenburg，换 OFL 授权 Outfit，偏差已登记

## 仍然开放的工作

- 逐控件精细化与视觉复验（对照 `research/elevenlabs-2026-10-02/screenshots/`）
- 各工具页的 loading / 空态 / 失败 / 取消 / 恢复与持久化补齐
- Provider 适配器扩展（Anthropic / Google 的真实请求形状）
- 发布物扫描、README 命令可用性验证

## 提交规则

只有集成者提交。提交前必须：

1. 清理 exFAT 产生的 `._*` 残片
2. 扫暂存区是否含个人信息（公开仓库）
3. 扫中文损坏字符 `�`
4. 记录测试命令与退出码

已确认的用户决定（2026-10-03）：**许可证 MIT**、仓库留在 exFAT 外置盘、
**不提供测试密钥**、聊天页不做浏览器端到端验证（只保留自动化测试证据）。
在拿到密钥与预算授权前，**任何真实额度调用都不得执行**；能力一律标 `unverified`。
