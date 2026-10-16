import { z } from "zod";

export const EXTRA_SOURCES = [
  { id: "worldbank", name: "世界银行", focus: "GDP、增长、物价与人口等年度指标", source: "World Development Indicators", url: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation" },
  { id: "frankfurter", name: "Frankfurter", focus: "最新或指定日期的参考汇率", source: "本站固定使用欧洲央行 ECB 来源", url: "https://frankfurter.dev/" },
] as const;

export const INDICATORS = {
  "NY.GDP.MKTP.CD": { name: "GDP（现价美元）", unit: "USD" },
  "NY.GDP.MKTP.KD.ZG": { name: "GDP 年增长率", unit: "%" },
  "NY.GDP.PCAP.CD": { name: "人均 GDP（现价美元）", unit: "USD / 人" },
  "FP.CPI.TOTL.ZG": { name: "消费物价年增长率", unit: "%" },
  "SL.UEM.TOTL.ZS": { name: "失业率（ILO 模型估计）", unit: "% / 劳动力" },
  "SP.POP.TOTL": { name: "总人口", unit: "人" },
} as const;
const indicatorCodes = Object.keys(INDICATORS) as [keyof typeof INDICATORS, ...(keyof typeof INDICATORS)[]];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "日期必须有效");
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "请填写三位货币代码，如 CNY");
export const fxSchema = z.object({ base: currency.default("USD"), quotes: z.array(currency).min(1).max(10).default(["CNY", "EUR"]), date: isoDate.optional() }).strict();
export const macroSchema = z.object({ country: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/, "请填写国家代码，如 CHN 或 USA"), indicator: z.enum(indicatorCodes), start_year: z.number().int().min(1960).max(2100), end_year: z.number().int().min(1960).max(2100) }).strict();
const cache = new Map<string, { expires: number; fetched_at: string; body: any }>();

async function read(url: URL) {
  const previous = cache.get(url.href);
  if (previous && previous.expires > Date.now()) return { ...previous, cache_hit: true };
  const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(12000) });
  if([400,404,422].includes(response.status))throw new Error(`数据源不支持当前查询参数或找不到数据（HTTP ${response.status}），请检查币种、国家和日期。`);
  if(response.status===429)throw new Error("数据源暂时限流，请稍后重试。");
  if (!response.ok) throw new Error(`数据源暂不可用（HTTP ${response.status}），请稍后重试。`);
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("数据源响应过大，请缩小查询范围。");
  let body: any;
  try { body = JSON.parse(text); } catch { throw new Error("数据源未返回有效 JSON，请稍后重试。"); }
  const entry = { expires: Date.now() + 600_000, fetched_at: new Date().toISOString(), body };
  if (cache.size >= 60) cache.delete(cache.keys().next().value!);
  cache.set(url.href, entry);
  return { ...entry, cache_hit: false };
}

export async function exchangeRates(input: unknown) {
  const args = fxSchema.parse(input);
  const targets = [...new Set(args.quotes)].filter(quote => quote !== args.base);
  if (!targets.length) throw new Error("请选择与基准货币不同的目标货币。");
  const url = new URL("https://api.frankfurter.dev/v2/rates");
  url.searchParams.set("base", args.base);
  url.searchParams.set("quotes", targets.join(","));
  url.searchParams.set("providers", "ecb");
  if (args.date) url.searchParams.set("date", args.date);
  const result = await read(url);
  if (!Array.isArray(result.body)) throw new Error("汇率数据源没有返回可用数据，请检查币种和日期。");
  const data = result.body.filter((row: any) => row.base?.toUpperCase() === args.base && targets.includes(row.quote?.toUpperCase()) && typeof row.rate === "number" && Number.isFinite(row.rate) && row.rate > 0 && isoDate.safeParse(row.date).success).map((row: any) => ({ date: row.date, base: args.base, quote: row.quote.toUpperCase(), rate: row.rate }));
  if (!data.length) throw new Error("未找到指定币种与日期的 ECB 参考汇率。");
  return { source: "Frankfurter", underlying_source: "欧洲央行 ECB", source_url: "https://frankfurter.dev/", base: args.base, requested_date: args.date ?? "latest", fetched_at: result.fetched_at, cache_hit: result.cache_hit, row_count: data.length, missing_quotes: targets.filter(quote => !data.some((row: any) => row.quote === quote)), data, unit: "1 单位 base 可兑换 rate 单位 quote", note: "日度参考汇率，非实时成交价或银行买卖价。以每条返回的实际日期为准；非发布日可能返回此前可用日期。本站固定使用 ECB，不混合多家来源。" };
}

export async function macroIndicator(input: unknown) {
  const args = macroSchema.parse(input);
  if(args.country==="ALL")throw new Error("单次仅查询一个国家或地区，不支持 ALL。");
  if (args.start_year > args.end_year) throw new Error("开始年份不能晚于结束年份。");
  if (args.end_year - args.start_year > 80) throw new Error("单次查询最多 81 个年度。");
  const currentYear=Number(new Intl.DateTimeFormat("en",{timeZone:"Asia/Taipei",year:"numeric"}).format(new Date()));
  if (args.end_year > currentYear) throw new Error("年度统计不提供未来预测，请选择当前或更早的年份。");
  const url = new URL(`https://api.worldbank.org/v2/country/${args.country}/indicator/${args.indicator}`);
  for (const [key, value] of Object.entries({ format: "json", source: "2", date: `${args.start_year}:${args.end_year}`, per_page: "100", footnote: "y" })) url.searchParams.set(key, value);
  const result = await read(url);
  if (!Array.isArray(result.body) || (!Array.isArray(result.body[1]) && !(result.body[1]===null&&Number(result.body[0]?.total)===0))) throw new Error("世界银行没有返回该国家与指标的数据，请检查国家代码。");
  const metadata=result.body[0], values=result.body[1]??[];
  const data = values.filter((row: any) => row.indicator?.id === args.indicator && /^\d{4}$/.test(String(row.date))).map((row: any) => ({ year: Number(row.date), country: row.country?.value, country_code: row.countryiso3code, value: typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null, observation_status: row.obs_status || null, footnote: row.footnote || null })).sort((a: any, b: any) => a.year - b.year);
  return { source: "世界银行 WDI", source_id: 2, source_url: "https://data.worldbank.org/indicator/" + args.indicator, indicator: args.indicator, ...INDICATORS[args.indicator], country: args.country, frequency: "annual", fetched_at: result.fetched_at, source_last_updated: metadata.lastupdated ?? null, cache_hit: result.cache_hit, row_count: data.length, available_rows: data.filter((row: any) => row.value !== null).length, data, note: "年度统计可能滞后并被修订。缺失值保持 null，不补零、不插值；同名指标仍需核对统计口径。" };
}
