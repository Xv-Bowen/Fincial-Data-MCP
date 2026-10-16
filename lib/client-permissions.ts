export const MCP_READ_SCOPE = "finance.read";
export const MCP_SCOPES = [MCP_READ_SCOPE, "offline_access"];
export type McpClientAccess = { user_id: string; scopes: string[]; authentication: "oauth" };
