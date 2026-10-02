# 项目交接入口

## 目标与状态

目标是 ElevenLabs **创作工具**高保真页面/交互复刻，叠加开源 BYOK 本地运行；按最新指令**排除原站所有营销与账号相关内容**（见 [范围表](../specs/SCOPE.md)）。当前只有既有首页前端原型；本轮交付的是需求、架构、证据索引与 Agent 协作规范，**未实现全站与BYOK后端，也未完成技术评审或验收**。

建议工作名 `ElevenLabs BYOK Local`，正式名称/商标和许可证待确认。界面高度一致是开发目标，不意味着供应商模型结果、账户权益、云端交易/分成系统也能复制。明确例外见主spec。

## 文档地图

| 需要做什么 | 文档 |
|---|---|
| 给 Agent 下任务 | [根 AGENTS.md](../AGENTS.md)、[任务依赖](engineering/tasks.md)、[交接与协作](engineering/agent-handoffs.md) |
| 启动另一个 Agent | [Goal Mode 启动提示词](../GOAL_PROMPT.md) |
| 理解完整产品范围 | [范围排除表](../specs/SCOPE.md)、[主 spec](../specs/PRODUCT.md)、[路由机器清单](../specs/routes.json)、[页面分组](../specs/pages/README.md) |
| 定义按钮/状态/草稿 | [交互规范](../specs/INTERACTIONS.md)、[BYOK](../specs/BYOK.md) |
| 开始各模块 | [页面规范](../specs/pages/README.md)、[当前覆盖](research/coverage.md) |
| 写服务端/Provider | [架构](architecture/README.md)、[公共契约](architecture/contracts.md)、[Provider映射](architecture/providers.md)、[数据](architecture/data.md)、[安全](architecture/security.md) |
| 看证据与官方资料 | [研究覆盖](research/coverage.md)、[官方来源](research/official-sources.md)；本地 `research/elevenlabs-2026-10-02/INDEX.md` |
| 组织目录与开发 | [目录地图](engineering/repository-map.md)、[开发运行](engineering/development.md)、[贡献指南](../CONTRIBUTING.md) |
| 验收/回归/发布 | [验收清单](../specs/ACCEPTANCE.md)、[测试策略](engineering/testing.md)、[发布门禁](engineering/release.md)、[隐私与许可](engineering/licensing.md)、[安全响应](../SECURITY.md) |
| 解决未确认问题 | [决策登记](DECISIONS.md) |

## 立刻可执行

1. CORE 读取基线并建立真实路由和Provider契约；RESEARCH补缺失参考，不必等待所有页面再开工。
2. 保留现有首页实现和npm命令，不重建项目；安装新依赖需说明用途。
3. 先打通 TTS 的设置钥匙→选模型/音色→确认提交→等待→播放→下载→刷新历史，再并行扩展工具页。
4. Studio/Flows/聊天后续依赖基础任务和素材系统；不得用假成功作为通路。
5. 每完成一项更新任务表/验收状态并提交实际证据。文档里的“未运行/待补采”不自动转为通过。

## 原型命令（当前有效）

```sh
npm install
npm run dev
npm run typecheck
npm run build
node scripts/index-research.mjs       # 仅在私有研究目录存在时
node scripts/check-docs.mjs           # 文档/路由结构检查
```

服务器、Docker、API测试、E2E命令由实施Agent创建后再加入运行说明，目前不应假设可用。
