import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { randomBytes, createHash } from "node:crypto";
import {
  apiKeysTable,
  auditLogsTable,
  creditTransactionsTable,
  db,
  modelsTable,
  providersTable,
  requestsTable,
  routingRulesTable,
  usersTable,
} from "@workspace/db";
import {
  CreateApiKeyBody,
  CreateApiKeyResponse,
  CreateModelBody,
  CreateModelResponse,
  CreateProviderBody,
  CreateProviderResponse,
  GetCreditsResponse,
  GetCurrentUserResponse,
  GetDashboardResponse,
  GetRoutingSettingsResponse,
  ListApiKeysResponse,
  ListAdminUsersQueryParams,
  ListAdminUsersResponse,
  ListAuditLogsQueryParams,
  ListAuditLogsResponse,
  ListModelsResponse,
  ListProvidersResponse,
  ListRequestLogsQueryParams,
  ListRequestLogsResponse,
  ListUsageQueryParams,
  ListUsageResponse,
  UpdateModelBody,
  UpdateModelParams,
  UpdateModelResponse,
  UpdateProviderBody,
  UpdateProviderParams,
  UpdateProviderResponse,
  UpdateRoutingSettingsBody,
  UpdateRoutingSettingsResponse,
  AdjustUserCreditsBody,
  AdjustUserCreditsParams,
  AdjustUserCreditsResponse,
} from "@workspace/api-zod";
import { decryptProviderKey, encryptProviderKey } from "../lib/provider-secrets";
import { assertSafeProviderUrl } from "../lib/provider-url";
import { requireAdmin, requireUser } from "../middlewares/auth";

const router: IRouter = Router();
const dayMs = 24 * 60 * 60 * 1000;

function usageDto(row: typeof requestsTable.$inferSelect) {
  return {
    id: row.id,
    requestId: row.requestId,
    model: row.model,
    provider: row.provider,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    latencyMs: row.latencyMs,
    providerCost: Number(row.providerCost),
    userCost: Number(row.userCost),
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

async function audit(
  actorUserId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditLogsTable).values({ actorUserId, action, resourceType, resourceId, details });
}

function publicProvider(provider: typeof providersTable.$inferSelect, modelCount: number) {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    priority: provider.priority,
    timeoutMs: provider.timeoutMs,
    enabled: provider.enabled,
    keyConfigured: Boolean(provider.encryptedApiKey),
    healthStatus: provider.healthStatus as "unknown" | "healthy" | "degraded" | "unhealthy",
    modelCount,
    createdAt: provider.createdAt.toISOString(),
  };
}

async function listModelDtos() {
  const rows = await db.select({
    model: modelsTable,
    providerName: providersTable.name,
  }).from(modelsTable)
    .innerJoin(providersTable, eq(modelsTable.providerId, providersTable.id))
    .orderBy(asc(modelsTable.name));
  return rows.map(({ model, providerName }) => ({
    id: model.id,
    providerId: model.providerId,
    providerName,
    name: model.name,
    modelName: model.modelName,
    contextWindow: model.contextWindow,
    inputPricePerMillion: Number(model.inputPricePerMillion),
    outputPricePerMillion: Number(model.outputPricePerMillion),
    supportsStreaming: model.supportsStreaming,
    supportsVision: model.supportsVision,
    supportsTools: model.supportsTools,
    enabled: model.enabled,
  }));
}

router.get("/me", requireUser, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.id, req.routerUserId!)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Account could not be loaded." });
    return;
  }
  const claims = (req as typeof req & { auth?: { sessionClaims?: Record<string, unknown> } }).auth?.sessionClaims ?? {};
  res.json(GetCurrentUserResponse.parse({
    id: user.id,
    email: user.email ?? (typeof claims.email === "string" ? claims.email : null),
    displayName: user.displayName ?? (typeof claims.name === "string" ? claims.name : null),
    role: user.role,
    creditBalance: Number(user.creditBalance),
  }));
});

router.get("/dashboard", requireUser, async (req, res): Promise<void> => {
  const userId = req.routerUserId!;
  const since = new Date(Date.now() - 13 * dayMs);
  const [aggregate] = await db.select({
    totalRequests: sql<number>`count(*)::int`,
    totalTokens: sql<number>`coalesce(sum(${requestsTable.totalTokens}), 0)::int`,
    totalSpend: sql<string>`coalesce(sum(${requestsTable.userCost}), 0)::text`,
    avgLatency: sql<number>`coalesce(avg(${requestsTable.latencyMs}), 0)::int`,
    failures: sql<number>`count(*) filter (where ${requestsTable.status} <> 'succeeded')::int`,
  }).from(requestsTable)
    .where(and(eq(requestsTable.userId, userId), gte(requestsTable.createdAt, since)));
  const dailyRows = await db.select({
    date: sql<string>`to_char(date_trunc('day', ${requestsTable.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
    requests: sql<number>`count(*)::int`,
    tokens: sql<number>`coalesce(sum(${requestsTable.totalTokens}), 0)::int`,
    cost: sql<string>`coalesce(sum(${requestsTable.userCost}), 0)::text`,
  }).from(requestsTable)
    .where(and(eq(requestsTable.userId, userId), gte(requestsTable.createdAt, since)))
    .groupBy(sql`date_trunc('day', ${requestsTable.createdAt} at time zone 'UTC')`)
    .orderBy(asc(sql`date_trunc('day', ${requestsTable.createdAt} at time zone 'UTC')`));
  const recentRows = await db.select().from(requestsTable)
    .where(eq(requestsTable.userId, userId))
    .orderBy(desc(requestsTable.createdAt))
    .limit(8);
  const [credit] = await db.select({ creditBalance: usersTable.creditBalance })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [providerCount] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(providersTable).where(eq(providersTable.enabled, true));
  const [modelCount] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(modelsTable).where(eq(modelsTable.enabled, true));

  const dailyMap = new Map(dailyRows.map((day) => [day.date, day]));
  const daily = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(since.getTime() + index * dayMs).toISOString().slice(0, 10);
    const day = dailyMap.get(date);
    return {
      date,
      requests: day?.requests ?? 0,
      tokens: day?.tokens ?? 0,
      cost: Number(day?.cost ?? 0),
    };
  });
  const totalRequests = Number(aggregate?.totalRequests ?? 0);
  const failures = Number(aggregate?.failures ?? 0);
  res.json(GetDashboardResponse.parse({
    totalRequests,
    totalTokens: Number(aggregate?.totalTokens ?? 0),
    totalSpend: Number(aggregate?.totalSpend ?? 0),
    avgLatencyMs: Number(aggregate?.avgLatency ?? 0),
    errorRate: totalRequests ? failures / totalRequests : 0,
    creditBalance: Number(credit?.creditBalance ?? 0),
    activeProviders: Number(providerCount?.count ?? 0),
    activeModels: Number(modelCount?.count ?? 0),
    daily,
    recentUsage: recentRows.map(usageDto),
  }));
});

router.get("/providers", requireUser, async (req, res): Promise<void> => {
  const rows = await db.select().from(providersTable)
    .where(req.routerUserRole === "admin" ? undefined : eq(providersTable.enabled, true))
    .orderBy(asc(providersTable.priority));
  const output = await Promise.all(rows.map(async (provider) => {
    const [result] = await db.select({ count: sql<number>`count(*)::int` })
      .from(modelsTable).where(eq(modelsTable.providerId, provider.id));
    return publicProvider(provider, Number(result?.count ?? 0));
  }));
  res.json(ListProvidersResponse.parse(output));
});

router.post("/providers", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let url: URL;
  try {
    url = await assertSafeProviderUrl(parsed.data.baseUrl);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid provider URL." });
    return;
  }
  const [provider] = await db.insert(providersTable).values({
    name: parsed.data.name.trim(),
    providerType: parsed.data.providerType.trim(),
    baseUrl: url.toString().replace(/\/$/, ""),
    encryptedApiKey: encryptProviderKey(parsed.data.apiKey),
    priority: parsed.data.priority,
    timeoutMs: parsed.data.timeoutMs,
  }).returning();
  await audit(req.routerUserId!, "provider.created", "provider", provider.id, { name: provider.name });
  res.status(201).json(CreateProviderResponse.parse(publicProvider(provider, 0)));
});

router.patch("/providers/:providerId", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateProviderParams.safeParse(req.params);
  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid input." });
    return;
  }
  const updates: Partial<typeof providersTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.baseUrl !== undefined) {
    try {
      const safe = await assertSafeProviderUrl(parsed.data.baseUrl);
      updates.baseUrl = safe.toString().replace(/\/$/, "");
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid provider URL." });
      return;
    }
  }
  if (parsed.data.apiKey) updates.encryptedApiKey = encryptProviderKey(parsed.data.apiKey);
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.timeoutMs !== undefined) updates.timeoutMs = parsed.data.timeoutMs;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  const [provider] = await db.update(providersTable).set(updates)
    .where(eq(providersTable.id, params.data.providerId)).returning();
  if (!provider) {
    res.status(404).json({ error: "Provider not found." });
    return;
  }
  await audit(req.routerUserId!, "provider.updated", "provider", provider.id, { name: provider.name });
  const [modelResult] = await db.select({ count: sql<number>`count(*)::int` })
    .from(modelsTable).where(eq(modelsTable.providerId, provider.id));
  res.json(UpdateProviderResponse.parse(publicProvider(provider, Number(modelResult?.count ?? 0))));
});

router.delete("/providers/:providerId", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [provider] = await db.delete(providersTable)
    .where(eq(providersTable.id, params.data.providerId)).returning();
  if (!provider) {
    res.status(404).json({ error: "Provider not found." });
    return;
  }
  await audit(req.routerUserId!, "provider.deleted", "provider", provider.id, { name: provider.name });
  res.sendStatus(204);
});

router.post("/providers/:providerId/models", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const [provider] = await db.select().from(providersTable)
    .where(eq(providersTable.id, req.params.providerId as string)).limit(1);
  if (!provider) {
    res.status(404).json({ error: "Provider not found." });
    return;
  }
  const safeUrl = await assertSafeProviderUrl(provider.baseUrl);
  const endpoint = new URL(
    safeUrl.pathname.replace(/\/$/, "").endsWith("/v1")
      ? `${safeUrl.pathname.replace(/\/$/, "")}/models`
      : `${safeUrl.pathname.replace(/\/$/, "")}/v1/models`,
    safeUrl.origin,
  );
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${decryptProviderKey(provider.encryptedApiKey)}` },
    signal: AbortSignal.timeout(provider.timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    res.status(502).json({ error: `Provider model discovery failed (HTTP ${response.status}).` });
    return;
  }
  const payload = await response.json() as { data?: Array<{ id?: string }> };
  const discovered = (payload.data ?? [])
    .map((item) => item.id?.trim())
    .filter((id): id is string => Boolean(id))
    .slice(0, 250);
  for (const modelName of discovered) {
    await db.insert(modelsTable).values({
      providerId: provider.id,
      name: modelName,
      modelName,
      enabled: false,
    }).onConflictDoNothing();
  }
  const modelDtos = await listModelDtos();
  res.json(ListModelsResponse.parse(modelDtos.filter((model) => model.providerId === provider.id)));
});

router.get("/models", requireUser, async (_req, res): Promise<void> => {
  res.json(ListModelsResponse.parse(await listModelDtos()));
});

router.post("/models", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateModelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [provider] = await db.select({ name: providersTable.name }).from(providersTable)
    .where(eq(providersTable.id, parsed.data.providerId)).limit(1);
  if (!provider) {
    res.status(400).json({ error: "Select an existing provider." });
    return;
  }
  const [model] = await db.insert(modelsTable).values({
    ...parsed.data,
    inputPricePerMillion: String(parsed.data.inputPricePerMillion),
    outputPricePerMillion: String(parsed.data.outputPricePerMillion),
  }).returning();
  await audit(req.routerUserId!, "model.created", "model", model.id, { model: model.name });
  const [row] = await db.select({ providerName: providersTable.name })
    .from(providersTable).where(eq(providersTable.id, model.providerId)).limit(1);
  res.status(201).json(CreateModelResponse.parse({
    ...model,
    providerName: row!.providerName,
    inputPricePerMillion: Number(model.inputPricePerMillion),
    outputPricePerMillion: Number(model.outputPricePerMillion),
  }));
});

router.patch("/models/:modelId", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateModelParams.safeParse(req.params);
  const parsed = UpdateModelBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid input." });
    return;
  }
  const changes: Partial<typeof modelsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) changes.name = parsed.data.name;
  if (parsed.data.contextWindow !== undefined) changes.contextWindow = parsed.data.contextWindow;
  if (parsed.data.inputPricePerMillion !== undefined) {
    changes.inputPricePerMillion = String(parsed.data.inputPricePerMillion);
  }
  if (parsed.data.outputPricePerMillion !== undefined) {
    changes.outputPricePerMillion = String(parsed.data.outputPricePerMillion);
  }
  if (parsed.data.supportsStreaming !== undefined) changes.supportsStreaming = parsed.data.supportsStreaming;
  if (parsed.data.supportsVision !== undefined) changes.supportsVision = parsed.data.supportsVision;
  if (parsed.data.supportsTools !== undefined) changes.supportsTools = parsed.data.supportsTools;
  if (parsed.data.enabled !== undefined) changes.enabled = parsed.data.enabled;
  const [model] = await db.update(modelsTable).set(changes)
    .where(eq(modelsTable.id, params.data.modelId)).returning();
  if (!model) {
    res.status(404).json({ error: "Model not found." });
    return;
  }
  await audit(req.routerUserId!, "model.updated", "model", model.id, { model: model.name });
  const [provider] = await db.select({ name: providersTable.name }).from(providersTable)
    .where(eq(providersTable.id, model.providerId)).limit(1);
  res.json(UpdateModelResponse.parse({
    ...model,
    providerName: provider!.name,
    inputPricePerMillion: Number(model.inputPricePerMillion),
    outputPricePerMillion: Number(model.outputPricePerMillion),
  }));
});

router.delete("/models/:modelId", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateModelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [model] = await db.delete(modelsTable)
    .where(eq(modelsTable.id, params.data.modelId)).returning();
  if (!model) {
    res.status(404).json({ error: "Model not found." });
    return;
  }
  await audit(req.routerUserId!, "model.deleted", "model", model.id, { model: model.name });
  res.sendStatus(204);
});

router.get("/api-keys", requireUser, async (req, res): Promise<void> => {
  const rows = await db.select().from(apiKeysTable)
    .where(eq(apiKeysTable.userId, req.routerUserId!))
    .orderBy(desc(apiKeysTable.createdAt));
  res.json(ListApiKeysResponse.parse(rows.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    status: key.status,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }))));
});

router.post("/api-keys", requireUser, async (req, res): Promise<void> => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const secret = `sk-airouter-${randomBytes(32).toString("base64url")}`;
  const prefix = secret.slice(0, 19);
  const [key] = await db.insert(apiKeysTable).values({
    userId: req.routerUserId!,
    name: parsed.data.name.trim(),
    keyHash: createHash("sha256").update(secret).digest("hex"),
    prefix,
  }).returning();
  await audit(req.routerUserId!, "api-key.created", "api-key", key.id, { name: key.name });
  res.status(201).json(CreateApiKeyResponse.parse({
    key: {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      status: key.status,
      lastUsedAt: null,
      createdAt: key.createdAt.toISOString(),
    },
    secret,
  }));
});

router.delete("/api-keys/:keyId", requireUser, async (req, res): Promise<void> => {
  const [key] = await db.update(apiKeysTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(apiKeysTable.id, req.params.keyId as string), eq(apiKeysTable.userId, req.routerUserId!)))
    .returning();
  if (!key) {
    res.status(404).json({ error: "API key not found." });
    return;
  }
  await audit(req.routerUserId!, "api-key.revoked", "api-key", key.id, { name: key.name });
  res.sendStatus(204);
});

router.get("/usage", requireUser, async (req, res): Promise<void> => {
  const parsed = ListUsageQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, pageSize, search } = parsed.data;
  const filters = [eq(requestsTable.userId, req.routerUserId!)];
  if (search?.trim()) {
    const query = `%${search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    filters.push(or(
      ilike(requestsTable.model, query),
      ilike(requestsTable.provider, query),
      ilike(requestsTable.requestId, query),
    )!);
  }
  const where = and(...filters);
  const [totalResult] = await db.select({ count: sql<number>`count(*)::int` })
    .from(requestsTable).where(where);
  const rows = await db.select().from(requestsTable)
    .where(where)
    .orderBy(desc(requestsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  res.json(ListUsageResponse.parse({
    items: rows.map(usageDto),
    page,
    pageSize,
    total: Number(totalResult?.count ?? 0),
  }));
});

router.get("/credits", requireUser, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.id, req.routerUserId!)).limit(1);
  const transactions = await db.select().from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.userId, req.routerUserId!))
    .orderBy(desc(creditTransactionsTable.createdAt)).limit(50);
  res.json(GetCreditsResponse.parse({
    balance: Number(user?.creditBalance ?? 0),
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amount: Number(transaction.amount),
      balanceAfter: Number(transaction.balanceAfter),
      description: transaction.description,
      createdAt: transaction.createdAt.toISOString(),
    })),
  }));
});

router.get("/routing-settings", requireUser, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(routingRulesTable)
    .where(eq(routingRulesTable.id, "global")).limit(1);
  res.json(GetRoutingSettingsResponse.parse({
    strategy: settings?.strategy ?? "priority",
    markupPercent: Number(settings?.markupPercent ?? 0),
    fallbackEnabled: settings?.fallbackEnabled ?? true,
  }));
});

router.put("/routing-settings", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateRoutingSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [settings] = await db.insert(routingRulesTable).values({
    id: "global",
    ...parsed.data,
    markupPercent: String(parsed.data.markupPercent),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: routingRulesTable.id,
    set: {
      ...parsed.data,
      markupPercent: String(parsed.data.markupPercent),
      updatedAt: new Date(),
    },
  }).returning();
  await audit(req.routerUserId!, "routing.updated", "routing", "global", parsed.data);
  res.json(UpdateRoutingSettingsResponse.parse({
    strategy: settings.strategy,
    markupPercent: Number(settings.markupPercent),
    fallbackEnabled: settings.fallbackEnabled,
  }));
});

router.get("/admin/users", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListAdminUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, pageSize, search } = parsed.data;
  const filters = [];
  if (search?.trim()) {
    const query = `%${search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    filters.push(or(
      ilike(usersTable.email, query),
      ilike(usersTable.displayName, query),
      ilike(usersTable.id, query),
    )!);
  }
  const where = filters.length ? and(...filters) : undefined;
  const [total] = await db.select({ count: sql<number>`count(*)::int` })
    .from(usersTable).where(where);
  const users = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    displayName: usersTable.displayName,
    role: usersTable.role,
    creditBalance: usersTable.creditBalance,
    createdAt: usersTable.createdAt,
    requestCount: sql<number>`(select count(*)::int from requests where requests.user_id = ${usersTable.id})`,
  }).from(usersTable)
    .where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  res.json(ListAdminUsersResponse.parse({
    items: users.map((user) => ({
      ...user,
      creditBalance: Number(user.creditBalance),
      requestCount: Number(user.requestCount),
      createdAt: user.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total: Number(total?.count ?? 0),
  }));
});

router.post("/admin/users/:userId/credits", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const params = AdjustUserCreditsParams.safeParse(req.params);
  const parsed = AdjustUserCreditsBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid input." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.update(usersTable).set({
        creditBalance: sql`${usersTable.creditBalance} + ${String(parsed.data.amount)}`,
        updatedAt: new Date(),
      }).where(and(
        eq(usersTable.id, params.data.userId),
        parsed.data.amount < 0
          ? gte(usersTable.creditBalance, String(Math.abs(parsed.data.amount)))
          : sql`true`,
      )).returning({
        id: usersTable.id,
        creditBalance: usersTable.creditBalance,
      });
      if (!user) {
        const [exists] = await tx.select({ id: usersTable.id }).from(usersTable)
          .where(eq(usersTable.id, params.data.userId)).limit(1);
        throw new Error(exists ? "The adjustment would make the balance negative." : "User not found.");
      }
      const balance = Number(user.creditBalance);
      const [transaction] = await tx.insert(creditTransactionsTable).values({
        userId: user.id,
        type: "adjustment",
        amount: String(parsed.data.amount),
        balanceAfter: user.creditBalance,
        description: parsed.data.description,
      }).returning();
      return { userId: user.id, balance, transaction };
    });
    await audit(req.routerUserId!, "credit.adjusted", "user", result.userId, {
      amount: parsed.data.amount,
      description: parsed.data.description,
    });
    res.json(AdjustUserCreditsResponse.parse({
      userId: result.userId,
      balance: result.balance,
      transaction: {
        id: result.transaction.id,
        type: result.transaction.type,
        amount: Number(result.transaction.amount),
        balanceAfter: Number(result.transaction.balanceAfter),
        description: result.transaction.description,
        createdAt: result.transaction.createdAt.toISOString(),
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not apply the credit adjustment.";
    res.status(message === "User not found." ? 404 : 400).json({ error: message });
  }
});

router.get("/audit-logs", requireUser, requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, pageSize } = parsed.data;
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogsTable);
  const rows = await db.select({
    id: auditLogsTable.id,
    actor: usersTable.displayName,
    actorId: auditLogsTable.actorUserId,
    action: auditLogsTable.action,
    resourceType: auditLogsTable.resourceType,
    resourceId: auditLogsTable.resourceId,
    details: auditLogsTable.details,
    createdAt: auditLogsTable.createdAt,
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.actorUserId, usersTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  res.json(ListAuditLogsResponse.parse({
    items: rows.map((row) => ({
      id: row.id,
      actor: row.actor ?? row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      details: row.details ?? {},
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize,
    total: Number(total?.count ?? 0),
  }));
});

router.get("/logs", requireUser, async (req, res): Promise<void> => {
  const parsed = ListRequestLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, pageSize, search } = parsed.data;
  const filters = [eq(requestsTable.userId, req.routerUserId!)];
  if (search?.trim()) {
    const query = `%${search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    filters.push(or(
      ilike(requestsTable.model, query),
      ilike(requestsTable.provider, query),
      ilike(requestsTable.requestId, query),
      ilike(requestsTable.error, query),
    )!);
  }
  const where = and(...filters);
  const [total] = await db.select({ count: sql<number>`count(*)::int` })
    .from(requestsTable).where(where);
  const rows = await db.select().from(requestsTable)
    .where(where)
    .orderBy(desc(requestsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  res.json(ListRequestLogsResponse.parse({
    items: rows.map(usageDto),
    page,
    pageSize,
    total: Number(total?.count ?? 0),
  }));
});

export default router;
