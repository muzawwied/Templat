import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  apiKeysTable,
  creditTransactionsTable,
  db,
  modelsTable,
  providersTable,
  providerHealthTable,
  rateLimitsTable,
  requestsTable,
  routingRulesTable,
  usageRecordsTable,
  usersTable,
} from "@workspace/db";
import {
  ChatCompletionBody,
  ChatCompletionResponse,
  GatewayListModelsResponse,
} from "@workspace/api-zod";
import { decryptProviderKey } from "../lib/provider-secrets";
import { assertSafeProviderUrl } from "../lib/provider-url";
import { requireApiKey } from "../middlewares/auth";

const router: IRouter = Router();
const requestsPerMinute = 60;
const ipRequestsPerMinute = 120;
const circuitResetMs = 60_000;
const activeProviders = new Map<string, number>();

type RoutedModel = {
  model: typeof modelsTable.$inferSelect;
  provider: typeof providersTable.$inferSelect;
};

type ChatBody = {
  model: string;
  messages: Array<{ role: string; content: unknown; [key: string]: unknown }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

function errorBody(message: string, type = "invalid_request_error", code: string | null = null) {
  return { error: { message, type, code } };
}

function openAiEndpoint(baseUrl: string, suffix: "chat/completions" | "models"): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = basePath.endsWith("/v1")
    ? `${basePath}/${suffix}`
    : `${basePath}/v1/${suffix}`;
  return url;
}

function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 3);
}

function costForTokens(input: number, output: number, model: typeof modelsTable.$inferSelect): number {
  const inputPrice = Number(model.inputPricePerMillion);
  const outputPrice = Number(model.outputPricePerMillion);
  return (input * inputPrice + output * outputPrice) / 1_000_000;
}

function formatMoney(value: number): string {
  return Math.max(0, value).toFixed(10);
}

async function consumeLimit(scopeKey: string, limit: number): Promise<{
  count: number;
  resetAt: Date;
}> {
  const now = new Date();
  const resetAt = new Date(
    Math.floor(now.getTime() / 60_000) * 60_000 + 60_000,
  );
  const windowStart = new Date(resetAt.getTime() - 60_000);
  const [record] = await db.insert(rateLimitsTable).values({
    scopeKey,
    windowStart,
    requestCount: 1,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [rateLimitsTable.scopeKey, rateLimitsTable.windowStart],
    set: {
      requestCount: sql`${rateLimitsTable.requestCount} + 1`,
      updatedAt: now,
    },
  }).returning({ count: rateLimitsTable.requestCount });
  return { count: record?.count ?? limit + 1, resetAt };
}

function setRateHeaders(
  res: Parameters<Parameters<IRouter["get"]>[1]>[1],
  count: number,
  limit: number,
  resetAt: Date,
): void {
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt.getTime() / 1000)));
}

async function applyUserCharge(
  userId: string,
  amount: number,
  requestId: string,
  reason: string,
  kind: "adjustment" | "refund" | "debit",
): Promise<number> {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(usersTable).set({
      creditBalance: sql`${usersTable.creditBalance} + ${amount.toFixed(10)}`,
      updatedAt: new Date(),
    }).where(and(
      eq(usersTable.id, userId),
      amount < 0
        ? gte(usersTable.creditBalance, Math.abs(amount).toFixed(10))
        : sql`true`,
    )).returning({ balance: usersTable.creditBalance });
    if (!updated) throw new Error("Insufficient credit balance.");
    const balance = Number(updated.balance);
    await tx.insert(creditTransactionsTable).values({
      userId,
      type: kind,
      amount: amount.toFixed(10),
      balanceAfter: balance.toFixed(10),
      description: reason,
      requestId,
    });
    return balance;
  });
}

async function reserveCredits(
  userId: string,
  amount: number,
  requestId: string,
): Promise<number> {
  if (amount <= 0) {
    const [user] = await db.select({ balance: usersTable.creditBalance })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return Number(user?.balance ?? 0);
  }
  return applyUserCharge(
    userId,
    -amount,
    requestId,
    "Temporary reservation for an in-progress gateway request",
    "adjustment",
  );
}

async function settleCredits(
  userId: string,
  reserve: number,
  finalCost: number,
  requestId: string,
): Promise<number> {
  const correction = reserve - finalCost;
  if (Math.abs(correction) < 0.00000000005) {
    const [user] = await db.select({ balance: usersTable.creditBalance })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return Number(user?.balance ?? 0);
  }
  return applyUserCharge(
    userId,
    correction,
    requestId,
    correction > 0
      ? "Unused request credit reservation returned"
      : "Additional usage charge",
    correction > 0 ? "refund" : "debit",
  );
}

async function releaseReservation(userId: string, amount: number, requestId: string): Promise<void> {
  if (amount > 0) {
    await applyUserCharge(
      userId,
      amount,
      requestId,
      "Request failed; reserved credits returned",
      "refund",
    );
  }
}

async function updateProviderHealth(
  providerId: string,
  success: boolean,
  latencyMs: number,
  message?: string,
): Promise<void> {
  const [current] = await db.select().from(providerHealthTable)
    .where(eq(providerHealthTable.providerId, providerId)).limit(1);
  const failures = success ? 0 : (current?.consecutiveFailures ?? 0) + 1;
  const openedAt = success
    ? null
    : failures >= 3
      ? current?.circuitOpenedAt ?? new Date()
      : current?.circuitOpenedAt ?? null;
  const averageLatencyMs = success
    ? Math.round(((current?.averageLatencyMs ?? latencyMs) * 4 + latencyMs) / 5)
    : current?.averageLatencyMs ?? null;
  await db.insert(providerHealthTable).values({
    providerId,
    status: success ? "healthy" : failures >= 3 ? "unhealthy" : "degraded",
    consecutiveFailures: failures,
    circuitOpenedAt: openedAt,
    lastCheckedAt: new Date(),
    averageLatencyMs,
    lastError: success ? null : message?.slice(0, 1000) ?? "Provider request failed",
  }).onConflictDoUpdate({
    target: providerHealthTable.providerId,
    set: {
      status: success ? "healthy" : failures >= 3 ? "unhealthy" : "degraded",
      consecutiveFailures: failures,
      circuitOpenedAt: openedAt,
      lastCheckedAt: new Date(),
      averageLatencyMs,
      lastError: success ? null : message?.slice(0, 1000) ?? "Provider request failed",
    },
  });
  await db.update(providersTable).set({
    healthStatus: success ? "healthy" : failures >= 3 ? "unhealthy" : "degraded",
    consecutiveFailures: failures,
    circuitOpenedAt: openedAt,
    averageLatencyMs,
    updatedAt: new Date(),
  }).where(eq(providersTable.id, providerId));
}

function isCircuitOpen(provider: typeof providersTable.$inferSelect): boolean {
  if (!provider.circuitOpenedAt) return false;
  return Date.now() - provider.circuitOpenedAt.getTime() < circuitResetMs;
}

function selectInOrder(candidates: RoutedModel[], strategy: string, modelName: string): RoutedModel[] {
  const ordered = [...candidates];
  if (strategy === "lowest_cost") {
    ordered.sort((a, b) =>
      Number(a.model.inputPricePerMillion) + Number(a.model.outputPricePerMillion) -
      Number(b.model.inputPricePerMillion) - Number(b.model.outputPricePerMillion));
  } else if (strategy === "lowest_latency") {
    ordered.sort((a, b) =>
      (a.provider.averageLatencyMs ?? Number.MAX_SAFE_INTEGER) -
      (b.provider.averageLatencyMs ?? Number.MAX_SAFE_INTEGER));
  } else {
    ordered.sort((a, b) => a.provider.priority - b.provider.priority);
  }
  if (strategy === "round_robin" && ordered.length > 1) {
    const offset = activeProviders.get(modelName) ?? 0;
    activeProviders.set(modelName, (offset + 1) % ordered.length);
    return [...ordered.slice(offset), ...ordered.slice(0, offset)];
  }
  if (strategy === "weighted" && ordered.length > 1) {
    // Lower numeric priority receives greater selection weight. Shuffle a
    // weighted order so failover still visits every healthy provider once.
    const weighted = ordered.map((item) => ({
      item,
      key: -Math.log(Math.max(Number.EPSILON, Math.random())) /
        Math.max(1, 1001 - item.provider.priority),
    })).sort((a, b) => a.key - b.key);
    return weighted.map(({ item }) => item);
  }
  return ordered;
}

async function recordRequest(input: {
  requestId: string;
  userId: string;
  apiKeyId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  providerCost: number;
  userCost: number;
  status: string;
  error?: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(requestsTable).values({
      ...input,
      totalTokens: input.inputTokens + input.outputTokens,
      providerCost: input.providerCost.toFixed(10),
      userCost: input.userCost.toFixed(10),
      error: input.error ?? null,
    });
    await tx.insert(usageRecordsTable).values({
      requestId: input.requestId,
      userId: input.userId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.inputTokens + input.outputTokens,
      providerCost: input.providerCost.toFixed(10),
      userCost: input.userCost.toFixed(10),
    });
  });
}

async function routeProviders(modelName: string, strategy: string): Promise<RoutedModel[]> {
  const rows = await db.select({
    model: modelsTable,
    provider: providersTable,
    health: providerHealthTable,
  }).from(modelsTable)
    .innerJoin(providersTable, eq(modelsTable.providerId, providersTable.id))
    .leftJoin(providerHealthTable, eq(providerHealthTable.providerId, providersTable.id))
    .where(and(
      eq(modelsTable.name, modelName),
      eq(modelsTable.enabled, true),
      eq(providersTable.enabled, true),
    ));
  const candidates = rows
    .filter(({ provider, health }) => {
      const openedAt = health?.circuitOpenedAt ?? provider.circuitOpenedAt;
      return !openedAt || Date.now() - openedAt.getTime() >= circuitResetMs;
    })
    .map(({ model, provider, health }) => ({
      model,
      provider: {
        ...provider,
        healthStatus: health?.status ?? provider.healthStatus,
        circuitOpenedAt: health?.circuitOpenedAt ?? provider.circuitOpenedAt,
        averageLatencyMs: health?.averageLatencyMs ?? provider.averageLatencyMs,
      },
    }));
  return selectInOrder(candidates, strategy, modelName);
}

async function markRateLimit(
  req: Parameters<Parameters<IRouter["post"]>[1]>[0],
  res: Parameters<Parameters<IRouter["post"]>[1]>[1],
  scope: string,
  limit: number,
): Promise<boolean> {
  const result = await consumeLimit(scope, limit);
  setRateHeaders(res, result.count, limit, result.resetAt);
  if (result.count > limit) {
    res.status(429).json(errorBody("Rate limit exceeded. Try again after the reset time.", "rate_limit_error"));
    return false;
  }
  return true;
}

router.get("/v1/models", requireApiKey, async (req, res): Promise<void> => {
  const requestId = randomUUID();
  res.setHeader("X-Request-ID", requestId);
  const keyOk = await markRateLimit(req, res, `key:${req.apiKeyId}`, requestsPerMinute);
  if (!keyOk) return;
  const ipOk = await markRateLimit(req, res, `ip:${req.ip ?? "unknown"}`, ipRequestsPerMinute);
  if (!ipOk) return;
  const rows = await db.select({ model: modelsTable, providerName: providersTable.name })
    .from(modelsTable)
    .innerJoin(providersTable, eq(modelsTable.providerId, providersTable.id))
    .where(and(eq(modelsTable.enabled, true), eq(providersTable.enabled, true)))
    .orderBy(asc(modelsTable.name));
  res.json(GatewayListModelsResponse.parse({
    object: "list",
    data: rows.map(({ model, providerName }) => ({
      id: model.name,
      object: "model",
      created: Math.floor(model.createdAt.getTime() / 1000),
      owned_by: providerName,
    })),
  }));
});

router.post("/v1/chat/completions", requireApiKey, async (req, res): Promise<void> => {
  const requestId = randomUUID();
  res.setHeader("X-Request-ID", requestId);
  const keyOk = await markRateLimit(req, res, `key:${req.apiKeyId}`, requestsPerMinute);
  if (!keyOk) return;
  const ipOk = await markRateLimit(req, res, `ip:${req.ip ?? "unknown"}`, ipRequestsPerMinute);
  if (!ipOk) return;
  const parsed = ChatCompletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorBody(parsed.error.issues[0]?.message ?? "Invalid chat completion request."));
    return;
  }
  const body = parsed.data as ChatBody;
  const [settings] = await db.select().from(routingRulesTable)
    .where(eq(routingRulesTable.id, "global")).limit(1);
  const strategy = settings?.strategy ?? "priority";
  const candidates = await routeProviders(body.model, strategy);
  if (!candidates.length) {
    res.status(503).json(errorBody(`No healthy provider is configured for model "${body.model}".`, "service_unavailable"));
    return;
  }
  if (body.stream && candidates.some((item) => !item.model.supportsStreaming)) {
    const streamingCandidates = candidates.filter((item) => item.model.supportsStreaming);
    candidates.splice(0, candidates.length, ...streamingCandidates);
  }
  if (body.tools?.length && !candidates.some((item) => item.model.supportsTools)) {
    res.status(400).json(errorBody("The selected model does not support tool calling."));
    return;
  }
  const [account] = await db.select({ balance: usersTable.creditBalance })
    .from(usersTable).where(eq(usersTable.id, req.apiKeyUserId!)).limit(1);
  const [firstCandidate] = candidates;
  const messages = body.messages;
  const inputTokensEstimate = estimateTokens(messages);
  const outputReserve = Math.min(body.max_tokens ?? 1024, firstCandidate.model.contextWindow);
  const providerEstimate = costForTokens(inputTokensEstimate, outputReserve, firstCandidate.model);
  const reserve = providerEstimate * (1 + Number(settings?.markupPercent ?? 0) / 100);
  if (Number(account?.balance ?? 0) <= 0 || Number(account?.balance ?? 0) + 1e-10 < reserve) {
    res.status(402).json(errorBody("Insufficient credits for this request.", "insufficient_quota"));
    return;
  }
  try {
    await reserveCredits(req.apiKeyUserId!, reserve, requestId);
  } catch {
    res.status(402).json(errorBody("Insufficient credits for this request.", "insufficient_quota"));
    return;
  }

  const providerAttempts = settings?.fallbackEnabled === false ? candidates.slice(0, 1) : candidates;
  const started = Date.now();
  let finalError = "No provider accepted the request.";
  let finalProvider = firstCandidate.provider.name;
  let anyUpstreamResponse = false;

  for (const candidate of providerAttempts) {
    finalProvider = candidate.provider.name;
    try {
      const safeUrl = await assertSafeProviderUrl(candidate.provider.baseUrl);
      const upstreamBody: Record<string, unknown> = {
        ...body,
        model: candidate.model.modelName,
      };
      if (body.stream) {
        upstreamBody.stream_options = { include_usage: true };
      }
      let upstream: Response | undefined;
      let providerError: string | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          upstream = await fetch(
            openAiEndpoint(safeUrl.toString(), "chat/completions"),
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${decryptProviderKey(candidate.provider.encryptedApiKey)}`,
                "Content-Type": "application/json",
                Accept: body.stream ? "text/event-stream" : "application/json",
              },
              body: JSON.stringify(upstreamBody),
              signal: AbortSignal.timeout(candidate.provider.timeoutMs),
              redirect: "error",
            },
          );
          if (upstream.ok) break;
          const text = await upstream.text();
          providerError = `Provider returned HTTP ${upstream.status}: ${text.slice(0, 600)}`;
          if (upstream.status < 500 && upstream.status !== 429) break;
        } catch (error) {
          providerError = error instanceof Error ? error.message : "Provider request failed.";
        }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const latency = Date.now() - started;
      if (!upstream?.ok) {
        finalError = providerError ?? "Provider request failed.";
        await updateProviderHealth(candidate.provider.id, false, latency, finalError);
        continue;
      }
      anyUpstreamResponse = true;
      await updateProviderHealth(candidate.provider.id, true, latency);

      if (body.stream) {
        const reader = upstream.body?.getReader();
        if (!reader) {
          finalError = "Provider returned an empty streaming response.";
          continue;
        }
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        const decoder = new TextDecoder();
        let carry = "";
        let inputTokens = inputTokensEstimate;
        let outputTokens = 0;
        let streamedText = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(value);
            carry += chunk;
            const lines = carry.split("\n");
            carry = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const event = JSON.parse(payload) as {
                  usage?: { prompt_tokens?: number; completion_tokens?: number };
                  choices?: Array<{ delta?: { content?: unknown } }>;
                };
                if (Number.isInteger(event.usage?.prompt_tokens)) inputTokens = event.usage!.prompt_tokens!;
                if (Number.isInteger(event.usage?.completion_tokens)) outputTokens = event.usage!.completion_tokens!;
                const content = event.choices?.[0]?.delta?.content;
                if (typeof content === "string") streamedText += content;
              } catch {
                // Providers may include non-JSON SSE metadata; forward it unchanged.
              }
            }
          }
          if (!outputTokens) outputTokens = estimateTokens(streamedText);
          const providerCost = costForTokens(inputTokens, outputTokens, candidate.model);
          const userCost = providerCost * (1 + Number(settings?.markupPercent ?? 0) / 100);
          const settledBalance = await settleCredits(req.apiKeyUserId!, reserve, userCost, requestId);
          await recordRequest({
            requestId,
            userId: req.apiKeyUserId!,
            apiKeyId: req.apiKeyId!,
            model: body.model,
            provider: candidate.provider.name,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - started,
            providerCost,
            userCost,
            status: "succeeded",
          });
          req.log.info({ requestId, provider: candidate.provider.name, inputTokens, outputTokens, userCost, balance: settledBalance }, "Chat completion streamed");
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          await releaseReservation(req.apiKeyUserId!, reserve, requestId);
          const message = error instanceof Error ? error.message : "Streaming provider failed.";
          await recordRequest({
            requestId,
            userId: req.apiKeyUserId!,
            apiKeyId: req.apiKeyId!,
            model: body.model,
            provider: candidate.provider.name,
            inputTokens: inputTokensEstimate,
            outputTokens: estimateTokens(streamedText),
            latencyMs: Date.now() - started,
            providerCost: 0,
            userCost: 0,
            status: "failed",
            error: message,
          });
          req.log.error({ requestId, provider: candidate.provider.name, err: error }, "Streaming completion failed");
        } finally {
          res.end();
        }
        return;
      }

      const data = await upstream.json() as {
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        [key: string]: unknown;
      };
      const inputTokens = data.usage?.prompt_tokens ?? inputTokensEstimate;
      const outputTokens = data.usage?.completion_tokens ?? estimateTokens(data.choices ?? []);
      const providerCost = costForTokens(inputTokens, outputTokens, candidate.model);
      const userCost = providerCost * (1 + Number(settings?.markupPercent ?? 0) / 100);
      const settledBalance = await settleCredits(req.apiKeyUserId!, reserve, userCost, requestId);
      await recordRequest({
        requestId,
        userId: req.apiKeyUserId!,
        apiKeyId: req.apiKeyId!,
        model: body.model,
        provider: candidate.provider.name,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
        providerCost,
        userCost,
        status: "succeeded",
      });
      data.model = body.model;
      res.setHeader("X-Usage-Input-Tokens", String(inputTokens));
      res.setHeader("X-Usage-Output-Tokens", String(outputTokens));
      res.setHeader("X-Usage-Cost", userCost.toFixed(10));
      req.log.info({ requestId, provider: candidate.provider.name, inputTokens, outputTokens, userCost, balance: settledBalance }, "Chat completion complete");
      res.json(ChatCompletionResponse.parse(data));
      return;
    } catch (error) {
      finalError = error instanceof Error ? error.message : "Provider request failed.";
      if (anyUpstreamResponse) {
        // A response body or settlement error cannot safely be retried on
        // another provider because the upstream may already have completed.
        break;
      }
    }
  }

  await releaseReservation(req.apiKeyUserId!, reserve, requestId);
  await recordRequest({
    requestId,
    userId: req.apiKeyUserId!,
    apiKeyId: req.apiKeyId!,
    model: body.model,
    provider: finalProvider,
    inputTokens: inputTokensEstimate,
    outputTokens: 0,
    latencyMs: Date.now() - started,
    providerCost: 0,
    userCost: 0,
    status: "failed",
    error: finalError,
  });
  req.log.warn({ requestId, model: body.model, provider: finalProvider, error: finalError }, "Chat completion failed");
  res.status(anyUpstreamResponse ? 502 : 502).json(errorBody(finalError, "provider_error", "provider_request_failed"));
});

export default router;
