# 检查点 2026-10-03 · 音色列表接入与选择器

## 本次变更

TTS 页不再只有音色 ID 输入框，改为可搜索/筛选/预览的选择器。
`GET /v1/voices`（此前已用无密钥探测确认存在，401）已接入。**未做真实认证调用。**

### 新增

- `packages/providers/elevenlabs/adapter.mjs` — `listVoices()`
- `server/index.mjs` — `GET /api/v1/voices`
- `src/lib/api.ts` — `voices.list()`
- `src/features/voice/VoicePicker.tsx` — 搜索/语言筛选/预览/选择
- `tests/integration/voices.test.mjs` — 7 项

## 关键行为

**不伪造音色。** 响应结构从未用真实密钥验证过，因此解析是防御性的：
- 结构无法识别 → 返回空列表**加原因**，绝不编造音色
- 没有可用 id 的条目 → 丢弃，而不是生成空白项
- 每个条目都带 `unverified: true`

**不静默换声。** 若已选音色不在当前列表中（被删除或无权访问），
页面红色提示并要求重新选择，**不会自动换成别的音色**——否则会生成用户
没有选择、也无法看到的音频。

**不代取预览。** 适配器只*记录* `preview_url`，绝不主动抓取。
未验证的字段不能触发请求。测试断言整个流程只有一次调用，
且是音色目录本身。

**失败不是空列表。** 传输失败时返回原因与错误码，而不是一个看起来像
"没有音色"的空选择器。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 9 files, 203 tests passed
npx vite build        exit 0
```

真实浏览器验证（无 Provider 状态）：
- 搜索框存在且**禁用** ✓
- 语言筛选存在，选项为「全部（0）」✓
- 提示「尚未配置 Provider，无法读取音色」✓
- 保留「手动输入音色 ID」兜底 ✓

## 未完成

- 音色条目内容仍未经过真实认证响应核验（`unverified: true`）
- 音色预览播放器需真实响应才有 URL
- 逐控件登记表未写
