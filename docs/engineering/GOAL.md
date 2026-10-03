# 持久目标检查点（普通 Goal Mode 等价物）

## 本仓库没有原生 Goal Mode

运行时只暴露 `get_goal` / `update_goal`（仅 status / token_budget），**没有创建目标的
工具**。按 `GOAL_PROMPT.md` 的要求，不声称已启动不存在的模式，改用本文件作为同一目标的
持久检查点。目标文本与完成标准来自 `GOAL_PROMPT.md` 的启动指令，权威顺序遵守 `AGENTS.md`。

## 目标（逐字要点）

在已有 React + Vite + TypeScript + Tailwind 首页原型之上，完成 ElevenLabs **创作工具**的
高保真页面与交互复刻，并实现开源准备完善、用户自带密钥（BYOK）、本地运行的版本。

范围调整（已确认，见 `specs/SCOPE.md`）：**排除原网站全部营销和账号相关内容**；不是无差别
复制整站，也不是只复制首页。对保留的创作工具还原布局、设计语言、参数、弹层、状态和真实
工作流。

## 完成标准（来自 GOAL_PROMPT.md【最终完成标准】）

1. 规范内所有保留创作路由/状态和逐控件清单都有真实实现与验证；不以多个 URL 同首页伪造
   覆盖；excluded 营销/账号内容完全不出现。
2. 核心 BYOK 链路和已支持各工具可真实提交、检查、播放/预览、下载、本地保存、刷新与重启
   恢复；Provider/权限缺口逐项明示。
3. 任务去重/未知提交/取消/失败/恢复/成本、素材工程版本、钥匙安全与本地 API 保护有测试证据。
4. typecheck/build 与已建立测试真实通过；视觉、生成效果、用户体验分别报告；未运行和阻塞
   不算通过。
5. README 中安装/启动/配置/故障/备份命令真实可用；server/Docker/OS 支持只有实际验证后才
   声称支持。
6. 研究原始资料保持私有，代码/公开 fixtures 无秘密/账号信息/无授权素材。
7. 交付最终报告：完成模块、测试与产物索引、具体偏差、未完成/阻塞和待确认决策。

只有全部适用完成标准有证据，才把目标标记完成。

## 红线（不可协商）

- 密钥只经本地服务端代理；禁止 `VITE_*` 密钥、前端 bundle、URL、localStorage/IndexedDB、
  日志、Git、截图、fixture 中的真实钥匙。
- 默认 loopback、同源；必须实现 Host/Origin/CSRF/会话保护。无账号注册 ≠ API 无授权。
- 不用研究浏览器登录 token、不调私有 app 端点、不绕过审批/许可/身份验证。
- 无可靠价格/状态时显示未知，**不填费用 0**；超时不等于未提交；不自动重试付费提交。
- 空 handler、`coming-soon`、`alert`、固定假输出、假任务成功、静态余额都不算完成。
- 未拿到用户测试密钥、预算与授权前，不耗费真实额度。
- 广告创作工具生成用户作品 ≠ 网站自身营销块；困难创作功能不得归类为营销以逃避实现。

## 进度台账

每个阶段在 `docs/engineering/handoffs/` 下留检查点：变更路径、证据、测试命令/退出码、
真实/mock/文档验证分类、剩余缺口。

| 阶段 | 状态 | 证据 |
|---|---|---|
| M0-T01 研究 | 部分（139 截图/33 URL 覆盖；`studio-editor` 等 5 条 `path:null` 待补采） | `docs/research/coverage.md` |
| M0-T02 路由/范围裁剪 | 完成（51 项路由测试；excluded 路径本地 404/跳转） | `tests/contract/routing.test.tsx` |
| M0-T03 密钥/会话/安全 | 完成（26 项安全负例） | `tests/integration/security.test.mjs` |
| M1-T04 Provider 适配 | 部分（适配器/契约/fixture 落地；能力全标 unverified） | `tests/contract/providers.test.mjs` |
| M1-T05 任务/成本 | 完成（42 项，含跨重启恢复） | `tests/contract/jobs.test.mjs` |
| M1-T06 存储/工程 | 完成（23 项 + 变体派生 7 项） | `tests/contract/storage.test.mjs`、`variants.test.mjs` |
| M1-T07 首条 BYOK 链（TTS） | 代码完成；真实提交需用户密钥+预算 | `tests/contract/*`、handoffs |
| M2-T08 音频工具 | **完成（代码层）**：TTS/STS/分离/配音/STT/说话者/音色库/创建克隆设计/试听条；真实调用待密钥 | handoffs/2026-10-03-parallel-integration.md |
| M2-T09 媒体工具 | **完成（代码层）**：音效/音乐/图像视频口型/全部历史收藏/音频检测 | 同上 |
| M3-T10 Studio/Flows/聊天 | 进行中（聊天已实现；Studio/Flows 待做） | `src/features/editors` |
| M4-T11 有声书/其余 | **完成（代码层）**：有声书分章生成导出 + 品牌套件 | 同上 |
| M5-T12 QA | 持续（331 项通过） | `npm test` |
| M5-T13 发布/许可 | 未开始（D2 许可证待用户确认） | `docs/DECISIONS.md` |

## 外部阻塞（不伪造、不越权）

- **真实 Provider 验证**：需要用户提供测试密钥与预算。在此之前所有能力标 `unverified`，
  不声称端到端真实生成已通过。
- **D2 开源许可证**：需用户确认。未经确认不发布、不 push。
- **研究补采**：`studio-editor`、`templates-tool`、`audio-native`、`productions`、
  `ads-engine` 五条 `path:null`，按 `routes.json` 规则**不猜 URL**。
