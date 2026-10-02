# 工程架构提案

**待实施，不是现有能力。** 保留现有React/Vite/TS/Tailwind单仓库，逐步增加服务端。不得为了目录结构迁移整个首页。建议Node TypeScript服务、SQLite及本地文件系统；具体框架/依赖由CORE记录ADR并验证Node/跨平台兼容（D8）。

## 分层

1. `src/`：真实路由、UI、设计令牌、功能页面/组件、本地状态。只调用本地API，不携带Provider秘密。
2. `server/`：loopback HTTP/API、会话/CSRF、凭证库、任务状态与调度、项目/素材数据库、文件处理、Provider代理、成本记录。
3. `packages/contracts/`：共享schema/版本、任务/能力/错误/本地API契约；无浏览器/Node私有实现、无秘密。
4. `packages/providers/`：typed适配器、模型/参数能力、供应商错误归一化；只能由服务端加载含秘密部分。
5. `data/`：运行时数据库/资产/临时文件/备份/加密秘密，全部私有且Git忽略。
6. `tests/`：单元/契约/集成/E2E/视觉与合成fixtures，raw研究不能复制进来。

开发保留Vite并代理本地API；发布由同一服务提供静态构建和API，避免宽泛CORS。server默认只绑定loopback，端口冲突明确报错，不fallback到公网。多人/LAN/容器公网模式在鉴权、隔离和TLS设计前不得打开。

## 先打通的主链

能力/钥匙验证→输入校验→创建原子本地task→确认成本→Provider提交→存requestId→状态查询/流式响应→产物导入本地→播放器/导出→账本/历史。页面不自行维护另一份远端任务状态。

## 决策约束

- 初期不引入微服务/Redis/外部队列；先使用可恢复本地任务存储。需要规模扩大再ADR论证。
- SDK可用官方`@elevenlabs/elevenlabs-js`，但必须检查具体版本、Node兼容、请求/响应和二进制流；不能用SDK包名代替接口验证。
- 媒体转码/渲染若需ffmpeg/本地二进制，明确安装/许可/平台/资源限制。不能shell拼接用户输入。
- 路由、公共契约、package/lock、全局CSS由CORE统一集成；功能Agent不要并发修改。

详见 [契约](contracts.md)、[Provider](providers.md)、[数据](data.md)、[安全](security.md)。
