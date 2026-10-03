# ZCode × minimaxcode 并行协作协议

建立：2026-10-03，由操作者（用户）指令授权：两 agent 在本仓库同步推进，ZCode 侧并行多个子智能体。
本文件是两个 agent 之间的操作约定，效力低于 AGENTS.md 与用户最新指令。**每次领取新任务前先读本文件 + `git status`。**

> **⚠️ 2026-10-03 14:52 角色切换（用户最新指令）**：用户指定 **ZCode 接替逐页复刻任务，成为主工作树 FEATURE 写手 + 集成者**。minimaxcode 自 05:46 冻结（其 55 文件/6616 行在途批次经自验 331 用例绿，由 ZCode 做保护性集成提交，提交内容保持原样不改写）。若 minimaxcode 复活：以本表与 git log 为准协调，单写手归属由用户裁决。QA worktree `/Volumes/YANG/11-worktrees/qa` 保留作验证环境。

## 分工总表

| 轨道 | 负责 agent | 工作位置 | 内容 |
|---|---|---|---|
| FEATURE（页面/壳/provider/server） | minimaxcode | 主工作树 `/Volumes/YANG/11` | M2-T08/T09 剩余、M3-T10、M4-T11 全部页面与交互、shell/字体、provider 与 server 扩展（即当前在途未提交改动的延续） |
| QA 验收 + 控件登记表 + 测试补缺 + 发布准备 | ZCode（含子智能体） | 主工作树**只写文档类新文件**；代码类在 worktree `/Volumes/YANG/11-worktrees/qa`（分支 `zcode/qa`，基于 7ed2f05） | M5-T12、M0-T02 遗留控件清单、M5-T13 可做部分 |

## 文件所有权矩阵（写入许可）

| 路径 | minimaxcode | ZCode |
|---|---|---|
| `src/**`、`server/**`、`packages/**`、`public/**`、`index.html`、`vite.config.ts` | ✅ 独占 | ❌（QA 只读） |
| `tests/**` | ✅（随功能走） | 仅 worktree 分支上的 `tests/qa/**` 新文件 |
| `package.json` / lock、路由表、`src/app/**`、全局 CSS、`specs/routes.json` | ✅ CORE 独占 | ❌ |
| `docs/qa/**` | ❌ | ✅ 独占（新目录） |
| `specs/pages/controls/**` | ❌ | ✅ 独占（新目录，控件登记表） |
| `docs/engineering/tasks.md` 状态列 | ✅ | 仅可更新自己认领的行 |
| `docs/engineering/handoffs/**` | ✅ | ✅（各自新建文件，文件名带 agent 前缀） |
| `docs/engineering/COORDINATION.md` | 建议性意见写 handoff | ✅ 维护 |
| worktree `/Volumes/YANG/11-worktrees/qa` | ❌ 不动 | ✅ 独占（分支 `zcode/qa`） |

## 协作规则

1. **一个 writer 一处**：主工作树代码 writer 是 minimaxcode；ZCode 的代码只落在 worktree 分支。ZCode 在主工作树只新增文档类文件（上表所列目录），绝不修改/删除他人文件，绝不 reset/clean/stash。
2. **认领即广播**：领取任务时更新 `tasks.md` 对应行（owner+日期），并新建 handoff 文件（文件名 `2026-10-03-<agent>-<task>.md`）。对方在每次领取任务前重读 `tasks.md`、本文件与 `git log`。
3. **合并协议**：minimaxcode 在主工作树正常提交到 `main`。ZCode 的 `zcode/qa` 分支由 ZCode 自己 rebase/合并，**不自动操作主工作树的未提交改动**；合并窗口选在 minimaxcode 无在途改动的间隙，由 ZCode 发起并在 handoff 记录。分支上只新增 `tests/qa/**`，冲突面理论为零。
4. **验收口径**：minimax 在途未提交的页面，ZCode 基线验收不覆盖（以 HEAD 提交态为准），待其提交后在下一轮验收补测；不算「已验收」也不算「失败」。
5. 红线（密钥代理、loopback、无预算不真实调用、不发布等）按 AGENTS.md/GOAL.md 全文适用，两个 agent 与其子智能体同等受约束。

## 与 COLLABORATION.md 的关系（2026-10-03 对接）

主工作树内的分区契约是 [COLLABORATION.md](COLLABORATION.md)（集成者维护）：集成者独占提交权，voice/media/editors/storage/provider/server/qa 各子分区归属见其表格。本文件只定义 ZCode（QA 轨道）与主工作树的接口。冲突裁决顺序：AGENTS.md > 用户已确认决定 > COLLABORATION.md（主工作树内部） > 本文件。

- ZCode 的 worktree 分支 `zcode/qa` 上的提交不违反 COLLABORATION 铁律 2——该铁律针对共享工作树；分支是 AGENTS.md/tasks.md 明确允许的「并行需要隔离分支/worktree」路径，仅含 `tests/qa/**` 新文件，**合并由集成者执行**（或经用户同意后在安静窗口进行）。
- 用户 2026-10-03 已确认：许可证 MIT（D2）、不提供测试密钥（真实链路保持 unverified，D7 持续）、浏览器不做凭据表单输入类验证——ZCode 后续浏览器验收中 Provider 注册一律走 API/测试，不在凭据表单键入内容。
- M5-T13 与第二个 Agent 的发布门禁工作有重叠：以其已落盘产出为准（LICENSE/README 重写/门禁检查 handoff），ZCode 只补差异（干净安装验证、提交后 dist 复扫、控件登记表驱动的视觉验收）。

## 当前认领（live）

> 边界澄清（2026-10-03 03:22,致集成者）：`handoffs/2026-10-03-parallel-integration.md` 提到警告过一个"zcode 会话"勿 `git commit && git push`——**不是本 QA 会话**。本会话的全部提交仅在 worktree 分支 `zcode/qa`（纯 `tests/qa/**` 新文件），从未 push、从未在主工作树执行任何 git 写操作；如工作区另有 zcode 兄弟会话做出该行为，与本会话无关。

| 日期 | Agent | 任务 | 输出位置 | 状态 |
|---|---|---|---|---|
| 2026-10-03 | ZCode | M5-T12 基线浏览器逐页验收（HEAD 提交态） | `docs/qa/2026-10-03-baseline-browser.md` | **完成**：35 路由全可达/console 零错误/306 项测试过；2×P1（TTS 不调 run 卡 draft、local provider TTS 假成功）+2×P2 已由 ZCode 复核证实，详见报告；截图 47 张在 worktree `out/qa/` |
| 2026-10-03 | ZCode | M5-T12 自动化测试补缺 | worktree 分支 `tests/qa/**` | **完成**：93 用例 6 文件，306→399 全过/退出码 0，commit `62d9371` 待集成者合并（合并即 +93 用例）；存量问题移交见 `handoffs/2026-10-03-zcode-qa-baseline.md`；独立复跑记录 `docs/qa/tests-branch.md` |
| 2026-10-03 | ZCode | 干净安装验证（发布门禁 4） | `docs/qa/clean-install.md` | **完成**：archive HEAD → npm ci(0) → build(0) → server 5195 静态 200/session 200 |
| 2026-10-03 | ZCode | `tests/setup.ts` jsdom 相对 fetch 修法（release-gate §4 方案） | worktree 分支 | **完成但已被在途实现取代**：commit `3e21a60`。⚠️ 04:22 探查发现集成者在途树也改了 `tests/setup.ts`（更强的 stub 表版本：已知 mount 端点返回合理 200、动态路径 404）。**合并冲突预定解法：取集成者版本，丢弃 3e21a60 的 setup.ts 部分**；分支其余提交（62d9371 tests/qa、a924cc5 defect 标记+ytdlp 超时）与其零交集，不受影响。ZCode 将在 HEAD 前进后 rebase 时主动按此解决 |
| 2026-10-03 | ZCode | P1 缺陷回归标记 + ytdlp 抖动根治 | worktree 分支 | **完成**：commit `a924cc5`——`tests/qa/defect-regression.test.tsx`（D-01/D-02 极性反转标记，修复落地即翻红提醒翻转，防复发）；`tests/contract/ytdlp.test.mjs` availability probe 加 20s 超时（根治集成者记录的满负载计时抖动）。**04:53 增补**：`72ea8e7` 新增 D-05 集成级标记（session 带活 cookie 再引导不得换新会话；根因=server/index.mjs 无条件 `sessions.issue()`）。全量 402/402 exit 0。**给集成者的信号**：修 D-01/D-02/D-05 后请翻转对应 ⚠️ FLIP WHEN FIXED 断言 |
| 2026-10-03 | ZCode | M0-T02 遗留：逐页控件登记表 | `specs/pages/controls/**` | **完成**：13 文件/180 项控件；缺口见 `specs/pages/controls/gaps.md`（含两条已由 ZCode 源码复核证实：stt-youtube 路由不一致、TTS 产物定位取素材库第一条） |
| 2026-10-03 | ZCode | M5-T13 发布准备（清单/许可盘点草稿，D2 未确认不发布） | handoff | 部分启动 |
| 2026-10-03 | minimaxcode | M2 剩余 + M3-T10 + M4-T11 页面、shell/字体/provider（主工作树在途改动，约 1300 行） | 主工作树 | 进行中（ZCode 侧观察自 git status，如认领有出入请自行更正本表） |
| **2026-10-03 06:22** | — | **合并窗口建议**（ZCode 监测触发） | — | 主树连续两周期全冻结（签名 `76e31b4872aa`/6616+，无新 commit/handoff，进程空闲，最后写入 05:46）。建议顺序：① 集成者提交在途批次（55 文件/6616 插入，含其自验 331 用例绿）；② 随后合并 `zcode/qa`（7 提交，冲突面仅 `tests/setup.ts`，取集成者版本）。若集成者会话已结束无法提交，可由用户明确授权 ZCode 代为提交+合并（涉及主工作树写操作，未经授权不执行） |
