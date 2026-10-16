# 代码结构与数据边界

| 目录 | 内容 |
|---|---|
| `app/` | 网站页面、登录/授权页、API、OAuth metadata 与 MCP HTTP 路由 |
| `lib/` | 行情和数据源适配、数据核对、所有者鉴权、OAuth 与 MCP 协议 |
| `db/`、`drizzle/` | D1 表定义、完整迁移 SQL 与 Drizzle 元数据 |
| `build/` | Sites/Vite/Workers 运行和本地开发接入源码 |
| `scripts/` | 安装/构建辅助、回归测试、发布审计 |
| `components/`、`public/`、`vendor/` | UI 组件、静态资源及保留许可证的样式 |
| `.openai/hosting.json` | 新站点所需 D1/MCP 能力声明，不含原项目 ID |
| `python-backend/` | 可选独立 FastAPI 后端、Dockerfile、固定依赖、项目自有日线适配和测试 |

HTTP 请求经 Sites 身份层到应用。原生 `/mcp` 接受平台验证的身份；外部 MCP 先验证自身 OAuth token 后确定用户，不能用客户端自报身份覆盖。OAuth state、PKCE、CSRF、一次性授权码、refresh rotation 与撤销均有回归测试。

金融数据本身来自公开上游，但本部署的查询入口限制为所有者。D1 保存 OAuth 客户端、授权请求、授权码及 token 哈希。所有者更换后旧授权失效。行情缓存有时效且只在 Worker 实例内，不是持久行情数据库。

此次发布以两个当前生产项目的完整跟踪源文件为基线。旧工作目录中的同项目历史检出不重复收录；已被当前同站 OAuth 路径替代的旧独立 Claude 转发网关不属于当前部署依赖。开源快照不携带原 Git 历史、运行数据、平台凭据或构建产物。具体文件对应关系与排除原因见 [PRIVACY_AND_COMPLETENESS.md](PRIVACY_AND_COMPLETENESS.md)。
