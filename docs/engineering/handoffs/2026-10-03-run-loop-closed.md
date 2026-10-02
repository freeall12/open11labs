# 检查点 2026-10-03 · 执行链路闭环

## 本次变更

TTS 页此前创建任务后**从不执行**，UI 侧链路是断的。本次把
`POST /jobs/:id/run` 接进页面，闭环打通。

### 修改

- `src/lib/api.ts` — `jobs.run()`、`AssetRecord`
- `src/features/voice/TtsPage.tsx` — 创建后执行一步；重复意图给出明确提示
- `server/index.mjs` — 修正 `runner` 未传入 `createApi` 的作用域缺陷

## 真实链路证据

用一个**无效的假密钥**发起真实 HTTP 请求（不消耗任何额度，
也不是用户密钥），验证执行器确实到达了供应商：

```
1) 执行  -> status=failed | error=PROVIDER_AUTH_FAILED | API 密钥无效或已失效
2) 再执行 -> 服务端按状态机处理
3) 成本  -> money=[]  unknown=1     ← 失败未被记为 0
```

这证明：执行器真的发出了请求、401 被正确映射、失败没有伪造成免费。

## 重复提交的用户可见反馈

若 `intentId` 命中已有任务，页面显示
「这次提交与上一次完全相同，已复用同一个任务，不会重复计费」，
而不是假装发生了一次新的生成。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 10 files, 219 tests passed
npx vite build        exit 0
```

## 修复的真实缺陷

`runner` 在 `createLocalServer` 里创建，但**没有传入 `createApi`**，
导致 `/jobs/:id/run` 运行时抛 `runner is not defined` → 500。
这是本会话第三次出现"加了参数但忘了往下传"的同一类缺陷
（前两次是 `log`、`dataDir`）。已补。

## 未完成

- **未持有真实有效密钥**，因此成功路径（拿到音频、导入资产、播放、下载）
  仍未经真实调用验证，只有契约测试覆盖
- 异步任务（图像/视频的 `pending` 轮询）未实现，执行器只处理同步返回
- 无自动队列调度，执行是显式单步
- 产物未做格式/时长校验
