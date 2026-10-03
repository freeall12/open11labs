# 实施任务与依赖

角色名为职责，不是已经启动的Agent。任务状态全部待接手；现有首页原型可复用，但不算全功能完成。最终范围遵守 [SCOPE](../../specs/SCOPE.md)，excluded路径不分配开发。

| 阶段/ID | 责任/写范围 | 依赖 | 输出/门禁 | 状态 |
|---|---|---|---|---|
| M0-T01 | RESEARCH：私有research、公开研究摘要 | 无 | 补创作缺失页/编辑器、冻结裁剪视觉基准；不访问账户/营销，无付费操作 | 待领取 |
| M0-T02 | CORE：App/router、共享契约、根配置 | 无 | 真路由/404、本地配置入口、所有excluded菜单移除、UI控件清单 | **部分完成**：路由/404/范围裁剪已通过 51 项测试；逐页控件清单由 ZCode 认领进行中（2026-10-03，输出 `specs/pages/controls/`） |
| M0-T03 | CORE/SECURITY：server/vault/会话 | T02 | loopback/Origin/Host/CSRF、write-only钥匙、安全负例 | **已完成**：26 项安全负例通过（2026-10-03） |
| M1-T04 | PROVIDER：packages/providers、服务适配 | T03 | ElevenLabs认证/能力/TTS，契约fixture/错误、版本与资料证据 | **部分完成**：适配器/契约/fixture/43项测试已落地；能力全部标 unverified，待真实密钥验证 |
| M1-T05 | CORE：任务/队列/成本 | T03/T04 | 持久job、去重/未知/取消、成本状态，不自动重复收费 | **已完成**：SQLite 持久化 + 42 项测试，含跨重启恢复（2026-10-03） |
| M1-T06 | STORAGE：server/storage、src/features/assets | T03/T05 | 素材/工程/历史、导出/备份、重启恢复、无账户过滤 | **部分完成**：服务端存储/工程/备份 + 23 项测试；前端素材页未做 |
| M1-T07 | SHELL/VOICE：首页/壳/TTS/播放器 | T02/T04/T05/T06 | 真正首条BYOK端到端；同条件视觉diff，无营销/头像 | **进行中**：TTS 页面与状态门禁已完成；真实提交/播放/下载待密钥与预算 |
| M2-T08 | VOICE：voice/stt/sts/dubbing/isolation | T04/T05/T06，补采 | 各工具页面/参数/真实公开能力与错误/历史/下载 | 待领取 |
| M2-T09 | MEDIA：sfx/music/image/video/lipsync/avatar | T04/T05/T06，补采 | 模型专属schema、异步任务/产物、无市场/订阅/公开销售 | 待领取 |
| M3-T10 | EDITORS：Studio/Flows/聊天 | T06/T08/T09，LLM适配 | 本地工程/时间线/DAG/修订/导出，Agent权限和成本确认 | 待领取 |
| M4-T11 | EDITORS/VOICE：有声书/剩余创作工具 | 补采/T10 | 每个保留入口对应真实功能或已知阻塞，商业/账户部分排除 | 待领取 |
| M5-T12 | QA：tests/测试报告 | 分阶段持续 | 路由/按钮/边界/错误/恢复/视觉/效果/体验分层报告 | **基线轮完成**（ZCode，2026-10-03）：35 路由实测+180 项控件表+93 新用例(306→399 过)，2×P1+2×P2 缺陷待 FEATURE 修复，证据 `docs/qa/`、`specs/pages/controls/`、worktree 分支 `zcode/qa`(62d9371 待合并)；在途页面待集成者提交后由监控循环复验 |
| M5-T13 | CORE/SECURITY：运行发布文档/许可 | 全部/决策确认 | 干净安装、发布物扫描、无秘密/研究、许可与OS支持证据 | **大部分完成**：D2/MIT 已确认（LICENSE 落盘）；秘密扫描通过（双方独立）；干净安装链路实测通过（`docs/qa/clean-install.md`）；OFL 字体预审通过（`release-prep` 增补节）；README 已重写待提交——剩余阻塞：D3 图标授权、集成者提交后 dist 复扫/checksum 终检、发布授权 |

## 文件所有权

- CORE独占package.json/lock、src/App.tsx、router、全局CSS、共享schema、routes.json和任务表的最终合并。
- 功能角色写自己的`src/features/<module>`，需要共享组件改动先提交契约变更请求给CORE。
- PROVIDER只负责适配器；不能在页面里新增另一套认证/任务/费用逻辑。
- QA读实现、写tests和报告，不改业务源码掩盖失败；修复由负责writer/集成者完成。
- 同cwd一个writer；并行需要隔离分支/worktree，合并按依赖顺序。
- ZCode × minimaxcode 并行分工、文件所有权矩阵与合并协议见 [COORDINATION.md](COORDINATION.md)（2026-10-03 起生效，领取任务前必读）。

## 交付口径

每项带R/ACID、证据、测试命令/退出码、未测项/能力阻塞。M1通过只表示首条任务链完成，不等于所有创作页完成。不得为了赶进度把困难创作工具归为营销或账户而排除。
