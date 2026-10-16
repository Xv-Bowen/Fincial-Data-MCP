import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const oauthUsers = sqliteTable("finance_oauth_users", {
  userId: text("user_id").primaryKey(),
  ownerHash: text("owner_hash").notNull(),
});

export const mcpOAuthClients = sqliteTable("finance_oauth_clients", {
  clientId: text("client_id").primaryKey(),
  redirectUri: text("redirect_uri").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const mcpOAuthRequests = sqliteTable("finance_oauth_requests", {
  requestHash: text("request_hash").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  challenge: text("challenge").notNull(),
  state: text("state").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  csrfHash: text("csrf_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const mcpOAuthCodes = sqliteTable("finance_oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  challenge: text("challenge").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const mcpOAuthGrants = sqliteTable("finance_oauth_grants", {
  grantId: text("grant_id").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
});

export const mcpOAuthAccess = sqliteTable("finance_oauth_access", {
  keyHash: text("key_hash").primaryKey(),
  grantId: text("grant_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const mcpOAuthRefresh = sqliteTable("finance_oauth_refresh", {
  keyHash: text("key_hash").primaryKey(),
  grantId: text("grant_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  rotationId: text("rotation_id"),
});
