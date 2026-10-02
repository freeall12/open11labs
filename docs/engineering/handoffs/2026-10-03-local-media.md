# 检查点 2026-10-03 · 纯代码媒体分析（零 Provider 可用）

## 本次变更

实现 `server/lib/media.mjs`：直接从字节解析音频的容器、时长、波形包络与静音区段。
**不需要任何 Provider、密钥或网络**，因此一个密钥都没配时应用依然有真实能力。
这对应 `docs/architecture/oss-patterns.md` 里 hypit 的"纯代码渲染兜底"思路。

### 新增

| 路径 | 作用 |
|---|---|
| `server/lib/media.mjs` | WAV/MP3 头解析、波形、静音检测 |
| `tests/contract/media.test.mjs` | 11 项 |
| `GET /api/v1/assets/:id/probe` | 返回时长/格式/波形/静音，标注 `computedBy: "local"` |

## 真实实测

上传一个 1 秒 WAV（前半 440Hz 正弦、后半静音），服务端解析结果：

```
format         : wav
durationSeconds: 1        ← 与真实一致
computedBy     : local
waveform bars  : 120
silenceSpans   : [[61, 119]]   ← 正好是后半段静音
```

## 关键：不确定就说不确定

- `m4a`/`ogg`/`flac` 的时长**未实现**，返回 `null` + 「未做猜测」。
  时长错了会静默污染时间轴工作，所以宁可说不知道。
- 波形只解码**无压缩 PCM（WAV）**。压缩格式需要真正的解码器，
  凭空画一条"看起来像"的波形等于伪造数据，所以返回 `null`。

## 顺带修掉一个真 bug

资产库原先**信客户端声明的 MIME**。curl 发的是 `application/octet-stream`，
真实 WAV 因此被判为"类型不符"而拒收。

现在改为**从字节头嗅探**真实容器。声明与字节矛盾时拒绝上传
（客户端可能在说谎），但 `application/octet-stream` 被视为
「我不知道」而非「我声明不是这样」。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 15 files, 288 tests passed
npx vite build        exit 0
```

## 这一条为什么重要

有了它，以下能力在**零 Provider**下也成立：
格式与时长校验（提交前就能拒掉坏文件）、波形展示、静音裁剪参考、
时间轴规划。它也让"未配置密钥"不再等于"什么都做不了"。
