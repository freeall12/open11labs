# Provider能力与公开接口矩阵

仅为已读资料与实施计划，**无真实API测试通过**。准确来源见 [官方资料](../research/official-sources.md)。用户自己提供API钥匙，禁止用网页登录token或私有app端点。具体模型/价格/权限运行时核验。

| 能力 | 首选映射/资料 | 状态与实施依赖 |
|---|---|---|
| TTS | ElevenLabs `/v1/text-to-speech/:voice_id`，API-02 | 文档已读；流/输出/音色列举需补契约；新多说话人考虑API-09而非永远单声TTS |
| STS | `/v1/speech-to-speech/:voice_id`，API-04 | 示例eleven_multilingual_sts_v2，不能用TTS ID |
| STT | `/v1/speech-to-text`，API-03 | 文件模式已读；实时WebSocket是另一能力，需另核验 |
| 分离 | `/v1/audio-isolation`，API-05 | multipart；结果类型和限制需真实验证 |
| 音效 | `/v1/sound-generation`，API-06 | 时长/循环/编码权限按模型校验 |
| 图像 | `/v1/flows/image`，API-07 | 异步id/status；查询/输出下载待补；部分ByteDance模型需审批 |
| 视频/口型 | `/v1/flows/video`，API-08 | 模型各异，口型是否通过该分支需具体schema核验，不凭名称假定 |
| 音乐 | DOC-04 | 创建/编辑/查询端点待核验，不猜路径；许可限制不可绕过 |
| 配音 | DOC-07 | v1/v2及编辑权限不同，创建/查询/下载契约待核验 |
| 音色管理/设计/克隆/混音 | DOC-10 | 各公开端点和同意/身份/审批规则待核验；业务不可假实现 |
| Studio/有声书 | 本地工程+对应音频能力 | 不要求复制云账号项目系统；解析/渲染/章节导出由本地实现 |
| Flows | 本地DAG+上述typed能力 | 本地存图/执行器不是调用站点私有Flows工程API |
| 聊天/LLM节点 | 用户另配的LLM Provider | 独立BYOK；OpenAI兼容协议仅用于适配其实际支持的接口，不意味着所有模型支持音频/图片/视频 |
| 可选离线Provider | 用户本机服务显式注册 | 自有模型/能力独立，不声称与ElevenLabs模型等效 |

UI能力三态与审批/不可用中性提示；禁止植入订阅/升级营销。Provider缺能力记录为阻塞，不自动换供应商或模型。

## 接入PR必交

官方链接/时间/SDK版本、认证方式、输入/输出schema、支持模型与上下限、价格与许可依据、流/异步/查询/取消/幂等情况、错误/速率限制、凭证脱敏、低成本验证方式、二进制/文件校验、合成契约fixture、真实测试授权及残余缺口。

文档、mock、真实调用分别报结果。重试不能未经确认重复付费；unknown submission需按任务契约处理。
