import { env } from "cloudflare:workers";
import { handleMcp } from "../../lib/mcp-handler";
import { requireOwner, accessFailure } from "../../lib/owner-access";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  // Sites fetches public tool schemas during publication. No data queries are
  // allowed through this exception; the original platform transport is kept.
  try {
    const body = await request.clone().text();
    if (body.length > 64000) return new Response(null, { status: 413 });
    const message = JSON.parse(body);
    if (message?.jsonrpc === "2.0" && ["server/discover", "tools/list"].includes(message.method)) return handleMcp(request);
  } catch { /* Authenticated protocol parser returns the appropriate error. */ }
  try { requireOwner(env, request); } catch (error) { return accessFailure(error); }
  return handleMcp(request);
}
export function GET() { return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
export const DELETE = GET;
