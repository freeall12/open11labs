# 待实现登记（骨架）：Studio / Flows / 聊天 / 有声书 / 模板系

> **无代码证据，来源仅为规范草案。** 本文件所列路由在 qa worktree HEAD `7ed2f05` 均为 ScopeNotice 占位页（`src/features/editors/pages.tsx` 全部经 `page(id)` 生成）或无路由（path=null），下方控件全部**未实现**；状态一律「未实现/待补采」。规范依据：`specs/pages/editors.md`。

## 路由覆盖与证据状态

| 路由 ID | 路径 | routes.json coverage | 证据 | 页面现状 |
|---|---|---|---|---|
| studio | /app/studio | observed | 047-studio-loaded | 占位 |
| studio-templates | /app/studio/templates | entry-only | 047 | 占位（模板区未采，待补采） |
| flow-editor | /app/flows/:id | observed | 058-flows-canvas | 占位 |
| flows | /app/flows | observed | 054-flows-home | 占位 |
| chat / chat-session | /app/creative-agent[/chats/:id] | observed / entry-only | 064-chat-loaded | 占位 |
| audiobooks | /app/audiobooks | **partial-loading** | 133-audiobooks-page | 占位（向导截图超时，待补采） |
| templates-tool / audio-native / productions / ads-engine | **path=null** | entry-only | 003-more-tools | 无路由，禁止猜 URL |

注意：主工作树中另一 agent 的在途未提交改动（Studio/Flows/Chat/音乐等新页面）**不采信**；待其提交并经核对后本文件方可更新。

## Studio（规范 046–050e）

未实现控件（规范要求）：提示/引用；功能模板；全部/音频/视频标签；本地搜索；列表/网格切换；创建空白项目；导入；项目菜单（复制/重命名/导出/删除）。附加要求：新建须标草稿不触发生成；视频/音频编辑器路径**待补采，不得猜 URL**；时间线行为未实测不得宣称 1:1。

## Flows（规范 051–061）

未实现控件（规范要求）：列表新建/搜索/排序；本地复制/重命名/导出/删除（账户筛选/云分享移除，不做）；画布选择/移动/缩放；节点连线/分支；添加节点搜索/分类；节点模型与参数/素材配置；运行/停止/结果/下载；文件菜单/版本历史。DAG 约束：环/悬空输入/类型不匹配提交前检查；付费节点逐项预算；重试已成功节点需显式意图。已观察节点类型清单见 editors.md。

## 聊天（规范 062–065）

未实现控件（规范要求）：提示/引用；历史会话；本地建议模板；发送/取消/重试；检查产物/采用到工程。约束：LLM 钥匙独立配置；typed 工具可见供应商/参数/任务/成本；上下文引用版本可追溯；任务未完成不得以助手「已完成」替代状态；付费执行前确认。

## 有声书（规范 132–134）

未实现控件（规范要求）：本地书架/搜索/视图；创建（EPUB/PDF 导入）；格式化/音色/发音；章节/角色；预览/生成/下载。**证据缺口**：向导截图两次超时（133 partial-loading），需补采后才能细化控件。打款/收益/发布移除不做。

## 模板 / Audio Native / 作品 / 广告引擎

path=null，仅 003-more-tools 观察到入口。**禁止猜测 URL**；RESEARCH 补采后才可建路由与控件表。保留实际创作与本地导出，移除销售/市场/购买/账号发布部分。
