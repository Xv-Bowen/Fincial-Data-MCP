import iconv from "iconv-lite";
import { z } from "zod";

import { env } from "cloudflare:workers";
import { siteOrigin } from "./site-config";
export const SERVICE_VERSION = "1.4.1";
export const DESCRIPTION = "把市场数据接入AI助手。";
type Row = Record<string, unknown>;
const cached = new Map<string, { until: number; value: unknown }>();

async function upstream(url: URL, format: "json" | "gbk" = "json", ttl = 30): Promise<any> {
  const key = `${format}:${url.href}`;
  const previous = cached.get(key);
  if (previous && previous.until > Date.now()) return previous.value;
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json, text/plain, */*" }, redirect: "manual" });
  if (!response.ok) throw new Error(`数据源暂时不可用（HTTP ${response.status}），请稍后重试。`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > 3_000_000) throw new Error("数据源返回内容过大，请缩小查询范围。");
  const text = format === "gbk" ? iconv.decode(Buffer.from(buffer), "gbk") : new TextDecoder().decode(buffer);
  const value = format === "gbk" ? text : JSON.parse(text.replace(/^[^\[{]*=\s*(?=[\[{])/, "").replace(/;\s*$/, ""));
  if (cached.size > 100) cached.clear();
  cached.set(key, { until: Date.now() + ttl * 1000, value });
  return value;
}

export function normalizeSymbol(value: string): string {
  const s = value.trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(s)) return s;
  if (!/^\d{6}$/.test(s)) throw new Error("请使用六位证券代码，或 sh/sz/bj 加六位代码。指数请带市场前缀，例如 sh000001。");
  if (/^(920|4|8)/.test(s)) return `bj${s}`;
  if (/^(6|5|9)/.test(s)) return `sh${s}`;
  return `sz${s}`;
}
function numeric(value: unknown): number | null {
  if (value === "" || value == null || value === "-") return null;
  const v = Number(value);
  return Number.isFinite(v) ? v : null;
}
function envelope(source: string, data: Row[], extra: Row = {}): Row {
  return { source, retrieved_at: new Date().toISOString(), timezone: "Asia/Shanghai", row_count: data.length, data, ...extra };
}
function priceUnit(symbol:string){return /^(sh000|sz399)/.test(symbol)?"点":symbol.startsWith("sh900")?"USD":symbol.startsWith("sz200")?"HKD":"CNY";}
export function parseTencentQuotes(text: string): Row[] {
  const data: Row[] = [];
  for (const match of text.matchAll(/v_((?:sh|sz|bj)\d{6})\s*=\s*"([^"\r\n]*)"/g)) {
    const f = match[2].split("~");
    if (f.length < 40 || !f[1] || !f[2]) continue;
    const stamp = f[30];
    data.push({ symbol: match[1], code: f[2], name: f[1], price: numeric(f[3]), price_unit:priceUnit(match[1]), previous_close: numeric(f[4]), open: numeric(f[5]), high: numeric(f[33]), low: numeric(f[34]), change: numeric(f[31]), change_percent: numeric(f[32]), volume_raw: numeric(f[36]), amount_raw: numeric(f[37]), turnover_percent: numeric(f[38]), pe: numeric(f[39]), pb: numeric(f[46]), quote_time: /^\d{14}$/.test(stamp) ? `${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}` : stamp || null });
  }
  return data;
}
export async function quotes(symbols: string[]): Promise<Row> {
  const requested = [...new Set(symbols.map(normalizeSymbol))];
  const url = new URL("https://qt.gtimg.cn/");
  url.searchParams.set("q", requested.join(","));
  const data = parseTencentQuotes(await upstream(url, "gbk", 15));
  if (!data.length) throw new Error("数据源没有返回这些证券的行情，请检查代码或稍后重试。");
  return envelope("腾讯财经", data, { requested, missing: requested.filter(s => !data.some(row => row.symbol === s)), units: { price: "以每条记录的 price_unit 为准；指数为点", change_percent: "%", volume_raw: "腾讯原始口径，证券类型间可能不同", amount_raw: "腾讯原始成交额口径，非人民币证券不统一换算", turnover_percent: "%" }, note: "返回最新可用快照，可能存在延迟；行情时间为北京时间，以 quote_time 为准。" });
}
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s; }, "日期必须有效，格式为 YYYY-MM-DD");
const historySchema = z.object({ symbol: z.string(), start_date: dateSchema, end_date: dateSchema, adjust: z.enum(["none", "qfq", "hfq"]).default("none"), limit: z.number().int().min(1).max(500).default(200), offset: z.number().int().min(0).max(10000).default(0) }).strict();
export function parseTencentHistory(body: any, symbol: string, adjust: string): Row[] {
  const item = body?.data?.[symbol];
  if (!item) return [];
  const rows = item[adjust === "none" ? "day" : adjust + "day"];
  if (!Array.isArray(rows)) throw new Error("数据源未返回指定复权方式的数据，请选择其他复权方式重试。");
  return rows.filter((r: unknown) => Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(String(r[0]))).map((r: unknown[]) => ({ date: r[0], open: numeric(r[1]), close: numeric(r[2]), high: numeric(r[3]), low: numeric(r[4]), volume_raw: numeric(r[5]), turnover_raw: numeric(r[7]), amount_raw: numeric(r[8]) }));
}
export async function history(input: unknown, includeAll = false): Promise<Row> {
  const args = historySchema.parse(input);
  const symbol = normalizeSymbol(args.symbol);
  if (args.start_date > args.end_date) throw new Error("开始日期不能晚于结束日期。");
  const firstYear = Number(args.start_date.slice(0,4));
  const lastYear = Math.min(Number(args.end_date.slice(0,4)), new Date().getUTCFullYear());
  if (firstYear < 1990 || lastYear - firstYear > 5) throw new Error("单次查询最多六个自然年；更长区间请分段查询。");
  const unique = new Map<string, Row>();
  const adjustment = args.adjust === "none" ? "" : args.adjust;
  for (let year = firstYear; year <= lastYear; year++) {
    const url = new URL("https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get");
    url.searchParams.set("param", `${symbol},day,${year}-01-01,${year + 1}-12-31,640,${adjustment}`);
    const body = await upstream(url, "json", 300);
    for (const row of parseTencentHistory(body, symbol, args.adjust)) unique.set(String(row.date), row);
  }
  const all = [...unique.values()].filter(r => String(r.date) >= args.start_date && String(r.date) <= args.end_date).sort((a,b) => String(a.date).localeCompare(String(b.date)));
  const data = includeAll ? all : all.slice(args.offset, args.offset + args.limit);
  return envelope("腾讯财经；参考 AKShare stock_zh_a_hist_tx 接口适配", data, { symbol, price_unit:priceUnit(symbol), adjust: args.adjust, requested_range: [args.start_date, args.end_date], total_rows: all.length, offset: args.offset, next_offset: args.offset + data.length < all.length ? args.offset + data.length : null, units: { open: priceUnit(symbol), close: priceUnit(symbol), high:priceUnit(symbol), low:priceUnit(symbol), volume_raw: "腾讯原始口径，证券类型间可能不同", turnover_raw: "腾讯原始口径", amount_raw: "腾讯原始口径" }, note: "成交量、成交额保留数据源原始字段，未统一单位；复权会影响价格比较。" });
}
export function parseTencentSearch(text:string):Row[]{
  const match=text.match(/\bv_hint\s*=\s*("(?:[^"\\]|\\.)*")/);
  if(!match)throw new Error("证券搜索数据源没有返回有效结果，请稍后重试。");
  let value:string;try{value=JSON.parse(match[1]);}catch{throw new Error("证券搜索返回格式暂不可用。");}
  const unique=new Map<string,Row>();
  for(const item of value.split("^")){const f=item.split("~");if(!/^(sh|sz|bj)$/.test(f[0])||!/^\d{6}$/.test(f[1])||!f[2])continue;const symbol=f[0]+f[1];unique.set(symbol,{symbol,code:f[1],name:f[2],security_type:f[4]||null,market:f[0],quote_id:symbol});}
  return [...unique.values()];
}
export async function searchStocks(keyword: string, limit: number): Promise<Row> {
  const url=new URL("https://smartbox.gtimg.cn/s3/");
  for(const [key,value] of Object.entries({v:"2",t:"all",c:"1",q:keyword.trim()}))url.searchParams.set(key,value);
  const entries=parseTencentSearch(await upstream(url,"gbk",300));
  return envelope("腾讯财经",entries.slice(0,limit),{keyword,scope:"沪深京证券；仅返回当前行情工具支持的市场",note:"名称或代码有多个匹配时，请按返回的市场前缀和证券名称确认。"});
}
const annotation = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
export const TOOLS = [
  {name:"finance_exchange_rates",title:"查询参考汇率",description:"通过 Frankfurter 查询欧洲央行来源的最新或指定日期参考汇率，无需厂商 API Key。返回实际日期和兑换方向；这是日度参考价，非实时交易价。",inputSchema:objectSchema({base:{type:"string",pattern:"^[A-Za-z]{3}$",default:"USD"},quotes:{type:"array",items:{type:"string",pattern:"^[A-Za-z]{3}$"},minItems:1,maxItems:10,default:["CNY","EUR"]},date:{type:"string",format:"date"}}),annotations:annotation},
  {name:"finance_macro_indicator",title:"查询年度宏观指标",description:"查询世界银行 WDI 年度指标：GDP、GDP 增速、人均 GDP、消费物价增速、ILO 模型失业率或总人口。国家用 CHN、USA 等代码。保留单位、统计年份、修订日期与缺失值，不提供预测。",inputSchema:objectSchema({country:{type:"string",pattern:"^[A-Za-z]{2,3}$"},indicator:{type:"string",enum:["NY.GDP.MKTP.CD","NY.GDP.MKTP.KD.ZG","NY.GDP.PCAP.CD","FP.CPI.TOTL.ZG","SL.UEM.TOTL.ZS","SP.POP.TOTL"]},start_year:{type:"integer",minimum:1960,maximum:2100},end_year:{type:"integer",minimum:1960,maximum:2100}},["country","indicator","start_year","end_year"]),annotations:annotation},
  {name:"finance_sources_status",title:"查看数据来源",description:"查看腾讯、新浪及接口适配的配置状态，单列已停用的 efinance 日线路径和待接通的 BaoStock。也包含宏观与汇率来源；配置不代表实时可用。",inputSchema:objectSchema({}),annotations:annotation},
  {name:"finance_multi_source_history",title:"多来源历史行情",description:"按指定来源查询同一沪深 A 股的日线。返回每个来源的实际状态、底层数据源、日期、复权口径与原始数据。不复权默认腾讯与新浪，复权默认腾讯；未接通来源不进入默认查询。来源失败时保留状态，不编造补齐。",inputSchema:objectSchema({symbol:{type:"string"},start_date:{type:"string",format:"date"},end_date:{type:"string",format:"date"},adjust:{type:"string",enum:["none","qfq","hfq"],default:"none"},providers:{type:"array",items:{type:"string",enum:["tencent","sina","akshare","ashare","baostock"]},minItems:1,maxItems:5},limit:{type:"integer",minimum:1,maximum:500,default:100},offset:{type:"integer",minimum:0,default:0}},["symbol","start_date","end_date"]),annotations:annotation},
  {name:"finance_compare_history",title:"交叉核对历史行情",description:"比较同一沪深 A 股、同日期、同复权和币种的日线开高低收，列出差异。AKShare 适配与腾讯共源，Ashare 与新浪共源，都不重复计为独立验证。无重叠或不足两种实际来源时明确说明。",inputSchema:objectSchema({symbol:{type:"string"},start_date:{type:"string",format:"date"},end_date:{type:"string",format:"date"},adjust:{type:"string",enum:["none","qfq","hfq"],default:"none"},providers:{type:"array",items:{type:"string",enum:["tencent","sina","akshare","ashare","baostock"]},minItems:1,maxItems:5},limit:{type:"integer",minimum:1,maximum:500,default:100},offset:{type:"integer",minimum:0,default:0}},["symbol","start_date","end_date"]),annotations:annotation},
  { name: "akshare_service_status", title: "检查服务状态", description: "查看本站支持的查询范围、数据源及运行方式。本站是常用接口适配版，完整 AKShare Python 库未在此运行。", inputSchema: objectSchema({}), annotations: annotation },
  { name: "akshare_search_securities", title: "搜索证券", description: "通过腾讯按名称或代码搜索沪深京证券，返回名称、带市场前缀的代码、类型与市场。名称对应多只证券时，请让用户确认。", inputSchema: objectSchema({ keyword: { type: "string", minLength: 1, maxLength: 40 }, limit: { type: "integer", minimum: 1, maximum: 20, default: 10 } }, ["keyword"]), annotations: annotation },
  { name: "akshare_stock_quotes", title: "查询行情快照", description: "查询沪深京证券、ETF 或指数的最新可用行情。单次最多 20 个代码；指数请带市场前缀，如 sh000001。数据可能延迟，以返回的行情时间和单位为准。", inputSchema: objectSchema({ symbols: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 } }, ["symbols"]), annotations: annotation },
  { name: "akshare_stock_history", title: "查询历史日线", description: "按证券代码、日期范围和复权方式查询历史日线。支持沪深证券、ETF 和部分指数，北交所是否可用取决于数据源。单次最多六个自然年，支持分页；请保留返回的原始单位说明。", inputSchema: objectSchema({ symbol: { type: "string" }, start_date: { type: "string", format: "date" }, end_date: { type: "string", format: "date" }, adjust: { type: "string", enum: ["none", "qfq", "hfq"], default: "none" }, limit: { type: "integer", minimum: 1, maximum: 500, default: 200 }, offset: { type: "integer", minimum: 0, default: 0 } }, ["symbol", "start_date", "end_date"]), annotations: annotation },
  { name: "akshare_market_indices", title: "查询主要指数", description: "查询上证指数、深证成指、创业板指、沪深 300 与中证 500 的最新可用快照。显示数据源时间，适合查看市场整体变化。", inputSchema: objectSchema({}), annotations: annotation },
];
export async function callTool(name: string, input: unknown): Promise<Row> {
  if(typeof name!=="string")throw new Error("请填写有效的工具名称。");
  if(name==="finance_exchange_rates"||name==="finance_macro_indicator"){const extras=await import("./extras");return name==="finance_exchange_rates"?extras.exchangeRates(input):extras.macroIndicator(input);}
  if(name.startsWith("finance_")){const multi=await import("./multi");if(name==="finance_sources_status"){z.object({}).strict().parse(input??{});const connected=await multi.backendConfigured();const extras=await import("./extras");return {providers:multi.PROVIDERS.map(p=>({...p,state:multi.providerState(p.id,connected),live_verified:false})),extra_sources:extras.EXTRA_SOURCES.map(p=>({...p,state:"http_adapter",requires_vendor_key:false,live_verified:false})),python_backend_configured:connected,default_history_providers:[...multi.DEFAULT_PROVIDERS],removed_sources:["eastmoney"],note:"默认不复权查询腾讯与新浪；复权只查询腾讯。AKShare 适配使用腾讯，efinance 原日线路径已停用，BaoStock 未配置云后端时不进入默认查询。HTTP 适配不是运行完整 Python 原库。"};}if(name==="finance_multi_source_history"||name==="finance_compare_history")return multi.multiHistory(input,name==="finance_compare_history");}
  if (name === "akshare_service_status") {
    z.object({}).strict().parse(input ?? {});
    return { service: "Financial Data", version: SERVICE_VERSION, description: DESCRIPTION, mode: "worker-adapter", full_akshare_runtime: false, tools: TOOLS.map(t=>({name:t.name,title:t.title})), upstream_sources: ["腾讯财经", "新浪财经", "世界银行", "Frankfurter / 欧洲央行 ECB"], read_only: true, mcp_connection: { site_endpoint: siteOrigin(env)+"/mcp", site_authentication: "Sites 平台 OAuth", manual_endpoint: siteOrigin(env)+"/api/mcp", manual_authentication: "oauth", manual_oauth_client: "automatic", manual_oauth_methods: ["client_id_metadata_document", "dynamic_registration"], manual_client_secret_required: false, manual_requires_public_site: true, anonymous_queries_allowed: false, scope: "finance.read", connection_page: siteOrigin(env)+"/#connect", note: "外部连接支持 Claude 与 ChatGPT 的官方身份或自动注册，无需手填客户端 ID 或密钥。必须先登录本站所有者的 ChatGPT 账号并确认只读授权。站点若仍为私有，外部发现会被平台拦截；实际可用性请查看连接页面检查结果。" } };
  }
  if (name === "akshare_stock_quotes") return quotes(z.object({symbols:z.array(z.string()).min(1).max(20)}).strict().parse(input).symbols);
  if (name === "akshare_stock_history") return history(input);
  if (name === "akshare_search_securities") { const args = z.object({keyword:z.string().trim().min(1).max(40),limit:z.number().int().min(1).max(20).default(10)}).strict().parse(input); return searchStocks(args.keyword,args.limit); }
  if (name === "akshare_market_indices") { z.object({}).strict().parse(input ?? {}); return quotes(["sh000001","sz399001","sz399006","sh000300","sh000905"]); }
  throw new Error("工具不存在，请重新获取工具列表。");
}
