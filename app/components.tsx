"use client";
import { useEffect, useRef, useState } from "react";

type Result = Record<string, any>;
const names: Record<string, string> = {akshare:"AKShare（腾讯适配）",efinance:"efinance",ashare:"Ashare（新浪适配）",baostock:"BaoStock",tencent:"腾讯财经",sina:"新浪财经"};
const statuses: Record<string, string> = {ok:"已返回",removed:"已移除",disabled:"已停用",unsupported_adjustment:"不支持此复权方式",empty:"区间无数据",unavailable:"暂不可用",not_connected:"未接通",invalid_data:"数据不完整",same_source:"同底层来源",within_tolerance:"价格差异 ≤ 0.01 元",differences:"存在价格差异",no_overlap:"日期无重叠",not_comparable:"口径不一致",insufficient_data:"价格字段不完整"};
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("zh-CN",{maximumFractionDigits:8}).format(value) : "—";
const sourceName = (value: string) => names[value] || value;
function beijingTime(value: string) { return new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}) + "（北京时间）"; }
function lastMonth(today: string) { const [year,month]=today.split("-").map(Number); return [new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,10),new Date(Date.UTC(year,month-1,0)).toISOString().slice(0,10)]; }

export function Copy({value,label="复制"}:{value:string;label?:string}) {
  const [feedback,setFeedback]=useState(label);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  async function copy(){try{await navigator.clipboard.writeText(value);setFeedback("已复制");}catch{setFeedback("长按文字复制");}if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setFeedback(label),3000);}
  return <button type="button" className="copy" onClick={()=>void copy()} aria-label={`${label}：${value}`}>{feedback}</button>;
}

async function query(name:string,args:Record<string,unknown>) {
  const response=await fetch("/api/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,arguments:args})});
  const body=await response.json() as Result;
  if(!response.ok)throw new Error(body.error||"查询失败，请稍后重试。");
  return body;
}

function RawData({result}:{result:Result}) {return <details><summary>查看完整返回数据</summary><pre>{JSON.stringify(result,null,2)}</pre></details>;}

function FlatResult({result}:{result:Result}) {
  const forex=Boolean(result.base),macro=Boolean(result.indicator);
  return <div className="result">
    <div className="result-meta"><b>{result.source}</b><span>{result.fetched_at?`抓取于 ${beijingTime(result.fetched_at)}`:result.retrieved_at?`返回于 ${beijingTime(result.retrieved_at)}`:""}</span>{result.cache_hit&&<span>使用 10 分钟内缓存</span>}</div>
    {macro&&<p className="small">{result.name} · {result.unit} · {result.available_rows} 个年度有值{result.source_last_updated?` · 数据集更新：${result.source_last_updated}`:""}</p>}
    {forex&&<p className="small">基准货币：{result.base} · 来源：{result.underlying_source} · 1 单位基准货币可兑换下表数值</p>}
    {result.data?.length>0?<div className="table-wrap"><table><thead><tr>{(forex?["实际日期","目标货币","参考汇率"]:macro?["统计年份","国家 / 地区","数值"]:["证券","最新值","涨跌幅","行情时间"]).map(title=><th key={title}>{title}</th>)}</tr></thead><tbody>{result.data.map((row:Result,index:number)=><tr key={index}>{forex?<><td>{row.date}</td><td>{row.quote}</td><td>{number(row.rate)}</td></>:macro?<><td>{row.year}</td><td>{row.country}</td><td>{row.value===null?"未发布 / 缺失":number(row.value)}</td></>:<><td>{row.name}<br/><small>{row.symbol}</small></td><td>{number(row.price)}</td><td>{row.change_percent===null?"—":`${number(row.change_percent)}%`}</td><td>{row.quote_time}</td></>}</tr>)}</tbody></table></div>:<p className="sub">该区间没有可显示的数据。</p>}
    {result.note&&<p className="small">{result.note}</p>}
    {result.missing_quotes?.length>0&&<p className="small">未返回的目标货币：{result.missing_quotes.join("、")}</p>}
    <RawData result={result}/>
  </div>;
}

export function QueryPanel({today,python}:{today:string;python:boolean}) {
  const range=lastMonth(today);
  const [symbol,setSymbol]=useState("600519"),[start,setStart]=useState(range[0]),[end,setEnd]=useState(range[1]),[adjust,setAdjust]=useState("none");
  const [providers,setProviders]=useState(["tencent","sina"]);
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState(""),[result,setResult]=useState<Result|null>(null);
  async function run(mode:"quote"|"compare",offset=0){
    setBusy(true);setFeedback("正在查询实际数据源…");
    try{
      const body=await query(mode==="quote"?"akshare_stock_quotes":"finance_compare_history",mode==="quote"?{symbols:[symbol]}:{symbol,start_date:start,end_date:end,adjust,providers,limit:100,offset});
      setResult(body);
      setFeedback(mode==="quote"?"行情已返回，以数据源的行情时间为准。":`${body.successful_sources} 个接口、${body.successful_underlying_sources} 种底层来源返回数据；可独立核对 ${body.comparison?.independent_pairs??0} 组。`);
    }catch(error){setResult(null);setFeedback(error instanceof Error?error.message:"请求失败，请稍后重试。");}finally{setBusy(false);}
  }
  function clear(){setResult(null);setFeedback("");}
  function toggle(provider:string){clear();setProviders(previous=>previous.includes(provider)?previous.filter(p=>p!==provider):[...previous,provider]);}
  const eligible=Object.entries(names).filter(([id])=>id!=="efinance"&&(id!=="baostock"||python)&&(adjust==="none"||id!=="sina"&&(id!=="ashare"||python&&adjust==="qfq")));
  const pairs=result?.comparison?.pairs??[];
  const seen=new Set<string>();
  const independent=pairs.filter((pair:Result)=>{if(!pair.independent)return false;const key=[...pair.underlying_sources].sort().join("|");if(seen.has(key))return false;seen.add(key);return true;});
  const offset=result?.sources?.[0]?.offset??0;
  const hasMore=result?.sources?.some((source:Result)=>source.next_offset!==null&&source.next_offset!==undefined);
  return <section className="query" id="query">
    <div className="section-heading"><p className="eyebrow">先查询，再核对</p><h2>同一只股票，看看不同来源怎么说。</h2><p className="sub">核对完整查询区间的开高低收。明细每页 100 条，同源、缺失和失败分别显示。</p></div>
    <form onSubmit={event=>{event.preventDefault();void run("compare");}}>
      <div className="fields">
        <label>证券代码<input value={symbol} onChange={event=>{clear();setSymbol(event.target.value);}} placeholder="600519" maxLength={8} required disabled={busy}/></label>
        <label>开始日期<input type="date" value={start} onChange={event=>{clear();setStart(event.target.value);}} required disabled={busy}/></label>
        <label>结束日期<input type="date" value={end} min={start} onChange={event=>{clear();setEnd(event.target.value);}} required disabled={busy}/></label>
        <label>复权方式<select value={adjust} onChange={event=>{clear();setAdjust(event.target.value);setProviders(event.target.value==="none"?["tencent","sina"]:["tencent"]);}} disabled={busy}><option value="none">不复权</option><option value="qfq">前复权</option><option value="hfq">后复权</option></select></label>
      </div>
      <fieldset className="source-choice" disabled={busy}><legend>选择日线查询接口</legend>{eligible.map(([id,name])=><label key={id}><input type="checkbox" checked={providers.includes(id)} onChange={()=>toggle(id)}/>{name}</label>)}</fieldset>
      <div className="query-actions"><button type="submit" className="primary" disabled={busy||providers.length===0}>{busy?"查询中…":"查询并核对 →"}</button><button type="button" className="secondary" disabled={busy} onClick={()=>void run("quote")}>只查行情快照</button></div>
      <p aria-live="polite" className="feedback">{feedback||"不复权默认腾讯与新浪；复权默认腾讯，仅提供单源数据。未接通与停用路径不加入默认查询。"}</p>
    </form>
    {result&&(result.sources?<div className="result">
      <div className="result-meta"><b>{result.symbol} · {result.start_date} 至 {result.end_date}</b><span>核对覆盖完整返回区间</span></div>
      <div className="table-wrap"><table><thead><tr><th>接口</th><th>实际状态</th><th>底层来源</th><th>本页 / 全区间条数</th></tr></thead><tbody>{result.sources.map((source:Result)=><tr key={source.provider}><td>{sourceName(source.provider)}</td><td><span className={source.status==="ok"?"state good":"state"}>{statuses[source.status]??source.status}</span>{source.error&&<p className="error-detail">{source.error}</p>}{source.data_quality&&(source.data_quality.invalid_rows+source.data_quality.conflicting_dates>0)&&<p className="error-detail">已排除 {source.data_quality.invalid_rows} 条无效记录、{source.data_quality.conflicting_dates} 个冲突交易日</p>}</td><td>{sourceName(source.underlying_source||"—")}</td><td>{source.data?.length??0} / {source.total_rows??0}</td></tr>)}</tbody></table></div>
      {result.comparison&&<div className="comparison"><h3>独立来源核对</h3>{independent.length?independent.map((pair:Result,index:number)=><article className="pair-result" key={index}><div className="pair"><b>{pair.underlying_sources.map(sourceName).join(" × ")}</b><span>{statuses[pair.status]??pair.status}</span><small>{pair.common_days??0} 个完整交易日 · {pair.different_days??0} 天存在差异</small></div>{pair.coverage&&(pair.coverage.left_only_days+pair.coverage.right_only_days>0)&&<p className="small">仅左侧返回 {pair.coverage.left_only_days} 天，仅右侧返回 {pair.coverage.right_only_days} 天；这些日期没有用于价格核对。</p>}{pair.details?.length>0&&<details><summary>查看差异明细（最多前 30 项）</summary><div className="table-wrap"><table><thead><tr><th>日期</th><th>字段</th><th>左侧</th><th>右侧</th><th>差值（元）</th></tr></thead><tbody>{pair.details.map((item:Result,i:number)=><tr key={i}><td>{item.date}</td><td>{{open:"开盘",high:"最高",low:"最低",close:"收盘"}[item.field as "open"]??item.field}</td><td>{number(item.values[0])}</td><td>{number(item.values[1])}</td><td>{number(item.absolute_difference)}</td></tr>)}</tbody></table></div></details>}</article>):<p className="sub">当前不足两种可独立核对的底层来源。同源接口不会增加验证次数。</p>}<p className="small">{result.comparison.note}</p></div>}
      {(offset>0||hasMore)&&<div className="query-actions pagination"><button type="button" className="secondary" disabled={busy||offset===0} onClick={()=>void run("compare",Math.max(0,offset-100))}>上一页明细</button><span>第 {Math.floor(offset/100)+1} 页</span><button type="button" className="secondary" disabled={busy||!hasMore} onClick={()=>void run("compare",offset+100)}>下一页明细</button></div>}
      <RawData result={result}/>
    </div>:<FlatResult result={result}/>)}
  </section>;
}

export function ExtraQueryPanels({year}:{year:number}) {
  const [base,setBase]=useState("USD"),[targets,setTargets]=useState("CNY,EUR"),[asof,setAsOf]=useState("");
  const [country,setCountry]=useState("CHN"),[indicator,setIndicator]=useState("NY.GDP.MKTP.KD.ZG"),[from,setFrom]=useState(year-5),[to,setTo]=useState(year-1);
  const [busy,setBusy]=useState<"fx"|"macro"|null>(null),[results,setResults]=useState<Record<string,Result|null>>({fx:null,macro:null}),[feedback,setFeedback]=useState<Record<string,string>>({fx:"",macro:""});
  function clearResult(mode:string){setResults(previous=>({...previous,[mode]:null}));setFeedback(previous=>({...previous,[mode]:""}));}
  async function run(mode:"fx"|"macro"){
    setBusy(mode);setFeedback(previous=>({...previous,[mode]:"正在查询实际数据源…"}));
    try{const body=await query(mode==="fx"?"finance_exchange_rates":"finance_macro_indicator",mode==="fx"?{base,quotes:targets.split(/[,，\s]+/).filter(Boolean),...(asof?{date:asof}:{})}:{country,indicator,start_year:from,end_year:to});setResults(previous=>({...previous,[mode]:body}));setFeedback(previous=>({...previous,[mode]:mode==="fx"?"已返回参考汇率，请查看实际日期。":`已返回 ${body.available_rows} 个年度数值，缺失年份保留为空。`}));}catch(error){setResults(previous=>({...previous,[mode]:null}));setFeedback(previous=>({...previous,[mode]:error instanceof Error?error.message:"查询失败。"}));}finally{setBusy(null);}
  }
  return <section className="extra-queries" id="extra-queries"><div className="section-heading"><p className="eyebrow">补齐市场的另一面</p><h2>汇率与宏观，也在同一个入口。</h2><p className="sub">两种额外的数据接口无需个人 API Key。参考汇率与年度统计各自保留日期和口径。</p></div><div className="extra-grid">
    <article className="query"><h3>查询参考汇率</h3><p className="sub">Frankfurter · 欧洲央行 ECB 来源</p><form onSubmit={event=>{event.preventDefault();void run("fx");}}><div className="fields extra-fields"><label>基准货币<input value={base} maxLength={3} onChange={event=>{clearResult("fx");setBase(event.target.value.toUpperCase());}} required disabled={busy!==null}/></label><label>目标货币<input value={targets} onChange={event=>{clearResult("fx");setTargets(event.target.value.toUpperCase());}} placeholder="CNY,EUR" required disabled={busy!==null}/></label><label className="wide">指定日期（留空为最新）<input type="date" value={asof} onChange={event=>{clearResult("fx");setAsOf(event.target.value);}} disabled={busy!==null}/></label></div><button className="primary" disabled={busy!==null}>{busy==="fx"?"查询中…":"查询汇率 →"}</button><p className="feedback" aria-live="polite">{feedback.fx||"日度参考汇率，非实时交易报价。"}</p></form>{results.fx&&<FlatResult result={results.fx}/>}</article>
    <article className="query"><h3>查询年度宏观指标</h3><p className="sub">世界银行 · World Development Indicators</p><form onSubmit={event=>{event.preventDefault();void run("macro");}}><div className="fields extra-fields"><label>国家代码<input value={country} maxLength={3} onChange={event=>{clearResult("macro");setCountry(event.target.value.toUpperCase());}} placeholder="CHN / USA" required disabled={busy!==null}/></label><label>指标<select value={indicator} onChange={event=>{clearResult("macro");setIndicator(event.target.value);}} disabled={busy!==null}><option value="NY.GDP.MKTP.KD.ZG">GDP 年增长率</option><option value="NY.GDP.MKTP.CD">GDP（现价美元）</option><option value="NY.GDP.PCAP.CD">人均 GDP（美元）</option><option value="FP.CPI.TOTL.ZG">消费物价年增长率</option><option value="SL.UEM.TOTL.ZS">失业率（ILO 模型）</option><option value="SP.POP.TOTL">总人口</option></select></label><label>开始年份<input type="number" min={1960} max={year} value={from} onChange={event=>{clearResult("macro");setFrom(Number(event.target.value));}} required disabled={busy!==null}/></label><label>结束年份<input type="number" min={from} max={year} value={to} onChange={event=>{clearResult("macro");setTo(Number(event.target.value));}} required disabled={busy!==null}/></label></div><button className="primary" disabled={busy!==null}>{busy==="macro"?"查询中…":"查询宏观指标 →"}</button><p className="feedback" aria-live="polite">{feedback.macro||"年度数据存在发布滞后，缺失值不会补成 0。"}</p></form>{results.macro&&<FlatResult result={results.macro}/>}</article>
  </div></section>;
}

export function ExampleQuestions() {
  const examples=[{tag:"行情核对",text:"查询贵州茅台上个月的日线，并核对不同数据来源的差异。"},{tag:"参考汇率",text:"查询美元对人民币和欧元的最新参考汇率，注明来源和实际日期。"},{tag:"年度宏观",text:"查询中国近五年的 GDP 年增长率，保留统计年份和缺失值。"}];
  return <section className="examples"><div className="section-heading"><p className="eyebrow">连接后，就从一句话开始</p><h2>带着问题，去查数据。</h2></div><div className="example-grid">{examples.map(example=><article key={example.tag}><span>{example.tag}</span><p>{example.text}</p><Copy label="复制提问" value={example.text}/></article>)}</div></section>;
}
