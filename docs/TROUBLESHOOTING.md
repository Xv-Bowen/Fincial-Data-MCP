# 故障排查

| 现象 | 原因与处理 |
|---|---|
| 首页提示配置地址 / issuer 错误 | 设置新站点 `SITE_ORIGIN`；不使用原作者域名、URL path 或 OAuth 回调 URL 作为 origin |
| 所有者设置尚未完成 / 503 | 设置私密 `FINANCE_OWNER_EMAIL`，部署变量后重新发布 |
| 403 非所有者 | 使用与变量匹配的 ChatGPT 账号登录；不要关闭 owner 限制或让客户端自报邮箱 |
| 外部 Claude 连接得到平台 403 或 HTML | 先确保整站 OAuth 发现入口可访问；保持应用内 OAuth 验证，使用 `/api/mcp` |
| 401 OAuth challenge | 未授权、过期或撤销；由客户端开始 OAuth，不能选择“无验证” |
| 旧工具列表 / `resultType` 校验失败 | 部署完整最新代码、刷新关联插件/连接器并新开对话；不要混用旧路由/旧网关 |
| `invalid_grant` | 授权码重复使用、PKCE/issuer/resource/callback 不匹配，或 refresh token 重用；重新连接，不重复兑换旧授权码 |
| BaoStock `not_connected` | Sites Worker 不运行 Python/raw TCP；部署外部 Python 后端并同时配置 URL/token |
| Python health 正常但无行情 | health 仅检查进程和依赖版本，不验证上游网络；必须做一条受授权的 `/history` 实查 |
| `python_backend_configured` | 只表示变量已设置，不代表库/API 实测可用；查看实际查询状态 |
| efinance `disabled` / Eastmoney `removed` | 当前实现主动停用该路径，不通过重试恢复；不要把它们计为可用数据源 |
| 多源只有一个独立来源 | AKShare 与腾讯共源，Ashare 兼容路径可能与新浪/腾讯共源；按 underlying_source 去重 |
| `unsupported_adjustment` | 新浪 Worker 只提供不复权；不要偷偷切换到其他复权口径。Python 兼容适配仅支持 none/qfq |
| 新浪历史区间超出限制 | 缩短近期查询范围；接口可能只返回部分覆盖，不能假设有六年完整数据 |
| 腾讯/新浪超时、空数据、HTTP 错误 | 上游限流/改版/网络；使用明确支持的其他来源或稍后重试，保留失败状态；不要伪造价格 |
| 查询日期看似缺失 | 非交易日、停牌、来源覆盖或缺失数据；系统不会自动补造 |
| 汇率不是今天实时价 | ECB 日度参考汇率以实际返回日期为准，周末和假期可能沿用最近公布日 |
| WDI 年度数据滞后或为空 | 按指标覆盖、单位、年份与修订时间解释，不把缺失当 0 或预测 |
| `node:sqlite` / 包安装失败 | Node 22.13+、固定 pnpm/lock；检查网络与供应链策略，不删除锁文件绕过 |

## Python 后端

使用 HTTPS，保持 token 只在服务器。401 检查两端 token 是否匹配；502 看脱敏错误类型与后端日志；504 表示上游超过 20 秒进程限时。容器进程存活不等于可访问 BaoStock TCP 或公共 HTTP 来源。

## 提交问题

附工具名、去标识化参数、来源状态、实际时间和可复现结果。不上传 token、所有者邮箱、授权码、D1 文件或完整请求头。数据质量问题要同时说明 symbol、日期、复权、币种和字段单位，不能只比较表面数字。
