# 任务 M5-T12 / M0-T02(控件清单) / M5-T13(预备) 认领交接 — ZCode

- 角色/工作目录/分支：QA 轨道（ZCode 及其子智能体）；文档类直接写主工作树新文件；代码类在 worktree `/Volumes/YANG/11-worktrees/qa`（分支 `zcode/qa`，起始 commit `7ed2f05`）
- 需求/验收ID：R1-AC02（视觉/控件基线）、R3/R4（本地 API 与错误路径）、M5-T12 分层报告、M0-T02 逐页控件清单
- 本次改变的路径：新增 `docs/engineering/COORDINATION.md`；`docs/engineering/tasks.md` 状态列（M0-T02/M5-T12/M5-T13 三行 + 所有权指针）；本文件。未触碰任何 `src/**`、`server/**`、`packages/**`、`tests/**` 文件
- 认领输出（进行中）：
  1. 基线浏览器逐页验收（HEAD 提交态，mock provider 端到端）→ `docs/qa/2026-10-03-baseline-browser.md`
  2. 逐页控件登记表 → `specs/pages/controls/**`
  3. 自动化测试补缺 → worktree 分支 `tests/qa/**`（不合并主工作树，见 COORDINATION 合并协议）
  4. 发布准备清单/许可盘点草稿（D2 未确认，不发布）
- 测试：worktree 内 `npm run typecheck` 退出码 0（symlink node_modules 方案可用）
- 是否修改Provider/模型/费用/持久化/秘密处理：否（QA 只读业务代码）
- 排除范围检查：验收以 SCOPE 为准，excluded 路径只验 404/跳转
- 未完成/阻塞：真实供应商生成验证仍阻塞于用户密钥+预算（D7）；minimax 在途未提交页面不在本轮基线内
- 残余风险：tasks.md 行级并发编辑可能与 minimax 冲突，合并时按日期取并集
