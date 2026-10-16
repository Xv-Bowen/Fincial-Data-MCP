import { siteOrigin } from "@/lib/site-config";
import { env } from "cloudflare:workers";
import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import { isOwnerIdentity } from "../lib/owner-access";
import { OAuthConnection } from "./oauth-connection";
import { ArrowUpRight, Check, Layers, Search, History, GitCompareArrows } from "lucide-react";
import { TOOLS } from "@/lib/market";
import { PROVIDERS, backendConfigured, providerState } from "@/lib/multi";
import { EXTRA_SOURCES } from "@/lib/extras";
import { Copy, QueryPanel, ExtraQueryPanels, ExampleQuestions } from "./components";
export const dynamic="force-dynamic";
export default async function Page(){
 const user = await getChatGPTUser();
 const owner = isOwnerIdentity(env, user?.userId, user?.email);
 const ORIGIN=siteOrigin(env);
 const endpoint=ORIGIN+"/mcp",manualEndpoint=ORIGIN+"/api/mcp",python=await backendConfigured();
 const enabled=PROVIDERS.filter(p=>providerState(p.id,python)!=="disabled"&&providerState(p.id,python)!=="not_connected");
 const deferred=PROVIDERS.filter(p=>providerState(p.id,python)==="disabled"||providerState(p.id,python)==="not_connected");
 const parts=new Intl.DateTimeFormat("en",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const part=(name:string)=>parts.find(p=>p.type===name)!.value;
 const today=`${part("year")}-${part("month")}-${part("day")}`;
 return <main><nav><a href="/" className="brand"><span className="brand-mark"><Layers size={19}/></span>Financial Data</a><span className="private"><i/>所有者授权 · 只读</span></nav>
 <header className="hero"><div><p className="eyebrow">市场数据，一个入口</p><h1>把市场数据<br/>接入你的 AI<span>。</span></h1><p className="lead">行情、历史走势、汇率与宏观。<br/>让每个数字，都带着它的来源。</p><div className="hero-tags"><span><Check size={14}/>云端运行</span><span><Check size={14}/>只读查询</span><span><Check size={14}/>差异可核对</span></div></div><div className="connect-card"><p className="card-kicker">Claude / ChatGPT · 自动 OAuth</p><h2>复制地址，登录授权。</h2><p className="sub">客户端自动发现认证方式，无需手填客户端 ID、密钥或访问令牌。外部入口是否可用，以登录后的连接检查为准。</p><div className="endpoint"><code>{manualEndpoint}</code><Copy value={manualEndpoint}/></div><div className="transport"><span>身份验证</span><b>OAuth · 自动注册</b></div><div className="transport"><span>授权范围</span><b>公开金融数据 · 只读</b></div><a href="#connect" className="primary-link">查看连接状态与步骤 <ArrowUpRight size={18}/></a></div></header>
 <div className="scope-note"><span className="pill">实际接入范围</span><p>{python?"已配置 Python 后端；具体接口可用性以实际查询结果为准。":"当前为公共 HTTP 接口适配，默认使用腾讯与新浪。完整 Python 原库未运行；待接与停用路径在下方单独显示。"}</p></div>
 <section className="providers"><div className="section-heading"><p className="eyebrow">各有所长，互相补充</p><h2>接口从哪来，一眼看清。</h2><p className="sub">默认只查询已配置的直接接口。库名对应适配方式；共用底层来源的结果不重复计数。</p></div><div className="provider-grid">{enabled.map((p,i)=><article key={p.id}><div className="provider-top"><span className="source-number">0{i+1}</span><a href={p.url} aria-label={`${p.name} 项目文档`}><ArrowUpRight size={17}/></a></div><h3>{p.name}</h3><p>{p.focus}</p><div className="source-line">{p.source}</div><span className={p.id==="baostock"&&!python?"provider-status pending":"provider-status"}>{python&&["akshare","ashare","baostock"].includes(p.id)?"Python 后端已配置":p.id==="baostock"?"等待云后端":["tencent","sina"].includes(p.id)?"直接接口已配置":"日线适配已配置"}</span></article>)}</div></section>
 <section className="principles"><article><Search size={20}/><h3>先选合适的来源</h3><p>查询会返回实际数据源、时间和复权方式，失败也会显示。</p></article><article><History size={20}/><h3>先对齐，再比较</h3><p>同一证券、交易日、币种和复权方式，才能进入价格核对。</p></article><article><GitCompareArrows size={20}/><h3>共源不重复计数</h3><p>AKShare 适配与腾讯共源，Ashare 适配与新浪共源，不增加独立验证次数。</p></article></section>
 {owner ? <QueryPanel today={today} python={python}/> : <section className="query"><h2>登录后查询市场数据。</h2><p className="sub">查询与外部客户端授权仅供站点所有者使用。</p><a className="primary" href={chatGPTSignInPath("/#connect")} target="_top">使用 ChatGPT 账号登录</a></section>}
 {deferred.length>0&&<details className="deferred-sources"><summary>查看待接与停用路径（不参与默认查询）</summary><div className="provider-grid">{deferred.map(p=><article key={p.id}><h3>{p.name}</h3><p>{p.id==="efinance"?"当前日线路径依赖已移除的数据源，已停用。":"需要部署并连接 Python 云后端，当前未接通。"}</p><span className="provider-status pending">{p.id==="efinance"?"日线路径已停用":"等待云后端"}</span></article>)}</div></details>}
 <section className="supplement-sources"><div className="provider-grid">{EXTRA_SOURCES.map(p=><article key={p.id}><div className="provider-top"><span className="source-number">补充来源</span><a href={p.url} aria-label={`${p.name} API 文档`}><ArrowUpRight size={17}/></a></div><h3>{p.name}</h3><p>{p.focus}</p><div className="source-line">{p.source}</div><span className="provider-status">无需个人 API Key</span></article>)}</div></section>
 {owner && <ExtraQueryPanels year={Number(part("year"))}/> }
 <ExampleQuestions/>
 <section id="connect" className="connection"><div><p className="eyebrow">连接一次，自动续期</p><h2>同一个地址，<br/>连接两个 AI。</h2><p className="sub">Claude 与手动添加的 ChatGPT 使用同一条 OAuth 连接。登录本站所有者的 ChatGPT 账号，确认只读授权后会自动返回客户端。</p>{owner ? <OAuthConnection/> : <p className="small">登录后可以检查入口可用性、查看有效授权数量并撤销连接。</p>}</div><div className="steps"><article><span>01</span><div><h3>添加到 Claude</h3><p>在「设置 → 连接器」添加自定义连接器，粘贴下方 MCP 地址。身份验证选择 OAuth，OAuth 客户端选择「自动注册（Register automatically）」，客户端 ID 和密钥留空。</p><div className="endpoint"><code>{manualEndpoint}</code><Copy value={manualEndpoint}/></div></div></article><article><span>02</span><div><h3>添加到 ChatGPT</h3><p>在自定义 MCP 连接中粘贴同一地址，选择 OAuth 自动连接。支持官方客户端身份和自动注册；随后登录并允许只读查询，令牌由客户端保存和续期。</p><p className="small">服务不支持「无验证」查询。若仍提示入口不可达，请先查看左侧连接检查。</p></div></article><article><span>03</span><div><h3>保留现有 ChatGPT 内置连接</h3><p>已经安装的「Financial Data」可以继续使用，无需删除或重新创建。它由 Sites 管理，并使用下方专用地址：</p><div className="endpoint"><code>{endpoint}</code><Copy value={endpoint}/></div></div></article><article><span>04</span><div><h3>需要时，一键撤销</h3><p>外部连接的访问令牌每小时续期；持续使用时，本次授权最长有效 90 天。可以随时撤销外部连接。撤销、过期或更换所有者后，必须重新登录授权。</p></div></article></div></section>
 <section className="tool-list"><div className="section-heading"><p className="eyebrow">本站可调用工具</p><h2>每个操作，范围明确。</h2></div>{TOOLS.map((t,i)=><div className="tool-row" key={t.name}><span>0{i+1}</span><div><h3>{t.title}</h3><p>{t.description}</p></div><code>{t.name}</code></div>)}</section>
 <footer><span className="brand"><span className="brand-mark"><Layers size={15}/></span>Financial Data</span><p>只读查询 · 保留来源 · 明确差异</p><a href="https://github.com/akfamily/akshare">查看 AKShare 项目 <ArrowUpRight size={13}/></a></footer></main>;
}
