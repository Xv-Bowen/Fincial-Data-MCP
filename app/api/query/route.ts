import { env } from "cloudflare:workers";
import { requireOwner, accessFailure } from "../../../lib/owner-access";
import { callTool } from "@/lib/market";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { requireOwner(env, request); } catch (error) { return accessFailure(error); }

  const headers={"Cache-Control":"no-store"};
  if(!request.headers.get("content-type")?.includes("application/json"))return Response.json({error:"请使用 JSON 请求。"},{status:415,headers});
  try {
    const text=await request.text();if(text.length>64000)return Response.json({error:"请求过大。"},{status:413,headers});
    const body=z.object({name:z.string(),arguments:z.record(z.unknown()).optional()}).strict().parse(JSON.parse(text));
    return Response.json(await callTool(body.name,body.arguments??{}),{headers});
  }catch(error){
    if(error instanceof z.ZodError)return Response.json({error:"查询参数无效，请检查代码、日期范围或数值。",fields:error.issues.map(issue=>issue.path.join("."))},{status:400,headers});
    if(error instanceof SyntaxError)return Response.json({error:"请求内容不是有效 JSON。"},{status:400,headers});
    const raw=error instanceof Error?error.message:"查询失败。";
    const message=/fetch|abort|timeout|network/i.test(raw)?"数据源连接超时或暂不可用，请稍后重试。":raw;
    return Response.json({error:message},{status:502,headers});
  }
}
