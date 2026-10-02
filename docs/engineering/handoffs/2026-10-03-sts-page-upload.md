# 检查点 2026-10-03 · 变声器页与资产上传

## 本次变更

`/app/speech-to-speech` 从占位页换成真实实现，并补上**资产上传**——
变声器的输入是音频，不能像 TTS 那样把文本塞进 job 快照。

### 新增 / 修改

- `packages/providers/elevenlabs/adapter.mjs` — `submitSts()`（multipart）
- `server/index.mjs` — `POST /api/v1/assets` 上传端点
- `server/lib/runner.mjs` — STS 输入从资产读取
- `src/lib/api.ts` — `assets.upload()`（FormData）
- `src/features/voice/StsPage.tsx` — 变声器页
- `tests/integration/upload.test.mjs` — 7 项

## 队列

多文件排队、一次转换。每项独立成任务、独立计费。录音不可用时
（未授权 / 无设备）**回退到上传**，不静默失败。

## 硬约束：STS 不能用 TTS 的模型 ID

规范明确 `eleven_multilingual_sts_v2` 与 TTS 模型不可混用。
做法是双保险：

1. 选择器**只列** STS 模型
2. 适配器**本地拒绝** TTS 模型 ID，不发任何请求

测试断言传 TTS 模型时 fetch 完全没被调用。

## 上传限额标为「未经 API 验证」

50MB 是上游**网页对该工具**的观察值，不是 API 限额，也不适用于其他工具。
页面把它标为未验证，并按文件逐个说明为什么被跳过。

## 任务快照不携带音频

上传先落为资产，job 只存 `assetId`。这既是 `docs/architecture/data.md`
的要求，也避免把音频塞进 SQLite。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 12 files, 238 tests passed
npx vite build        exit 0
```

## 测试抓到的真实缺陷

1. **multipart 首边界没有前导 CRLF** —— 只查 `\r\n--boundary\r\n` 会漏掉第一个
   文件段，上传永远解析失败。
2. **给 FormData 设了 `content-type: undefined`** —— FormData 必须自己带
   boundary，显式设置会破坏解析。改为仅对字符串 body 设 JSON 头。

## 未完成

- 输出格式、采样率等 STS 专属参数未接（需真实 schema 核验）
- 队列目前逐个同步执行，无并发上限
- **未持有真实密钥**，成功路径仍只有契约测试覆盖
