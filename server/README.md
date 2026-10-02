# 本地服务端（待实施）

职责：loopback/API、会话/CSRF、vault、能力、任务/成本、本地存储/媒体输出。当前仅目录骨架，没有服务器或启动脚本。

由CORE维护。读 [架构](../docs/architecture/README.md)、[安全](../docs/architecture/security.md)、[契约](../docs/architecture/contracts.md)。建议按 api/security/credentials/jobs/storage/media/services 分目录，具体实现时创建。

不实现原站注册/登录/会员/账户系统；本地API安全授权不可省略。不得把Provider秘密发给浏览器。
