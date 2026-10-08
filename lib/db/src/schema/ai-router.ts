import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  role: text("role").notNull().default("user"),
  creditBalance: numeric("credit_balance", { precision: 20, scale: 8 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providersTable = pgTable("providers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  providerType: text("provider_type").notNull().default("openai-compatible"),
  baseUrl: text("base_url").notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  priority: integer("priority").notNull().default(100),
  timeoutMs: integer("timeout_ms").notNull().default(30000),
  enabled: boolean("enabled").notNull().default(true),
  healthStatus: text("health_status").notNull().default("unknown"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  circuitOpenedAt: timestamp("circuit_opened_at", { withTimezone: true }),
  averageLatencyMs: integer("average_latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("providers_name_uidx").on(table.name),
  index("providers_enabled_priority_idx").on(table.enabled, table.priority),
]);

export const modelsTable = pgTable("models", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  modelName: text("model_name").notNull(),
  contextWindow: integer("context_window").notNull().default(8192),
  inputPricePerMillion: numeric("input_price_per_million", { precision: 20, scale: 8 })
    .notNull()
    .default("0"),
  outputPricePerMillion: numeric("output_price_per_million", { precision: 20, scale: 8 })
    .notNull()
    .default("0"),
  supportsStreaming: boolean("supports_streaming").notNull().default(true),
  supportsVision: boolean("supports_vision").notNull().default(false),
  supportsTools: boolean("supports_tools").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("models_provider_model_uidx").on(table.providerId, table.modelName),
  index("models_name_enabled_idx").on(table.name, table.enabled),
]);

export const apiKeysTable = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  prefix: text("prefix").notNull(),
  status: text("status").notNull().default("active"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("api_keys_key_hash_uidx").on(table.keyHash),
  index("api_keys_user_status_idx").on(table.userId, table.status),
]);

export const routingRulesTable = pgTable("routing_rules", {
  id: text("id").primaryKey().default("global"),
  strategy: text("strategy").notNull().default("priority"),
  markupPercent: numeric("markup_percent", { precision: 8, scale: 4 }).notNull().default("0"),
  fallbackEnabled: boolean("fallback_enabled").notNull().default(true),
  rotationOffset: integer("rotation_offset").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const requestsTable = pgTable("requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: text("request_id").notNull(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  apiKeyId: uuid("api_key_id").references(() => apiKeysTable.id, { onDelete: "set null" }),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  providerCost: numeric("provider_cost", { precision: 20, scale: 10 }).notNull().default("0"),
  userCost: numeric("user_cost", { precision: 20, scale: 10 }).notNull().default("0"),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("requests_request_id_uidx").on(table.requestId),
  index("requests_user_created_idx").on(table.userId, table.createdAt),
  index("requests_provider_created_idx").on(table.provider, table.createdAt),
]);

export const usageRecordsTable = pgTable("usage_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: text("request_id").notNull(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  providerCost: numeric("provider_cost", { precision: 20, scale: 10 }).notNull().default("0"),
  userCost: numeric("user_cost", { precision: 20, scale: 10 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("usage_records_request_uidx").on(table.requestId),
  index("usage_records_user_created_idx").on(table.userId, table.createdAt),
]);

export const creditTransactionsTable = pgTable("credit_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 20, scale: 10 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 20, scale: 10 }).notNull(),
  description: text("description").notNull(),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("credit_transactions_user_created_idx").on(table.userId, table.createdAt),
  uniqueIndex("credit_transactions_request_debit_uidx")
    .on(table.requestId)
    .where(sql`${table.type} = 'debit'`),
]);

export const rateLimitsTable = pgTable("rate_limits", {
  scopeKey: text("scope_key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.scopeKey, table.windowStart] }),
]);

export const providerHealthTable = pgTable("provider_health", {
  providerId: uuid("provider_id")
    .primaryKey()
    .references(() => providersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("unknown"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  circuitOpenedAt: timestamp("circuit_opened_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  averageLatencyMs: integer("average_latency_ms"),
  lastError: text("last_error"),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: text("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_created_idx").on(table.createdAt),
  index("audit_logs_actor_idx").on(table.actorUserId, table.createdAt),
]);

export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
