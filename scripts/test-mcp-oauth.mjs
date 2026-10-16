import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const directory = path.resolve(".sites-runtime/oauth-tests");
await mkdir(directory, { recursive: true });
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from "\.\/([A-Za-z0-9-]+)"/g, 'from "./$1.mjs"')
  .replace(/import\("\.\/([A-Za-z0-9-]+)"\)/g, 'import("./$1.mjs")')
  .replace(/from "(?:\.\.\/)+lib\/([A-Za-z0-9-]+)"/g, 'from "./$1.mjs"')
  .replace(/from "cloudflare:workers"/g, 'from "./test-env.mjs"');
for (const name of ["mcp-oauth", "owner-access", "oauth-crypto", "site-config", "client-permissions", "mcp-client", "mcp-handler", "market", "multi", "extras"]) {
  await writeFile(`${directory}/${name}.mjs`, compile(await readFile(`lib/${name}.ts`, "utf8")));
}
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir("drizzle")).filter(file => file.endsWith(".sql")).sort()) sqlite.exec(await readFile(`drizzle/${file}`, "utf8"));
const DB = {
  prepare(sql) {
    let bindings = [];
    return {
      bind(...values) { bindings = values; return this; },
      async first() { return sqlite.prepare(sql).get(...bindings) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
      runNow() { return { meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }; },
      async run() { return this.runNow(); },
    };
  },
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = statements.map(statement => statement.runNow()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const env = { DB, FINANCE_OWNER_EMAIL: "owner@example.test", SITE_ORIGIN: "https://finance.example" };
globalThis.__financeOAuthTestEnv = env;
await writeFile(`${directory}/test-env.mjs`, "export const env = globalThis.__financeOAuthTestEnv;");
for (const [file, name] of [
  ["app/mcp/route.ts", "platform-route"], ["app/api/mcp/route.ts", "external-route"],
  ["app/api/oauth/[...path]/route.ts", "oauth-route"],
  ["app/.well-known/oauth-authorization-server/api/oauth/route.ts", "issuer-route"],
  ["app/api/oauth/.well-known/openid-configuration/route.ts", "openid-route"],
  ["app/.well-known/oauth-protected-resource/api/mcp/route.ts", "resource-route"],
  ["app/api/query/route.ts", "query-route"], ["app/api/status/route.ts", "status-route"],
]) {
  await writeFile(`${directory}/${name}.mjs`, compile((await readFile(file, "utf8")).replaceAll('"@/lib/market"', '"./market"')));
}
const load = name => import(pathToFileURL(`${directory}/${name}.mjs`));
const oauth = await load("mcp-oauth"), crypto = await load("oauth-crypto");
const routes = await load("oauth-route"), external = await load("external-route"), platform = await load("platform-route");
const callback = "https://claude.ai/api/mcp/auth_callback", chatgpt = "https://chatgpt.com/connector_platform_oauth_redirect";
const base = env.SITE_ORIGIN + "/api/oauth", resource = env.SITE_ORIGIN + "/api/mcp";
const owner = { "oai-authenticated-user-id": "site-scoped-owner", "oai-authenticated-user-email": env.FINANCE_OWNER_EMAIL };
const browser = { ...owner, Origin: env.SITE_ORIGIN };
const post = (suffix, body, headers = {}, json = false) => routes.POST(new Request(base + suffix, { method: "POST", headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded", ...headers }, body: json ? JSON.stringify(body) : new URLSearchParams(body) }));
const get = (suffix, headers = {}) => routes.GET(new Request(base + suffix, { headers }));
const rpc = (route, method, params = {}, headers = {}) => route.POST(new Request(resource, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }) }));
async function register(redirect = callback) {
  const response = await post("/register", { redirect_uris: [redirect] }, {}, true);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.token_endpoint_auth_method, "none"); assert.ok(!body.client_secret);
  return body.client_id;
}
async function consent(client, redirect = callback, scope = "finance.read", extra = {}, headers = owner) {
  const verifier = crypto.randomString(64), state = "opaque state + & 中文";
  const params = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", code_challenge: await crypto.sha256(verifier), code_challenge_method: "S256", resource, scope, state, ...extra });
  const response = await get("/authorize?" + params, headers);
  return { response, verifier, state, params, redirect, client };
}
async function approvalData(auth) {
  assert.equal(auth.response.status, 200);
  assert.equal(auth.response.headers.get("referrer-policy"), "same-origin");
  assert.ok(auth.response.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  const html = await auth.response.text();
  assert.ok(html.includes("允许只读连接") && html.includes("自动续期"));
  return { request_id: html.match(/name="request_id" value="([^"]+)"/)[1], csrf_token: html.match(/name="csrf_token" value="([^"]+)"/)[1], decision: "allow" };
}
async function codeFor(client, redirect = callback, scope = "finance.read") {
  const auth = await consent(client, redirect, scope);
  const approval = await post("/authorize", await approvalData(auth), browser);
  assert.equal(approval.status, 303);
  const url = new URL(approval.headers.get("location"));
  assert.equal(url.origin + url.pathname, redirect); assert.equal(url.searchParams.get("state"), auth.state); assert.equal(url.searchParams.get("iss"), base);
  return { grant_type: "authorization_code", client_id: client, redirect_uri: redirect, resource, code: url.searchParams.get("code"), code_verifier: auth.verifier };
}
async function grant(client, redirect = callback, scope = "finance.read") {
  const response = await post("/token", await codeFor(client, redirect, scope));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json(); assert.ok(result.refresh_token, "Read-only consent includes automatic renewal even without offline_access");
  return result;
}
const bearer = token => ({ Authorization: "Bearer " + token });
const renewal = (client, tokens, extra = {}) => post("/token", { grant_type: "refresh_token", client_id: client, resource, refresh_token: tokens.refresh_token, ...extra });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

await check("Resource discovery, issuer identity and OpenID fallback agree", async () => {
  const metadata = await (await (await load("issuer-route")).GET()).json();
  assert.equal(metadata.issuer, base); assert.equal(metadata.registration_endpoint, base + "/register"); assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.scopes_supported, ["finance.read", "offline_access"]);
  assert.deepEqual(await (await (await load("openid-route")).GET()).json(), metadata);
  assert.equal((await (await (await load("resource-route")).GET()).json()).resource, resource);
});
await check("Portable origin validation and complete MCP wire results", async () => {
  const { siteOrigin } = await load("site-config");
  assert.equal(siteOrigin({SITE_ORIGIN:"https://new-owner.example/"}), "https://new-owner.example");
  for (const value of [undefined, "https://example.test/path", "https://user:pass@example.test", "http://public.example"])
    assert.throws(() => siteOrigin({SITE_ORIGIN:value}));
  for (const method of ["server/discover", "tools/list", "initialize", "ping", "tools/call"]) {
    const reply = await (await rpc(platform, method, method === "tools/call" ? {name:"akshare_service_status"} : {}, owner)).json();
    assert.equal(reply.result.resultType, "complete");
    assert.equal(reply.result._meta["io.modelcontextprotocol/serverInfo"].name, "Financial Data");
    if (["server/discover", "tools/list"].includes(method)) {
      assert.equal(reply.result.ttlMs, 0); assert.equal(reply.result.cacheScope, "private");
    }
    if (method === "tools/call") assert.equal(JSON.parse(reply.result.content[0].text).mcp_connection.site_endpoint, env.SITE_ORIGIN + "/mcp");
  }
});
const client = await register();
await check("Anonymous external GET and POST challenge instead of exposing tools", async () => {
  for (const response of [await external.GET(new Request(resource)), await rpc(external, "tools/list"), await rpc(external, "initialize")]) {
    assert.equal(response.status, 401); assert.ok(response.headers.get("www-authenticate").includes(base + "/resource"));
  }
  assert.equal((await rpc(external, "tools/list", {}, owner)).status, 401, "Browser identity is not an external token");
});
await check("Login redirects retain the complete authorization request", async () => {
  const auth = await consent(client, callback, "finance.read", {}, {});
  assert.equal(auth.response.status, 303);
  const login = new URL(auth.response.headers.get("location"), env.SITE_ORIGIN);
  assert.equal(login.pathname, "/signin-with-chatgpt"); assert.equal(login.searchParams.get("return_to"), "/api/oauth/authorize?" + auth.params);
});
await check("A different signed-in account cannot authorize or query", async () => {
  const wrong = { ...owner, "oai-authenticated-user-email": "other@example.test" };
  assert.equal((await consent(client, callback, "finance.read", {}, wrong)).response.status, 403);
  assert.equal((await rpc(platform, "tools/call", { name: "akshare_service_status" }, wrong)).status, 403);
  assert.equal((await (await load("query-route")).POST(new Request(env.SITE_ORIGIN + "/api/query", { method: "POST", headers: wrong }))).status, 403);
  assert.equal((await (await load("status-route")).GET(new Request(env.SITE_ORIGIN + "/api/status"))).status, 401);
});
await check("Invalid callbacks, implicit grants, scope escalation, and invalid PKCE fail", async () => {
  assert.equal((await post("/register", { redirect_uris: ["https://attacker.example/callback"] }, {}, true)).status, 400);
  assert.equal((await post("/register", { redirect_uris: [callback], token_endpoint_auth_method: "client_secret_basic" }, {}, true)).status, 400);
  for (const extra of [{ code_challenge_method: "plain" }, { code_challenge: "x" }, { response_type: "token" }, { resource: "https://wrong.example/mcp" }, { redirect_uri: chatgpt }]) assert.equal((await consent(client, callback, "finance.read", extra)).response.status, 400);
  assert.equal((await consent(client, callback, "finance.read finance.write")).response.status, 400);
});
await check("Consent requires matching owner, one-use CSRF and same-origin form", async () => {
  const form = await approvalData(await consent(client));
  assert.equal((await post("/authorize", { ...form, csrf_token: "wrong" }, browser)).status, 400);
  assert.equal((await post("/authorize", form, { ...browser, Origin: "https://attacker.example" })).status, 403);
  assert.equal((await post("/authorize", form, { ...browser, Origin: "null" })).status, 403);
  assert.equal((await post("/authorize", form, { ...browser, Origin: "null", "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })).status, 303);
  assert.equal((await post("/authorize", form, browser)).status, 400);
});
await check("Cancel preserves state and issuer without issuing a code", async () => {
  const auth = await consent(client); const form = await approvalData(auth);
  const response = await post("/authorize", { ...form, decision: "deny" }, browser);
  const url = new URL(response.headers.get("location"));
  assert.equal(url.searchParams.get("error"), "access_denied"); assert.equal(url.searchParams.get("state"), auth.state); assert.equal(url.searchParams.get("iss"), base); assert.equal(url.searchParams.has("code"), false);
});
await check("Authorization codes bind verifier, client, resource and callback; replay fails", async () => {
  const code = await codeFor(client);
  for (const extra of [{ code_verifier: crypto.randomString(64) }, { client_id: "wrong" }, { redirect_uri: chatgpt }, { resource: "https://wrong.example/mcp" }]) assert.equal((await post("/token", { ...code, ...extra })).status, 400);
  assert.equal((await post("/token", code)).status, 200); assert.equal((await post("/token", code)).status, 400);
});
await check("Expired authorization codes cannot be exchanged", async () => {
  const code = await codeFor(client);
  sqlite.prepare("UPDATE finance_oauth_codes SET expires_at = 0 WHERE code_hash = ?").run(await crypto.sha256(code.code));
  assert.equal((await post("/token", code)).status, 400);
});
let tokens = await grant(client);
await check("Authorized MCP lists all ten read-only tools and calls service status", async () => {
  const initialized = await (await rpc(external, "initialize", { protocolVersion: "2025-11-25" }, bearer(tokens.access_token))).json();
  assert.equal(initialized.result.protocolVersion, "2025-11-25");
  const result = await (await rpc(external, "tools/list", {}, bearer(tokens.access_token))).json();
  assert.equal(result.result.tools.length, 10);
  assert.ok(result.result.tools.every(tool => tool.annotations.readOnlyHint && tool.securitySchemes[0].scopes[0] === "finance.read"));
  const status = await (await rpc(external, "tools/call", { name: "akshare_service_status" }, bearer(tokens.access_token))).json();
  assert.equal(status.result.isError, false);
  const connection = JSON.parse(status.result.content[0].text).mcp_connection;
  assert.equal(connection.manual_authentication, "oauth"); assert.equal(connection.anonymous_queries_allowed, false);
  assert.equal((await external.GET(new Request(resource, { headers: bearer(tokens.access_token) }))).status, 405);
  assert.equal((await rpc(external, "tools/list", {}, { ...bearer(tokens.access_token), Origin: "https://attacker.example" })).status, 403);
});
await check("Existing platform discovery and owner data calls still work", async () => {
  assert.equal((await rpc(platform, "tools/list")).status, 200);
  assert.equal((await rpc(platform, "tools/call", { name: "akshare_service_status" })).status, 401);
  assert.equal((await (await rpc(platform, "tools/call", { name: "akshare_service_status" }, owner)).json()).result.isError, false);
});
await check("Refresh rotates; replay revokes the complete token family", async () => {
  const response = await renewal(client, tokens); assert.equal(response.status, 200);
  const rotated = await response.json(); assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  await oauth.oauthAccess(env, "Bearer " + rotated.access_token);
  assert.equal((await renewal(client, tokens)).status, 400);
  await assert.rejects(oauth.oauthAccess(env, "Bearer " + rotated.access_token));
  assert.equal((await renewal(client, rotated)).status, 400);
});
await check("Concurrent code exchange issues at most one token family", async () => {
  const code = await codeFor(client);
  const responses = await Promise.all([post("/token", code), post("/token", code)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
});
await check("Concurrent refresh issues at most one rotation and detects reuse", async () => {
  const fresh = await grant(client);
  const responses = await Promise.all([renewal(client, fresh), renewal(client, fresh)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  await assert.rejects(oauth.oauthAccess(env, "Bearer " + fresh.access_token));
});
await check("Refresh cannot widen scope or change audience", async () => {
  tokens = await grant(client);
  assert.equal((await renewal(client, tokens, { scope: "finance.read finance.write" })).status, 400);
  assert.equal((await renewal(client, tokens, { resource: "https://wrong.example/mcp" })).status, 400);
  assert.equal((await renewal("wrong", tokens)).status, 400);
});
await check("Revocation is bound to client, then immediately blocks access and refresh", async () => {
  assert.equal((await post("/revoke", { token: tokens.access_token, client_id: "wrong" })).status, 200);
  await oauth.oauthAccess(env, "Bearer " + tokens.access_token);
  await post("/revoke", { token: tokens.refresh_token, client_id: client });
  assert.equal((await rpc(external, "tools/list", {}, bearer(tokens.access_token))).status, 401);
  assert.equal((await renewal(client, tokens)).status, 400);
});
await check("Owner rotation invalidates existing OAuth grants; missing configuration fails closed", async () => {
  tokens = await grant(client);
  await assert.rejects(oauth.oauthAccess({ ...env, FINANCE_OWNER_EMAIL: "new@example.test" }, "Bearer " + tokens.access_token));
  await assert.rejects(oauth.oauthAccess({ ...env, FINANCE_OWNER_EMAIL: undefined }, "Bearer " + tokens.access_token));
});
await check("ChatGPT dynamic registration completes the same read-only flow", async () => {
  const client = await register(chatgpt); const tokens = await grant(client, chatgpt, "finance.read offline_access");
  assert.equal((await oauth.oauthAccess(env, "Bearer " + tokens.access_token)).authentication, "oauth");
});
const fetchOriginal = globalThis.fetch;
await check("Official CIMD documents are validated for ChatGPT and Claude", async () => {
  const documents = [
    ["https://chatgpt.com/oauth/client.json", chatgpt],
    ["https://chatgpt.com/oauth/callback_123/client.json", "https://chatgpt.com/connector/oauth/callback_123"],
    ["https://claude.ai/oauth/mcp-oauth-client-metadata", callback],
  ];
  for (const [id, redirect] of documents) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, id); assert.equal(options.redirect, "manual"); assert.equal(options.headers.Authorization, undefined);
      return Response.json({ client_id: id, redirect_uris: [redirect], token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_methods_supported: ["private_key_jwt", "none"] });
    };
    await grant(id, redirect);
    globalThis.fetch = async () => Response.json({ client_id: id, redirect_uris: ["https://attacker.example"], token_endpoint_auth_method: "none" });
    assert.equal((await consent(id, redirect)).response.status, 400);
  }
  const claudeId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  globalThis.fetch = async () => Response.json({ client_id: claudeId, redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"] });
  await grant(claudeId);
  globalThis.fetch = fetchOriginal;
});
await check("Official identity outages provide automatic-registration recovery", async () => {
  globalThis.fetch = async () => new Response(null, { status: 403 });
  const response = (await consent("https://claude.ai/oauth/mcp-oauth-client-metadata")).response;
  assert.equal(response.status, 503); assert.ok((await response.text()).includes("自动注册"));
  globalThis.fetch = fetchOriginal;
});
await check("Untrusted CIMD host never gets fetched; metadata redirects are not followed", async () => {
  globalThis.fetch = async () => { throw new Error("Unexpected outbound request"); };
  assert.equal((await consent("https://127.0.0.1/oauth/client.json")).response.status, 400);
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: "https://attacker.example" } });
  assert.equal((await consent("https://chatgpt.com/oauth/client.json", chatgpt)).response.status, 400);
  globalThis.fetch = fetchOriginal;
});
await check("Readiness reports platform 403 as unavailable and never sends credentials", async () => {
  globalThis.fetch = async (_, options) => { assert.equal(options.headers["OAI-Sites-Authorization"], undefined); return new Response(null, { status: 403 }); };
  assert.equal((await oauth.inspectOAuthDiscovery(env)).ready, false);
  globalThis.fetch = async url => {
    if (url === resource) return oauth.oauthChallenge(env);
    if (url === base + "/resource") return oauth.protectedResourceMetadata(env);
    return oauth.authorizationServerMetadata(env);
  };
  assert.equal((await oauth.inspectOAuthDiscovery(env)).ready, true);
  assert.equal((await (await get("/status", owner)).json()).ready, true);
  globalThis.fetch = fetchOriginal;
});
await check("Owner can revoke all grants but cross-site requests cannot", async () => {
  assert.equal((await post("/revoke-all", {}, { ...browser, Origin: "https://attacker.example" })).status, 403);
  assert.equal((await post("/revoke-all", {}, browser)).status, 200);
  await assert.rejects(oauth.oauthAccess(env, "Bearer " + tokens.access_token));
});
await check("No plaintext authorization tokens are stored", async () => {
  const rows = sqlite.prepare("SELECT key_hash FROM finance_oauth_access").all();
  assert.ok(rows.length > 0 && rows.every(row => /^[A-Za-z0-9_-]{43}$/.test(row.key_hash)));
  const refresh = sqlite.prepare("SELECT key_hash FROM finance_oauth_refresh").all();
  assert.ok(refresh.every(row => !row.key_hash.startsWith("fdmcp_rt_")));
});
sqlite.close();
console.log(`${passed} OAuth integration checks passed.`);
