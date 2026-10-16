export type OwnerContext = { FINANCE_OWNER_EMAIL?: string };

export class AccessError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

// These headers are supplied by Sites after authentication. Never accept
// identity from the JSON body, query string, or an external MCP request.
export function isOwnerIdentity(env: OwnerContext, userId?: string | null, email?: string | null): boolean {
  return !!userId && !!email && !!env.FINANCE_OWNER_EMAIL
    && email.trim().toLowerCase() === env.FINANCE_OWNER_EMAIL.trim().toLowerCase();
}
export function requireOwner(env: OwnerContext, request: Request): string {
  if (!env.FINANCE_OWNER_EMAIL) throw new AccessError("temporarily_unavailable", "所有者授权设置尚未完成。", 503);
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) throw new AccessError("authentication_required", "请先使用站点所有者的 ChatGPT 账号登录。", 401);
  if (!isOwnerIdentity(env, id, request.headers.get("oai-authenticated-user-email"))) {
    throw new AccessError("access_denied", "此服务仅供站点所有者授权使用，请切换为创建此站点的 ChatGPT 账号。", 403);
  }
  return id;
}
export function accessFailure(error: unknown): Response {
  return Response.json({ error: error instanceof AccessError ? error.code : "server_error", message: error instanceof AccessError ? error.message : "认证服务暂时不可用。" }, { status: error instanceof AccessError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
