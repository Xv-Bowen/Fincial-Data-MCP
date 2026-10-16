import { oauthAccess, oauthChallenge, type OAuthContext } from "./mcp-oauth";
import { AccessError, accessFailure } from "./owner-access";
import { siteOrigin } from "./site-config";

export async function handleClientMcp(env: OAuthContext, request: Request, processor: (request: Request, external?: boolean) => Promise<Response>): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && ![siteOrigin(env), "https://chatgpt.com", "https://claude.ai"].includes(origin)) {
    return Response.json({ error: "invalid_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const authorization = request.headers.get("authorization");
  if (!authorization) return oauthChallenge(env);
  try { await oauthAccess(env, authorization); }
  catch (error) { return error instanceof AccessError && error.status === 401 ? oauthChallenge(env, true) : accessFailure(error); }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  // The processor performs no identity lookup. An external caller reaches it
  // only after token validation; browser or caller-supplied identity is ignored.
  return processor(request, true);
}
