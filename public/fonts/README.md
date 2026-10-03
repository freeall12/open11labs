# 可分发字体

仅收录**已授权可公开分发**的字体。加入文件前记录来源与许可。

| 文件 | 家族 | 许可 | 来源 |
|---|---|---|---|
| `Outfit-latin.woff2` / `Outfit-latin-ext.woff2` | Outfit（可变 100–900） | SIL OFL 1.1（见 `OFL-Outfit.txt`） | google/fonts 上游发布 |
| `Inter` | 正文 | 通过 CSS `font-family` 走系统/回退链，未内嵌文件 | — |

## 已移除：Waldenburg

早期版本直接从原站 CDN 抓取了 Waldenburg 的 woff2 并打包进仓库。这些是 ElevenLabs
的专有字体，**不可再分发**，与本仓库的开源定位冲突。已删除，替换为 OFL 授权的 Outfit。

替换带来**已知字形差异**：Outfit 是几何无衬线、x-height 更大，标题比 Waldenburg 略宽略圆；
原站 hero 用的半压缩字重（WaldenburgHF）在 Outfit 中没有对应切面，改为同家族加字距压缩
近似。这是有意记录的偏差，不是"1:1 一致"。详见 `docs/engineering/licensing.md`。

另见 [许可](../../docs/engineering/licensing.md)。
