# 检查点 2026-10-03 · 任务执行器（链路缺失的关键一环）

## 缺口

此前 `generate()` 只创建本地任务，**没有任何东西真正调用 Provider**。
即使拿到密钥也无法端到端跑通。本检查点补上执行器。

## 新增

- `server/lib/runner.mjs` — 任务执行器
- `server/index.mjs` — `POST /api/v1/jobs/:id/run`
- `tests/contract/runner.test.mjs` — 16 项

## 崩溃安全的执行顺序

```
1. 落本地 intent            （创建时已完成，持久）
2. transition → submitting   （任务可见地在途）
3. 调用 Provider
4. 落 requestId              （能证明被接受的瞬间）
5. 导入产物为 Asset
6. transition → succeeded
```

第 3 步和第 4 步之间崩溃，重启时 `reconcileAfterRestart()` 把它变成
`unknown_submission`，**而不是静默重发**。

## 失败分类：能否证明未被接受

| 情况 | 状态 | 可否重试 |
|---|---|---|
| 超时 / 5xx | `unknown_submission` | **否** |
| 4xx（参数/权限） | `failed` | 是 |
| 空响应体 | `failed` | 是 |
| 密钥已被删除 | `failed`（`AUTH_REQUIRED`） | 否 |

## 三个花钱相关的保障

1. **密钥不进持久化快照**。密钥在派发瞬间从金库按 `credentialRef` 解析，
   绝不写进 job 的 input（那会落进 SQLite）。测试直接查数据库行断言不含密钥。
2. **空产物不算成功**。`assertArtifact` 拒绝 0 字节响应——空 body 是失败，
   不是长度为 0 的成功。
3. **失败不记为免费**。失败的调用记 `unknown` 而非 0，因为失败也可能计费。

## 重复计费防护

`run()` 入口先查 `canSubmit()`：在途/未知/已成功的任务直接拒绝，
**不发起任何网络调用**。测试断言连点两次只到达 Provider 一次。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 10 files, 219 tests passed
npx vite build        exit 0
```

## 测试抓到的真实缺陷

1. **`#fail()` 把 job 对象当 id 传** → `transition(undefined)` 查库返回 null
2. 我最初把密钥写成 `job.input.__key` —— **那会把密钥存进 SQLite**。
   这是本轮最严重的设计缺陷，已改为派发时从金库解析，测试直接查库验证。

## 未完成

- 执行器是**显式单步**（`POST /jobs/:id/run`），尚未接入自动队列调度
- 产物未做格式/时长校验（需真实响应）
- 异步型任务（图像/视频的 `pending` 轮询）尚未实现
- **未做任何真实 Provider 调用**，全链路仍缺真实密钥与预算授权
