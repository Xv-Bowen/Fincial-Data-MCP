# 配置

| 名称 | 必需 | 说明 |
|---|---|---|
| `SITE_ORIGIN` | 是 | 自己的 HTTPS 站点源地址；无路径、用户密码、query 或 hash。仅本地 localhost 可用 HTTP |
| `FINANCE_OWNER_EMAIL` | 是 | 自己登录 Sites 的 ChatGPT 账号邮箱，私密变量；不应写进公开代码 |
| `DB` | 是 | Sites D1 binding，应用 OAuth 状态需要它 |
| `FINANCE_BACKEND_URL` | 否 | 独立 Python 后端 HTTPS 源地址，Worker 请求其 `/history` |
| `FINANCE_BACKEND_TOKEN` | 配后端时必需 | 由部署者生成的随机私密 token，Sites 与 Python 主机设置同值 |

默认来源不要求个人厂商 API key。后端 token 是你自己的服务访问凭据，不是券商或行情供应商账号。示例 `.env.example` 不可用于真实授权。

外部 OAuth scope 为 `finance.read`，支持授权码 + PKCE、官方客户端 metadata 与动态客户端注册、refresh rotation、撤销。只读授权可以自动续期，但最长授权周期、所有者更换和撤销都能使旧 token 失效。不要以关闭 owner 校验解决账号不匹配。

公开站点是为了外部客户端能访问 OAuth 发现；查询、授权和撤销仍验证所有者。`oai-authenticated-user-*` 只可信于 Sites 网关后方，非 Sites 自托管需实现身份边界。

D1 schema 和 migrations 包含在仓库。没有数据库导出、原连接 token 或行情缓存；部署者独立初始化并授权。
