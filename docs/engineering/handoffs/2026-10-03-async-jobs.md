# 检查点 2026-10-03 · 异步任务（图像/视频）轮询

## 本次变更

执行器此前只处理同步返回。图像与视频返回 `{id, status:"pending"}`
需要轮询（API-07/08），这条路径缺失。

### 新增

- `packages/providers/elevenlabs/adapter.mjs` — `submitAsync()` / `pollStatus()`
- `server/lib/runner.mjs` — `poll()` 与 `#ingest()`
- `server/index.mjs` — `POST /api/v1/jobs/:id/poll`
- `server/lib/assets.mjs` — 由内容类型推导文件名
- `tests/contract/async.test.mjs` — 12 项

## 状态映射：未识别 ≠ 完成

```
pending / queued / processing / in_progress  -> running
completed / succeeded / done                 -> completed
failed / error / cancelled / canceled        -> failed
其他一切                                     -> unknown
```

`unknown` **绝不**映射为 `completed`。一个拼写错误不该被读成"任务完成"。

## 四个会产生错误结果或重复计数的失败模式

1. **重启重新生成而非恢复轮询** — 远端 id 在提交时就落库；
   重启后 `reconcileAfterRestart` 标 `unknown_submission` 但**保留 requestId**，
   可以向上游查询，绝不重新生成。
2. **未识别状态被当作完成** — 保持 `running` 并报告所见。
3. **下载失败被报成生成失败** — 两者是**两个独立事实**。任务记
   `ASSET_IMPORT_FAILED`、`submissionCertainty: "accepted"`，
   提示语明确写「可重新下载同一结果，**无需重新生成**」。
4. **远端称完成但无产物地址** — 标 `unknown_submission`，**不**标成功。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 10 files, 231 tests passed
npx vite build        exit 0
```

## 测试抓到的真实缺陷

1. **`assertArtifact` 在异步分支之前执行** — 异步返回没有 `artifact`，
   被当成失败，任务错误地落到 `failed`。已把异步判断前置。
2. **产物无扩展名被资产库拒绝** — `job-<id>` 不含后缀。
   改为按 content-type 推导扩展名。

## 未完成

- **未持有真实密钥**，异步路径同样只有契约测试覆盖
- 轮询无退避策略与最大次数（应由调度器负责，尚未实现）
- 图像/视频页面未实现
- 无自动队列调度
