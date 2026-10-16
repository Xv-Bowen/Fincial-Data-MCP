# 可选 Python 金融数据后端

这是独立 FastAPI 服务，不能放进 Sites Worker 中运行。默认网站使用 HTTP 适配，不部署本目录也可以工作。需要运行 AKShare/BaoStock 时，将此目录部署到支持 Python 进程和所需出站网络的主机，再由 Sites 通过 HTTPS 调用。

## 实际能力

| provider | 实现 | 注意 |
|---|---|---|
| `akshare` | `ak.stock_zh_a_hist_tx` | 腾讯来源，none/qfq/hfq；不算腾讯以外的独立来源 |
| `ashare` | 本项目 `adapters/daily.py` | 保留兼容名称；新浪不复权、腾讯前复权；不自动切换，非上游 Ashare 原库 |
| `baostock` | BaoStock Python SDK | 匿名登录到数据服务，需要主机网络允许相应连接 |
| `efinance` | 停用 | 依赖仍保留用于原项目完整依赖说明，但历史路由明确拒绝，不访问已移除来源 |

仅沪深 A 股日线、单次最多六年；上游可能提供更短范围。分钟线、周/月线与完整三方库 API 不在本服务公开协议内。返回底层来源、复权、币种、时间和原始单位；由 Worker 做完整性和同口径核对。

## Docker

```sh
docker build -t fincial-data-backend ./python-backend
# 先在当前终端/主机的安全 secret 设置中配置 FINANCE_BACKEND_TOKEN。
docker run --rm -p 127.0.0.1:8080:8080 --env FINANCE_BACKEND_TOKEN fincial-data-backend
```

通过受控 HTTPS 反向代理暴露端口，在 Sites 设置 `FINANCE_BACKEND_URL=https://你的后端域名` 和相同的 `FINANCE_BACKEND_TOKEN`。不要把 token 放在命令行字面值、仓库或公开聊天里。容器以非 root 用户运行；对外服务应配置限流、并发控制与必要的主机防护。

## Python 环境

```sh
cd python-backend
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest test_daily.py
uvicorn main:app --host 127.0.0.1 --port 8080 --workers 1
```

Docker 基线 Python 3.13。requirements 固定依赖版本；部署时需能够下载这些版本。`GET /health` 无需 token，只报告依赖安装/版本及明确的 `upstream_connectivity_verified:false`；不能据此认定行情通。

`POST /history` 要求 `Authorization: Bearer <你的 token>`，JSON 示例：

```json
{"provider":"baostock","symbol":"sh600000","start_date":"2026-01-05","end_date":"2026-01-09","adjust":"none"}
```

每次查询独立子进程，20 秒上限；HTTP 10 秒 timeout、TLS 校验开启，失败只返回错误类型，不回显 credential 或上游原始敏感内容。增加负载前应自行做限流与容量规划。发布测试验证了自有适配的确定性行为，不承诺外部网络/行情持续可用。

## 许可处理

旧版本含上游 `Ashare.py`；在未发现明确许可文件的情况下，本次不重新分发它，改为原创日线兼容适配。上述两条应用实际用到的能力已保留，旧文件替换记录可在完整性报告查看。其余 pip 依赖不打包进仓库，按上游许可证安装；见根目录 NOTICE。
