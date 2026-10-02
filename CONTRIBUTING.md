# 贡献指南

先读 [AGENTS](AGENTS.md)、[文档入口](docs/README.md) 与 [范围](specs/SCOPE.md)。保持已有React/Vite基线；本项目不实现原站营销/账号系统，保留本地BYOK配置。

领取任务并确定文件所有权；共享根配置/契约由CORE合并。每个PR关联任务/R-ACID、说明证据与契约变化、附真实测试命令/结果、缺口/风险。不要提交秘密、账号截图、研究DOM或未经授权资源；合成fixtures必须标记。

现有有效命令为npm run typecheck/build及node scripts/check-docs.mjs；新增服务端/测试后同步真实命令。真实生成需专用授权钥匙与预算，不用作者登录浏览器凭证。

具体流程见 [任务](docs/engineering/tasks.md)、[接力](docs/engineering/agent-handoffs.md)、[测试](docs/engineering/testing.md)。不把一次截图或mock成功称为端到端完成。许可证待发起者确认，参见 [许可](docs/engineering/licensing.md)。
