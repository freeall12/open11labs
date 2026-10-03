# 发布准备草稿 — M5-T13(ZCode 轨道,2026-10-03)

状态:**草稿/预备**。对应 [release.md](release.md) 十项门禁逐项对账。D2(许可证/品牌)未获用户确认前不发布、不 push——本文件只是把可预先核实的项做掉,把阻塞项显式化。

## 门禁对账(2026-10-03 基线)

| # | 门禁 | 当前状态 | 证据/缺口 |
|---|---|---|---|
| 1 | 路由/逐控件清单+分层验收 | 部分进行中 | 控件登记表编制中(`specs/pages/controls/`,ZCodeB);浏览器基线验收中(`docs/qa/`,ZCodeA) |
| 2 | 无营销/账户入口 | 已有测试 | `tests/contract/routing.test.tsx` 51 项(路由级);逐控件复查随登记表补 |
| 3 | typecheck/build/各层测试记录 | 基线绿 | worktree HEAD:typecheck 退出码 0;`npm test` 基线 331 项(GOAL.md 台账,本轮 QA 复核中) |
| 4 | 干净启动/loopback/持久化/备份 | 部分验证 | server loopback+同源有安全测试;重启恢复有 jobs 测试;**干净机器 npm ci 全新安装未测**(阻塞:主工作树共享 node_modules,需独立环境) |
| 5 | 秘密/研究/资产扫描 | 本轮初扫通过 | 见下「扫描记录」 |
| 6 | 密钥/CSRF/SSRF 等负例 | 已有 | `tests/integration/security.test.mjs` 26 项 |
| 7 | Provider 文档/成本未知说明 | 部分 | 能力全标 unverified;真实验证阻塞 D7(用户密钥+预算) |
| 8 | D2 许可证/名称/资源权利 | **阻塞** | 待用户确认 MIT+独立品牌;字体见下 |
| 9 | README 真实命令完整 | 部分 | 现有 README 是首页原型时代说明+实测表;需按 BYOK 全功能重写(待 minimax 页面提交后) |
| 10 | 用户授权后发布 | 未启动 | 按协议不自动发布 |

## 许可盘点(候选,发布前以 node_modules 内 LICENSE 逐项复核)

- 直接依赖(均为宽松许可证,候选):react/react-dom、react-router-dom、vite、@vitejs/plugin-react、tailwindcss(v4)、typescript(Apache-2.0)、vitest、@testing-library/*、jsdom。
- **字体是发布硬阻塞(HEAD 状态)**:当前 `public/fonts/` 的 Waldenburg 系列为无授权资产,不可随开源包分发(D3)。主工作树在途改动正在替换为 Outfit(SIL OFL 1.1,已附 `OFL-Outfit.txt`)——方向正确;合并后需复核:woff2 实际来自 Outfit 官方发布、OFL 声明文件随包、无残留 Waldenburg 引用。
- `research/`、`tools/*-bundle.js`、`data/`、`scripts/`(除两个白名单)已在 .gitignore,发布物须再扫一遍确认未混入。

## 扫描记录(2026-10-03,只读,基于 HEAD)

- 模式 `sk_*` / `api_key=...` / PEM 私钥头 / `VITE_*KEY|SECRET|TOKEN`:唯一命中 `tests/integration/validation.test.mjs:18` 的 `sk_integration_fixture_0000`(显式命名的测试假钥匙,无真实凭据特征)。结论:通过,发布前在 bundle/dist 产物上复扫。
- 个人标识(gmail/qq/laplace)在代码目录:0 命中。
- `elevenlabs.io` 引用仅存在于:provider 适配器 API base URL、vault/设置页的公开文档链接、字体来源注释——需在品牌化(D2)时一并处理文案,非泄漏。

## 2026-10-03 03:10 增补(对接第二个 Agent 的门禁检查 handoff)

`handoffs/2026-10-03-release-gate.md` 已完成本文件多项待办,对账更新:

- **门禁 8(D2)已确认**:用户 2026-10-03 答复,自有代码 MIT,`LICENSE` 已落盘(未提交);品牌 open11labs。图标授权(D3)仍阻塞发布。
- **门禁 9(README)已重写**(未提交),并发现真问题:`server/cli.mjs` 默认 5173 而 vite 代理指向 5174,裸 `npm run dev` 会得到全部 API 失败的界面;新 README 已写明正确启动方式。
- **门禁 5 双方独立扫描结论一致**(无真实密钥);其新增发现:`assets/` 下 148 个 8 字节占位文件已被跟踪入库(约 1.2KB,卫生问题非泄密),需集成者执行 `git rm -r --cached assets`;`research/`/`data/` 确认从未进历史。
- **门禁 3 新缺口**:`npm test` 331 用例全过但 exit 1(jsdom 下组件 mount 即请求相对路径 `/api/...`,Node fetch 拒绝相对 URL;非产品缺陷)。修法建议在 release-gate §4(tests/setup.ts 补相对 URL 解析+可控 /api 失败响应),归属待定,QA 轨道可认领在 `zcode/qa` 分支实现供集成者合并。
- D7 用户已答复不提供密钥:真实链路按「未验证」交付,不越权。

ZCode 剩余独有项不变:干净安装验证(独立临时目录)、集成者提交后 dist 复扫、控件登记表驱动的逐页视觉验收。

## 待办(按顺序)

1. ZCodeA/B/C 三个子智能体产出合并后,把门禁 1/3 的证据补齐。
2. minimax 页面提交并合并字体替换后:复核 OFL 合规 + dist 产物秘密扫描。
3. 独立干净环境(临时目录,非共享 node_modules)执行 `npm ci && npm run build && node server/cli.mjs` 实测,回填门禁 4。
4. ~~README 重写计划~~ 已由第二个 Agent 完成,待其提交后复核命令,不重复写。
5. ~~D2~~ 已确认 MIT;D7 已明确无密钥按未验证交付;D3 图标授权仍阻塞发布。

## 2026-10-03 03:52 OFL 字体合规预审(ZCode,在途树只读)

门禁 8 / D3 字体部分,提交后正式复核的预检证据:

- `public/fonts/` 内容:`Outfit-latin.woff2`(14.7KB)、`Outfit-latin-ext.woff2`(32.2KB)、`OFL-Outfit.txt`(完整 SIL OFL 1.1 文本,Copyright 2021 The Outfit Project Authors)——**随附许可文本 ✓,无专有字体二进制残留 ✓**(4 个 Waldenburg woff2 已删除,对应 git D 记录)
- 实现方式:`src/fonts.css` 保留 `@font-face family:"Waldenburg"/"WaldenburgHF"` 名称但 `src` 指向 Outfit 文件——令牌/组件层零改动,发布物分发的是 OFL 字体数据,合法
- 残留 "Waldenburg" 字样仅存于:CSS family 别名、注释、`--font-waldenburg` 令牌名、`font-waldenburg` 工具类——内部标识符,非资产,**不阻塞发布**;建议 D2 品牌化时改为中性名(如 `--font-display`)以免公开仓库出现专有字体名造成困惑
- 待提交后终检项:woff2 与 Outfit 官方发布版 checksum 比对(需联网下载官方文件,发布前执行);dist 产物秘密扫描

## 2026-10-03 05:22 当前阻塞全景(谁卡住什么)

| 事项 | 状态 | 等待 |
|---|---|---|
| 门禁1 控件登记表升级+24 占位路由复验 | 就绪(post-commit-reverify-plan.md) | 集成者提交 |
| 门禁3 主树 npm test exit 1 | 分支已备解法(3e21a60;集成者在途有更强版本,合并取 theirs) | 集成者提交+合并 |
| 门禁4 干净安装(新 HEAD 复跑) | HEAD 7ed2f05 已过 | 集成者提交 |
| 门禁8 D3 图标授权 | 未动 | **用户/项目发起者** |
| 门禁9 README 复核+dist 秘密复扫+OFL checksum | 方案就绪 | 集成者提交 |
| D-01/D-02/D-05 缺陷修复 | 分支有回归标记(修复即翻红) | 集成者(在途未修) |
| 真实供应商生成验证 | 永久按未验证交付 | 用户已决定不提供密钥(D7) |
| 分支 zcode/qa(6提交)合并 | 冲突已预定解法(仅 setup.ts 取 theirs) | 集成者或用户授权的安静窗口 |
