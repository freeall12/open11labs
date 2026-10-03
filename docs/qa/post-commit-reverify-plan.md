# 集成者提交后复验作战清单 — ZCode QA 循环执行用

触发条件:主工作树 HEAD 前进(集成者已提交在途批次)。按序执行,每步记录退出码;发现缺陷即时写入 docs/qa/ 新文件并更新 COORDINATION。

## A. 分支同步(先行,5 分钟)

1. `git -C /Volumes/YANG/11-worktrees/qa rebase main`
2. **预定冲突 `tests/setup.ts`:取 theirs(集成者 stub 表版本),丢弃我 3e21a60 的同文件改动**(意图相同、其版本更强);rebase 后确认 3e21a60 只剩"空转"或直接 drop 该 commit——若 rebase 因内容等价自动跳过则无需动作
3. `npm run typecheck` + `npm test`:预期用例数 ≈ 新 HEAD 基线 + 95(tests/qa 93 + defect 标记 2);**若 defect-regression 两标记测试翻红 = 对应 P1 已修,翻转极性**(D-01 改 expect(["job_d001"]);D-02 改存在性+端点断言,stub 模式见 local-provider-branches.test.mjs)
4. `git clean -fdq -- assets`(勿用 rm -rf,见 watch 循环#2 注记)

## B. 浏览器复验(重点:原 24 条占位路由)

1. `npm run build`;`node server/cli.mjs --port 5188 --root dist --data data-qa`
2. ego-browser 逐页:渲染/console/空态/主控件/键盘抽查;截图 `out/qa/cycle-<n>-<route>.png`
3. 优先顺序:Studio(含编辑器 `/app/studio/:id`)、Flows 画布(拖拽/连线/节点菜单/⌘Z⌘S——上轮发现画布与外壳 z-index 重叠已修,复验)、聊天会话、有声书(分章/批量生成/取消)、音色库(弹层/试听条)、音乐两栏、STT 库四页签、speakers、历史/收藏、品牌套件、全局搜索(⌘K)
4. 对照 `specs/pages/controls/pending-*.md` 骨架:每验完一页升级为正式登记表(三方交叉:规范×新代码×routes.json 证据)
5. **不向 Provider 凭据表单键入任何内容**(用户决定);Provider 注册走 API 验证链路

## C. 发布物与门禁回填

1. dist 秘密复扫(`sk-`/`VITE_*`/PEM 模式)+ `assets/` 跟踪状态复查(集成者是否已 `git rm --cached`)
2. OFL 字体 checksum 终检(下载 Outfit 官方发布比对;属公开资源获取,不涉付费)
3. 干净安装验证复跑(clean-install.md 追加新 HEAD 记录)
4. README 命令复核(集成者重写版,重点:5173/5174 端口说明)
5. release-prep 门禁表更新 + tasks.md M5-T12 状态推进

## D. 已知待验缺陷(修复确认)

| ID | 内容 | 验证方式 |
|---|---|---|
| D-01 | TTS 不调 run 卡 draft | defect 标记翻转 + 浏览器实测任务流转 |
| D-02 | 本地 Provider TTS 假成功 | defect 标记翻转 + mock `/v1/audio/speech` 请求日志 |
| D-04 | UI 无法登记自托管 Provider | 集成者已在途重写(catalog 驱动),浏览器验类型选择器+requiresSelfHosted |
| D-05 | session 重复签发→双标签页 CSRF 403 | 双 tab 场景实测 |
| 控件级 | gaps.md 全部 10 类 | 登记表升级时逐项闭环 |
