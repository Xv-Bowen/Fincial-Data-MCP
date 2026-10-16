# Fincial Data MCP

公开服务页面：[访问现有站点](https://akshare-mcp-20261012.spiffy-bard-9497.chatgpt.site)。该地址用于查看当前服务；自己部署请使用自己的新站点地址与授权。

金融数据 MCP 与完整查询网站，支持部署到自己的 ChatGPT Sites。仓库名保留 **Fincial Data MCP**，应用界面名称为 **Financial Data**。

应用版本基线 **1.4.1**，**10 个只读工具**。包含网站前后端、OAuth、D1、行情/宏观/汇率适配、多来源价格核对，以及可选 Python 后端的完整代码、Dockerfile 与依赖。不是完整 AKShare 在线托管，也不包含交易、下单或持仓接口。

## 能力与真实来源

| 能力/路径 | 默认情况 |
|---|---|
| 证券搜索、行情快照、指数、历史日线 | Worker 内直接 HTTP 适配 |
| 不复权多源查询 | 默认腾讯与新浪；真实可用性由每次结果说明 |
| AKShare 适配 | 无 Python 时适配腾讯日线，与腾讯直接接口共源 |
| Ashare 兼容名称 | 项目自有日线适配；未分发上游无明确许可证的源文件 |
| BaoStock | 需要外部 Python 后端及可用网络，默认未接通 |
| efinance / Eastmoney 历史路径 | 已停用/移除，不发起请求、不计入默认可用来源 |
| 汇率 / 宏观 | Frankfurter 的 ECB 参考汇率、世界银行 WDI 年度指标 |

只比较同证券、同日期、同复权、同币种且完整的 OHLC；同源结果不算独立验证。不投票选出真值，不填造缺失数据。成交量与成交额保留原始口径，默认不参与跨源比较。数据更新时间、覆盖范围和各源失败状态必须随结果保留。

## 快速部署

1. 按 [Sites 部署指南](docs/DEPLOY_TO_CHATGPT_SITES.md) 导入本仓库并创建自己的新站点。
2. 设置 `SITE_ORIGIN` 与私密 `FINANCE_OWNER_EMAIL`；原作者的地址和邮箱不会继承。
3. Sites 关联插件使用 `/mcp`；Claude / 手动 ChatGPT MCP 使用 `/api/mcp`，选择 OAuth 自动注册。
4. 登录自己的站点所有者账号并确认只读授权，调用 `akshare_service_status` 与 `finance_sources_status`。
5. 如需要 Python 库或 BaoStock，单独部署 [python-backend](python-backend/README.md)。不部署也可使用默认 HTTP 来源。

```sh
pnpm install --frozen-lockfile
node scripts/test-mcp-oauth.mjs
pnpm typecheck
pnpm build
```

Node.js 22.13+、pnpm 11.25.0。所有业务查询和外部 OAuth 授权仅供配置的站点所有者；不能用公开源码或匿名请求访问原部署。

## 文档

- [配置](docs/CONFIGURATION.md) · [Sites 部署](docs/DEPLOY_TO_CHATGPT_SITES.md) · [10 个工具与 schema](docs/TOOLS.md)
- [Python 后端](python-backend/README.md) · [故障处理](docs/TROUBLESHOOTING.md) · [架构](docs/ARCHITECTURE.md)
- [隐私与完整性审计](docs/PRIVACY_AND_COMPLETENESS.md) · [开源变更](docs/RELEASE_NOTES.md)

## 使用边界与许可证

公共数据接口可能限流、延迟、改版或停止服务；源码开源不代表数据服务 SLA，也不授予数据再分发权。根据用途自行确认各上游使用条款。金额、复权和参考汇率不能直接当作可成交报价。

项目自有代码采用 [MIT](LICENSE)，第三方权利见 [NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。所有依赖固定在锁文件/requirements；运行密钥、个人配置、数据库、访问日志和历史市场查询记录均不在仓库中。
