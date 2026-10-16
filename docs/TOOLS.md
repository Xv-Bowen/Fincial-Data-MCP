# 完整 MCP 工具目录

从 lib/market.ts 的 TOOLS 生成，共 10 个，只读。完整参数、必需字段和限制见 [tools.json](tools.json)。

| 工具名 | 功能 |
|---|---|
| `finance_exchange_rates` | 查询参考汇率 |
| `finance_macro_indicator` | 查询年度宏观指标 |
| `finance_sources_status` | 查看数据来源 |
| `finance_multi_source_history` | 多来源历史行情 |
| `finance_compare_history` | 交叉核对历史行情 |
| `akshare_service_status` | 检查服务状态 |
| `akshare_search_securities` | 搜索证券 |
| `akshare_stock_quotes` | 查询行情快照 |
| `akshare_stock_history` | 查询历史日线 |
| `akshare_market_indices` | 查询主要指数 |

工具实现存在不等于上游当前可用。状态工具不代表 live connectivity；实际来源、时间和覆盖以每次查询返回为准。
