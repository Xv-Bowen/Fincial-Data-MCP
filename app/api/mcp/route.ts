import { env } from "cloudflare:workers";
import { handleClientMcp } from "../../../lib/mcp-client";
import { handleMcp } from "../../../lib/mcp-handler";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleClientMcp(env, request, handleMcp);
export const GET = (request: Request) => handleClientMcp(env, request, handleMcp);
export const DELETE = GET;
