import { env } from "cloudflare:workers";
import { requireOwner, accessFailure } from "../../../lib/owner-access";
import { callTool } from "@/lib/market";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { requireOwner(env, request); } catch (error) { return accessFailure(error); }
 return Response.json(await callTool("akshare_service_status",{}),{headers:{"Cache-Control":"no-store"}}); }
