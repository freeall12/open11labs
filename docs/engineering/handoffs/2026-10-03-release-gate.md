# 发布门禁检查点（2026-10-03）

**执行人**：第二个 Agent（负责 MIT LICENSE / 决策记录 / 交接 / 发布前检查）
**范围**：只读检查 + 文档。**未执行任何 `git commit` / `push` / `reset` / `clean` / `stash`**，
也未改 `package.json`。共享工作树的所有代码变更由集成者统一提交。

> 本文件记录**实测证据**，四类严格分开：**实测** / **文档验证** / **模拟测试** / **未验证**。
> 不把「用例通过」说成「命令可用」，不把「未验证」说成「已完成」。

---

## 0. 本轮落地的文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `LICENSE` | 新增 | MIT；单列第三方资产，**不把图标并入 MIT** |
| `.gitignore` | 修改 | 新增 `/assets/`，阻止运行时素材再次进入版本库 |
| `README.md` | 重写 | 原内容与代码严重不符，见 §5 |
| `docs/DECISIONS.md` | 修改 | D2/D3 结案 + 记录发起者 2026-10-03 答复 |
| 本文件 | 新增 | 门禁证据 |

---

## 1. 秘密检查（门禁第 5 条）

**实测**：

- 工作树 `src/ server/ packages/ tests/ specs/ docs/ scripts/` 扫描
  `sk-[A-Za-z0-9]{16,}` / `xi-api-key` / `Authorization: Bearer …`：
  命中项全部是**头部名常量、备份拒绝名单、以及形如 `sk-synthetic-not-real`
  `sk-async-fixture-0001` 的测试固定值**，无真实密钥。
- 构建产物 `dist/assets/*.js` 扫描 `sk-[A-Za-z0-9]{16,}`：**0 命中**。
- Git 全历史 `git log --all -p | grep -oE "sk-[A-Za-z0-9]{20,}"`：**0 命中**。
- 暂存区 `git diff --cached --name-only`：**空**。

**结论**：无凭据泄露。

---

## 2. 发布物扫描（门禁第 9 条）

**实测 —— 有一项需要集成者处理**：

`assets/` 目录下 **148 个文件已被 Git 跟踪并推到 `origin/main`**，涉及 5 个提交
（`f5e454d` / `93d4228` / `19aa44a` / `2504da3` / `7ed2f05`）。

需要澄清规模，避免误判：

- 这些文件**全部是 8 字节**（仅一个 `ID3` 头），148 × 8 B ≈ **1.2 KB**。
- 工作树里 `du -sh assets` 显示 101M 是 **exFAT 块分配假象**；实际
  `find … -exec stat -f %z` 总量 = **1.8 KB / 233 个文件**。
- 所以这是**卫生问题，不是体积或泄密问题**。里面没有真实生成结果。

`research/` 目录**从未进入历史**（`git log --diff-filter=A` 无命中），
`data/` 亦未进入。**结论：`research/` 排除规则有效。**

**已由我处理**：`.gitignore` 加 `/assets/`，对新路径生效
（`git check-ignore assets/ZZZ-new-file.mp3` → 命中 `.gitignore:63`）。

**需要集成者执行**（会改共享 index，故不由我运行）：

```bash
git rm -r --cached assets --quiet   # 保留磁盘文件，仅解除跟踪
```

> 注意：解除跟踪**不清理历史**。历史里的 1.2 KB 占位文件要彻底移除需改写历史，
> 代价与收益不成比例，建议只解除跟踪并在 `.gitignore` 留痕。

---

## 3. 服务端负例抽查（门禁第 6、8 条）

**实测**（`node server/cli.mjs --port 5199`，web root = `dist/`）：

| 检查 | 结果 |
|---|---|
| 静态首页同源可达 | `200` |
| 会话引导 `GET /api/v1/session` | `200`，返回 `csrfToken` |
| 伪造 Host `evil.example.com` | **`403`** ✅ 拒绝 |
| 路径穿越 `/../../../etc/passwd` | `200` 但 `leak=0` |
| 编码穿越 `%2e%2e%2f%2e%2e%2fetc/passwd` | `200` 但 `leak=0` |
| 穿越到源码 `assets/../../server/lib/vault.mjs` | `200` 但 `leak=0` |

**结论**：无文件泄露。但穿越请求返回 `200`（落到 SPA 的 `index.html` 兜底），
语义上应返回 `400`。属**加固项，非漏洞**，已记录不阻塞发布。

**未验证**：Vault 加密备份、备份恢复、跨版本迁移——需要真实数据目录往返，
留待集成者或在有受控环境时执行。

---

## 4. 校验命令真实状态（门禁第 3 条）

**实测**，本机 Node v26.7.0 / npm 11.19.0：

```bash
npx tsc -b --noEmit   # exit 0
npx vitest run        # 20 files / 331 tests passed —— 但 exit 1
npx vite build        # exit 0
```

### ⚠️ 发现：`npm test` 退出码为 1

331 个用例**全部通过**，但 vitest 报 **12 个 Unhandled Rejection**，进程退出码 **1**。

根因（已定位）：

```
TypeError: Failed to parse URL from /api/v1/session
  at src/lib/api.ts:41  →  fetch("/api/v1/session")
  源自 tests/contract/routing.test.tsx
```

组件测试在 jsdom 里渲染会请求 API 的页面，`src/lib/api.ts` 用**相对路径**发起
fetch；vitest 的 jsdom 环境下全局 `fetch` 是 Node undici，**拒绝相对 URL**。
最近新增的页面（`StudioPage` / `FlowsPage` / `ChatSessionPage` / `BooksAndKits` 等）
在 mount 时即请求，使这个老问题浮出水面。

**这不是产品缺陷**——浏览器里 `fetch("/api/v1/…")` 同源完全正常。
但它使 `npm test` 不可用，属于门禁第 3 条「运行记录」不达标。

**建议修法**（属 `tests/**` 或 `vitest.config.ts`，非我所有权，未擅自改）：
在 `tests/setup.ts` 给全局 `fetch` 补一个相对路径解析层，并让未命中的
`/api` 请求落到可控的失败响应，避免掩盖真实断言。

```ts
// tests/setup.ts —— jsdom 的 location 是 http://localhost:3000，
// 但全局 fetch 是 Node undici，不接受相对 URL。组件在 mount 时会请求 API。
const nodeFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/")) {
    return nodeFetch(new URL(input, "http://localhost:3000").toString(), init);
  }
  return nodeFetch(input as RequestInfo, init);
}) as typeof fetch;
```

> 注意：仅解析 URL 会让请求真的打到 `localhost:3000` 并连接被拒，
> 仍会产生未处理 rejection。更稳妥的是让 stub 对 `/api` 返回一个可控错误响应，
> 由组件走它自己的失败分支。

---

## 5. README 命令可用性（门禁第 9 条）

**实测发现原 README 与代码严重不符**，已重写。原文的错误：

| 原文 | 实际 |
|---|---|
| 「范围：仅首页」 | 已实现 30+ 路由、多模块页面 |
| 「顶栏右侧铃铛 ✅」 | 铃铛与头像**已按范围裁剪删除** |
| 列出 4 个 Waldenburg woff2 | 文件**已删除**，换成 OFL Outfit |
| 「美术资源全部来自源站」 | 字体已合规替换，图标授权未清 |
| `## 已知边界` 空章节 | 改为有内容的边界清单 |
| `npm run dev` 即完成 | **错误**：API 代理默认指向 5174，而 `server/cli.mjs` 默认监听 **5173** |

**最关键的一条**：`server/cli.mjs` 不带参数默认 `--port 5173`，
而 Vite 代理目标是 `http://127.0.0.1:5174`。只跑 `npm run dev` 会得到
一个**所有 API 调用都失败**的界面，且不报错。新 README 已写明必须
`node server/cli.mjs --port 5174 --data ./data`。

**README 中所有命令均已核对存在**（`dev` / `build` / `typecheck` / `test` / `start`），
未写入任何不存在的 Docker 或测试命令。

---

## 6. 资源来源与许可（门禁第 12 条）

- **D2 许可证：已确认 MIT**，`LICENSE` 已落盘，第三方资产在文件内单列。
- **D3 字体：已处置**。原站专有 Waldenburg 已删除，替换 OFL Outfit，
  `public/fonts/OFL-Outfit.txt` + `public/fonts/README.md` 记录偏差。
- **D3 图标：仍未确认**。`src/lib/icons.tsx` 的几何取自参考站渲染 UI，
  再分发权利未获确认。`LICENSE` 与 `README` 均已显式声明「待清权」。
  **这一项仍阻塞发布。**

---

## 7. 门禁结论

| 门禁项 | 状态 |
|---|---|
| 秘密检查 | ✅ 通过 |
| 发布物无私有研究/账号标识 | ✅ 通过（`assets/` 跟踪问题见 §2） |
| typecheck / build | ✅ 通过（exit 0） |
| 测试运行记录 | ⚠️ 用例全通过但 `npm test` exit 1，见 §4 |
| README 命令可用性 | ✅ 已重写并核对 |
| 负例抽查（Host / 穿越） | ✅ 通过（穿越语义待加固） |
| D2 许可证 | ✅ 已确认 |
| D3 字体 | ✅ 已处置 |
| D3 图标授权 | ❌ **仍阻塞发布** |
| 逐控件视觉精确验收 | ❌ **未完成** |
| M1-T07 真实 BYOK 链路 | ❌ **未验证**（发起者决定不提供密钥） |
| 对外发布授权 | ❌ 未获授权 |

**总评：不满足发布门禁。** 至少 D3 图标授权、逐控件视觉验收、
M1-T07 真实链路三项未结，**不得对外发布，不得宣称已完成 1:1 复刻或 100% 真实功能**。

---

## 8. 交接给集成者的待办

1. `git rm -r --cached assets --quiet`（解除 148 个 8 字节占位文件的跟踪，保留磁盘文件）。
2. 决定 `npm test` exit 1 的修法归属（`tests/setup.ts` 建议方案见 §4）。
3. 提交前照 `COLLABORATION.md` 提交规则执行：清 `._*` 残片、扫暂存区 PII、扫 `�` 损坏字符。
4. 本文件与 `LICENSE` / `README.md` / `docs/DECISIONS.md` 尚未提交。
