# 测试目录

QA 负责布局与策略：[测试策略](../docs/engineering/testing.md)、[验收](../specs/ACCEPTANCE.md)。仅自有/合法/合成 fixture；不复制 raw 研究、账号信息或密钥；mock 一律标明模拟；真实 API 测试需预算授权（当前无密钥，一切真实生成能力标 `unverified`）。

## 现状（2026-10-03 更新，取代「待实施」旧文案）

`npm test`（vitest，全局 jsdom + `tests/setup.ts` 提供 matchMedia/scrollIntoView/fetch 相对路径处理）：

| 目录 | 内容 | 说明 |
|---|---|---|
| `tests/contract/` | 路由 51 / 任务 42 / 存储 23+7 / Provider 契约 / ytdlp / chat / artifact / provider-models / 本地 Provider | 页面路由与核心服务契约 |
| `tests/integration/` | 安全负例 26 / client / security / validation | 真实 loopback server 起停验证 |
| `tests/qa/` | API 广度 24 / 本地 Provider 分支 22 / TTS 页 15 / 语音工具页 19 / 媒体页 13 / **缺陷回归标记 2** | QA 基线轮补缺（2026-10-03，分支 `zcode/qa`）；标记测试带 ⚠️ FLIP WHEN FIXED 注释，对应缺陷修复后必须翻转极性 |

- 本 worktree HEAD 基线：306 用例 → 含 `tests/qa/` 后 **401 全过、exit 0**
- jsdom 相对 URL fetch 处理在 `tests/setup.ts`（组件测试不产生未处理拒绝；绝对 URL 透传给集成测试的真实 server）
- 已知环境项：exFAT 盘满负载下 ytdlp probe 曾超时（已加 20s 显式超时根治）
- 未自动化部分：真实供应商生成（阻塞：用户决定不提供测试密钥，D7）；像素级视觉 diff（另由 scripts/visual-audit.mjs 输出截图证据）
