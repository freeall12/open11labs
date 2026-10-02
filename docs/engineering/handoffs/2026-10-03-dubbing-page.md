# 检查点 2026-10-03 · 配音页

## 本次变更

`/app/dubbing` 从占位页换成真实实现。**未调用任何 Provider**。

## 端点先探测，不猜

规范说配音端点"待核验"。我先用无密钥探测确认（零费用）：

| 端点 | 有 key | 无 key | 结论 |
|---|---|---|---|
| `POST /v1/dubbing` | 401 | — | 存在 |
| `GET /v1/dubbing/studio` | **401** | **404** | 存在且需鉴权 |
| `GET /v1/dubbing/studio/{id}` | 401 | 404 | 存在 |
| `POST/DELETE .../studio/{id}` | 405 | 405 | 路径存在但方法不对 |

「有 key 401 / 无 key 404」是这个 API 区分真实路由与未知路径的特征，
所以能确证端点存在。**没有猜测任何路径。**

## 两段式项目流

配音不是同步返回：先 `POST /v1/dubbing` 建项目拿 id，再
`GET /v1/dubbing/studio/{id}` 轮询。远端项目 id 提交时就落库，
重启后能续上。

状态映射是**配音自己的词汇表**（pending/in_progress/finished/failed），
不与图像/视频共用——共用会把 `finished` 漏掉。

## 两个数字我不合并

v2（Alpha）报 104 语言、v1 报 29 语言，且原站各视图本身就不一致。
页面上两个数字**分开列出并标"未经核验"**，不内置语言清单，
不替用户断言某个语言可用——提交后由 Provider 判定。

## 一个我主动不做的功能

**v1 编辑器未采，本版不提供。** 没观察过的界面画出来就是假功能。

## 产物地址不交给浏览器

轮询时只*记录*生成文件地址；真正下载由服务端带密钥完成，
浏览器既拿不到签名 URL 也拿不到密钥。

## 验证

```
npx tsc -b --noEmit   exit 0
npx vitest run        exit 0 — 13 files, 256 tests passed
npx vite build        exit 0
```

## 测试抓到的缺陷

1. **配音的 dispatch 未标 `async: true`** —— 被当成同步处理，
   `assertArtifact(undefined)` 抛错，任务错误落到 `failed`。
2. 测试文件缺少 `MP3` 夹具定义。

## 未完成

- 语言清单未接（需真实响应核验）
- 配音产物列表未在页面内展示（目前提示去素材库）
- 说话者页、Studio/Flows/聊天/有声书/音乐/素材页仍占位
- **未持有真实密钥**
