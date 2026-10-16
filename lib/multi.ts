import { z } from "zod";
import { normalizeSymbol, history as tencentHistory } from "./market";

export const PROVIDERS = [
  {id:"akshare",name:"AKShare",focus:"本站适配腾讯历史日线",source:"腾讯；stock_zh_a_hist_tx 接口适配",runtime:"HTTP 接口适配；完整原库需 Python",url:"https://github.com/akfamily/akshare"},
  {id:"efinance",name:"efinance",focus:"原日线路径已停用",source:"该日线路径依赖已移除的数据源",runtime:"日线已停用，不参与默认查询",url:"https://github.com/Micro-sheep/efinance"},
  {id:"ashare",name:"Ashare",focus:"兼容原提供者名称的日线适配",source:"明确选择新浪不复权或腾讯前复权，不自动混用",runtime:"项目自有 HTTP/Python 适配，不包含上游 Ashare 源码",url:"https://github.com/mpquant/Ashare"},
  {id:"baostock",name:"BaoStock",focus:"历史行情、复权因子与财务指标",source:"BaoStock 数据服务",runtime:"等待接入 Python 云后端",url:"https://pypi.org/project/baostock/"},
  {id:"tencent",name:"腾讯财经",focus:"直接查询行情与历史日线",source:"腾讯；不重复计入同源的库接口",runtime:"直接 HTTP 接口",url:"https://gu.qq.com/"},
  {id:"sina",name:"新浪财经",focus:"近期不复权日线",source:"新浪；与 Ashare 新浪适配共源",runtime:"直接 HTTP 接口",url:"https://finance.sina.com.cn/"},
] as const;
export const DEFAULT_PROVIDERS = ["tencent","sina"] as const;
export function providerState(id:string,python:boolean){return id==="efinance"?"disabled":id==="baostock"&&!python?"not_connected":python&&["akshare","ashare","baostock"].includes(id)?"python_backend_configured":"http_adapter";}
type Row = Record<string,any>;
type Provider = "akshare" | "efinance" | "ashare" | "baostock" | "tencent" | "sina" | "eastmoney";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;},"日期无效");
export const querySchema = z.object({symbol:z.string(),start_date:date,end_date:date,adjust:z.enum(["none","qfq","hfq"]).default("none"),providers:z.array(z.enum(["akshare","efinance","ashare","baostock","tencent","sina","eastmoney"])).min(1).max(7).optional(),limit:z.number().int().min(1).max(500).default(100),offset:z.number().int().min(0).max(10000).default(0)}).strict();
const cache = new Map<string,{expires:number;body:any}>();
type RequestScope = Map<string,Promise<any>>;
async function readJson(url:URL,pending:RequestScope) {
  const hit=cache.get(url.href);if(hit&&hit.expires>Date.now())return hit.body;
  const existing=pending.get(url.href);if(existing)return existing;
  const job=(async()=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:"manual",headers:{Accept:"application/json"}});if(!r.ok)throw new Error(`数据源暂时不可用（HTTP ${r.status}），请稍后重试。`);const text=await r.text();if(text.length>3000000)throw new Error("上游响应过大，请缩小区间。");let body;try{body=JSON.parse(text);}catch{throw new Error("上游没有返回有效行情数据，请稍后重试。");}if(cache.size>60)cache.clear();cache.set(url.href,{expires:Date.now()+120000,body});return body;})();
  pending.set(url.href,job);try{return await job;}finally{pending.delete(url.href);}
}
function n(v:unknown):number|null {if(v==null||v===""||v==="-")return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function rows(r:any[],mapping:Record<string,number|string>):Row[]{return r.map(item=>{const row:Row={};for(const [key,index] of Object.entries(mapping))row[key]=key==="date"?String(item[index]):n(item[index]);return row;});}
async function environment() {
  try {const {env}=await import("cloudflare:workers");return env as Record<string,string|undefined>;}catch {return {} as Record<string,string|undefined>;}
}
export async function backendConfigured(){const env=await environment();return Boolean(env.FINANCE_BACKEND_URL&&env.FINANCE_BACKEND_TOKEN);}
async function backendHistory(provider:Provider,args:Row):Promise<Row|null>{
  const env=await environment();if(!env.FINANCE_BACKEND_URL||!env.FINANCE_BACKEND_TOKEN)return null;
  const url=new URL("/history",env.FINANCE_BACKEND_URL);if(url.protocol!=="https:")throw new Error("后端必须使用 HTTPS。");
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${env.FINANCE_BACKEND_TOKEN}`},body:JSON.stringify({provider,symbol:args.symbol,start_date:args.start_date,end_date:args.end_date,adjust:args.adjust}),signal:AbortSignal.timeout(25000),redirect:"manual"});
  if(!response.ok)throw new Error("Python 后端查询失败，请检查云后端状态。");
  const body=await response.json() as Row;
  if(!Array.isArray(body.data)||body.provider!==provider||body.adjust!==args.adjust||body.symbol!==args.symbol||body.currency!=="CNY"||body.frequency!=="daily"||!["sina","tencent","baostock"].includes(body.underlying_source))throw new Error("后端返回的数据口径不匹配或使用已移除的数据源，未用于核对。");
  return {...body,runtime:provider==="ashare"?"python-adapter":"python-sdk"};
}
async function providerHistory(provider:Provider,args:Row,scope:RequestScope):Promise<Row>{
  if(provider==="eastmoney"||provider==="efinance")throw new Error("该数据源路径已停用，不再发起请求。");
  const remote=["akshare","ashare","baostock"].includes(provider)?await backendHistory(provider,args):null;if(remote)return remote;
  if(provider==="baostock")throw new Error("BaoStock 尚未接通：请配置能运行 Python 的云后端。");
  if(provider==="tencent"||provider==="akshare"){const result=await tencentHistory({symbol:args.symbol,start_date:args.start_date,end_date:args.end_date,adjust:args.adjust,limit:500,offset:0},true);return {provider,runtime:provider==="akshare"?"http-adapter":"direct-http",underlying_source:"tencent",upstream_interface:provider==="akshare"?"stock_zh_a_hist_tx 日线适配":"腾讯日线 HTTP",symbol:args.symbol,adjust:args.adjust,currency:"CNY",frequency:"daily",data:result.data};}
  const symbol=normalizeSymbol(args.symbol);
  if(args.adjust!=="none")throw new Error("新浪日线适配只支持不复权。本次未混用腾讯前复权备用数据。");
  const span=Math.ceil((Date.now()-new Date(args.start_date).getTime())/86400000)+30;
  if(span>1023)throw new Error("Ashare 新浪适配仅查询近期日线，请缩短日期范围或接入 Python 云后端。");
  const url=new URL("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData");
  for(const [key,value] of Object.entries({symbol,scale:"240",ma:"5",datalen:String(Math.min(1023,Math.max(20,span)))}))url.searchParams.set(key,value);
  const body=await readJson(url,scope);if(!Array.isArray(body))throw new Error("新浪未返回日线，请稍后重试。");
  return {provider,runtime:provider==="sina"?"direct-http":"http-adapter",underlying_source:"sina",upstream_interface:provider==="sina"?"新浪日线 HTTP":"Ashare get_price_sina 日线适配",symbol:args.symbol,adjust:"none",currency:"CNY",frequency:"daily",data:rows(body,{date:"day",open:"open",close:"close",high:"high",low:"low",volume_raw:"volume"})};
}

export function normalizeDailyRows(input:Row[],start:string,end:string) {
  const byDate=new Map<string,Row>();
  const conflicts=new Set<string>();
  let invalidRows=0,duplicateRows=0;
  for(const row of input){
    if(!date.safeParse(row.date).success){invalidRows++;continue;}
    if(row.date<start||row.date>end)continue;
    const values=[row.open,row.high,row.low,row.close];
    if(!values.every(v=>typeof v==="number"&&Number.isFinite(v)&&v>0)||row.low>Math.min(row.open,row.close)+0.01||row.high<Math.max(row.open,row.close)-0.01||row.low>row.high){invalidRows++;continue;}
    const previous=byDate.get(row.date);
    if(previous){duplicateRows++;if(["open","high","low","close"].some(field=>previous[field]!==row[field]))conflicts.add(row.date);}
    else byDate.set(row.date,row);
  }
  for(const key of conflicts)byDate.delete(key);
  return {data:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)),data_quality:{invalid_rows:invalidRows,duplicate_rows:duplicateRows,conflicting_dates:conflicts.size,note:"无效价格与冲突交易日不参与核对；缺失值不补造。"}};
}

export function compareSources(sources:Row[],tolerance=0.01):Row {
  const available=sources.filter(s=>s.status==="ok");const pairs:Row[]=[];
  for(let i=0;i<available.length;i++)for(let j=i+1;j<available.length;j++){
    const a=available[i],b=available[j];
    if(a.adjust!==b.adjust||a.currency!==b.currency||a.frequency!==b.frequency||a.symbol!==b.symbol){pairs.push({providers:[a.provider,b.provider],status:"not_comparable",reason:"日期之外的数据口径不一致"});continue;}
    const same=a.underlying_source===b.underlying_source;
    const lookup=new Map<string,Row>(b.data.map((r:Row)=>[r.date,r]));let common=0,overlap=0,mismatch=0;const details:Row[]=[];
    for(const left of a.data){const right=lookup.get(left.date);if(!right)continue;overlap++;const fields=["open","high","low","close"];if(!fields.every(field=>typeof left[field]==="number"&&Number.isFinite(left[field])&&typeof right[field]==="number"&&Number.isFinite(right[field])))continue;common++;let bad=false;for(const field of fields){const delta=Math.abs(left[field]-right[field]);if(delta>tolerance+1e-9){bad=true;if(details.length<30)details.push({date:left.date,field,values:[left[field],right[field]],absolute_difference:Number(delta.toFixed(8))});}}if(bad)mismatch++;}
    pairs.push({providers:[a.provider,b.provider],underlying_sources:[a.underlying_source,b.underlying_source],independent:!same,status:!overlap?"no_overlap":!common?"insufficient_data":same?"same_source":mismatch?"differences":"within_tolerance",common_days:common,different_days:mismatch,coverage:{overlap_dates:overlap,left_only_days:a.data.length-overlap,right_only_days:b.data.length-overlap,incomplete_days:overlap-common},details});
  }
  const independentPairs=new Set(pairs.filter(p=>p.independent&&p.common_days>0).map(p=>[...p.underlying_sources].sort().join("|")));
  return {tolerance_cny:tolerance,compared_fields:["open","high","low","close"],independent_pairs:independentPairs.size,pairs,note:"只核对四个价格字段都完整的交易日。共源结果不计为独立验证；同一对底层来源只计一次。差异只作提示，不投票选出真值；成交量和成交额未用于比较。"};
}

export async function multiHistory(input:unknown,compare=false):Promise<Row>{
  const args=querySchema.parse(input);args.symbol=normalizeSymbol(args.symbol);
  if(!/^(sh(?:600|601|603|605|688|689)|sz(?:000|001|002|003|300|301))\d{3}$/.test(args.symbol))throw new Error("首版多源日线核对仅支持沪深 A 股。指数与 ETF 请使用单源行情工具。");
  if(args.start_date>args.end_date)throw new Error("开始日期不能晚于结束日期。");
  if(new Date(args.end_date).getTime()-new Date(args.start_date).getTime()>6*366*86400000)throw new Error("单次查询最多六年，请分段查询。");
  const selected=[...new Set(args.providers??(args.adjust==="none"?[...DEFAULT_PROVIDERS]:["tencent" as const]))],scope:RequestScope=new Map();
  const completeSources:Row[]=await Promise.all(selected.map(async provider=>{try{const result=await providerHistory(provider,args,scope);const cleaned=normalizeDailyRows(result.data,args.start_date,args.end_date);return {...result,...cleaned,status:cleaned.data.length?"ok":cleaned.data_quality.invalid_rows||cleaned.data_quality.conflicting_dates?"invalid_data":"empty",total_rows:cleaned.data.length,units:{prices:"CNY",volume_raw:"来源原始口径，未用于核对",amount_raw:"来源原始口径，未用于核对"}};}catch(e){const python=await backendConfigured();return {provider,status:provider==="eastmoney"?"removed":provider==="efinance"?"disabled":provider==="baostock"&&!python?"not_connected":(provider==="sina"||provider==="ashare"&&!python)&&args.adjust!=="none"?"unsupported_adjustment":"unavailable",error:e instanceof Error?/fetch|abort|timeout/i.test(e.message)?"上游连接超时或暂不可用。":e.message:"查询失败",data:[]};}}));
  const sources=completeSources.map(source=>{const data=source.data.slice(args.offset,args.offset+args.limit);return {...source,data,offset:args.offset,next_offset:args.offset+data.length<source.data.length?args.offset+data.length:null};});
  const comparison=compare?compareSources(completeSources):null;
  return {symbol:args.symbol,start_date:args.start_date,end_date:args.end_date,adjust:args.adjust,frequency:"daily",retrieved_at:new Date().toISOString(),successful_sources:completeSources.filter(s=>s.status==="ok").length,successful_underlying_sources:new Set(completeSources.filter(s=>s.status==="ok").map(s=>s.underlying_source)).size,sources,...(comparison?{comparison:{...comparison,scope:"full_requested_range",note:"核对覆盖各来源实际返回的完整日期区间；下方明细可以分页。"+comparison.note}}:{})};
}
