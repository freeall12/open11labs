# 任务 M5-T12 基线验收轮 + M0-T02 控件清单 交接 — ZCode(QA)

- 角色/工作目录/分支:ZCode QA 轨道;文档直接写主工作树;代码在 worktree `/Volumes/YANG/11-worktrees/qa`,分支 `zcode/qa`,起始 `7ed2f05`,结束 `62d9371`(该轮 QA 测试补缺,**待集成者合并**)
- 需求/验收ID:R1-AC02(控件/视觉基线)、R3-AC01/R4(API 与错误路径)、M5-T12 分层报告、M0-T02 UI控件清单
- 本次改变的路径:主工作树新增 `docs/qa/**`(基线报告+监控日志)、`specs/pages/controls/**`(13 文件)、`docs/engineering/COORDINATION.md`、`release-prep-2026-10-03.md`、tasks.md 三行认领、两个 zcode handoff;worktree 分支新增 `tests/qa/**`(6 文件)。**零契约变更,零业务源码改动**
- 已实现操作与证据:
  - 浏览器基线验收(实测,本机服务+mock,零外部调用):35 in-scope 路由全可达/console 零错误/11 excluded 全部正确跳转/重启持久化符合设计;47 截图(worktree `out/qa/`)→ `docs/qa/2026-10-03-baseline-browser.md`
  - 控件登记表(文档核对):180 项控件三方交叉(规范×HEAD代码×routes.json 证据),10 类缺口 → `specs/pages/controls/`(索引+gaps.md)
  - 测试补缺(模拟测试):93 新用例,`npm test` 306→399 全过/退出码 0,typecheck 0 → `tests/qa/README.md`
  - 发布准备增补:与第二个 Agent 的门禁 handoff 对账(见 release-prep 增补节)
- 发现的关键缺陷(均经 ZCode 源码/日志复核,待 FEATURE 修复):**P1** TTS 页不调 `jobsApi.run` 任务永久卡 draft(`TtsPage.tsx:154`);**P1** 本地 Provider TTS 被 dispatch 到 chat-only submit,mock 证实 `/v1/audio/speech` 调用 0 次却"成功"(`runner.mjs`);**P2** Provider 表单无法登记自托管(硬编码 `type:"elevenlabs"`);**P2** `GET /api/v1/session` 每次签发新会话,双标签页 CSRF 403;另 stt-youtube 路由不一致、TTS 产物取 `assets[0]` 而非 job 产物、首页死控件群等(控件级,见 gaps.md)
- 测试命令、退出码、环境:`npm run typecheck`=0;`npm test`=0(399/22 文件,worktree Node 环境实测);浏览器验收=本机 5188 端口 server+5190 mock;分类:浏览器项=实测(本机)、测试项=模拟测试、控件表=文档核对
- 是否修改Provider/模型/费用/持久化/秘密处理:否
- 排除范围检查:excluded 路由仅验 404/跳转,全部通过;无营销/账户 UI 混入
- 未完成/未运行/阻塞:minimax 在途页面(约 24 条路由)待集成者提交后由监控循环复验;真实供应商生成=阻塞(用户已确认不提供密钥,D7 按未验证交付);逐控件视觉精确对比(D4 阈值未冻结)未做
- 存量问题移交集成者:①GOAL.md 台账"331"为在途树数字,HEAD 实测 306(分支合并后 399);②存量集成测试(`upload.test.mjs` 等)不传 dataDir,污染仓库根 `assets/`;③`tests/README.md` 内容过期;④`npm test` 在含 Studio/Flows 等新页面的在途树 exit 1(jsdom 相对 fetch,修法建议 release-gate §4,QA 可认领在分支实现)
- 残余风险/待确认 DID:D3 图标授权(阻塞发布);D4 视觉阈值;分支合并时机由集成者定
- 持续机制:每 15 分钟监控循环已在跑(docs/qa/minimax-watch.md),集成者提交新页面后自动复验并升级控件登记表
