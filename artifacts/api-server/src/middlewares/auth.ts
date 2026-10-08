import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      routerUserId?: string;
      routerUserRole?: "admin" | "user";
      apiKeyId?: string;
      apiKeyUserId?: string;
    }
  }
}

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId = auth.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const claims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
  const email = typeof claims.email === "string" ? claims.email : null;
  const displayName = typeof claims.name === "string" ? claims.name : null;

  let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    user = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ai-router-first-admin'))`);
      const [existing] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (existing) return existing;
      const [admin] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.role, "admin")).limit(1);
      const [created] = await tx.insert(usersTable).values({
        id: userId,
        email,
        displayName,
        role: admin ? "user" : "admin",
      }).returning();
      return created;
    });
  } else if (
    (email && email !== user.email) ||
    (displayName && displayName !== user.displayName)
  ) {
    [user] = await db.update(usersTable)
      .set({ ...(email ? { email } : {}), ...(displayName ? { displayName } : {}), updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();
  }

  req.routerUserId = user.id;
  req.routerUserRole = user.role === "admin" ? "admin" : "user";
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.routerUserId || req.routerUserRole !== "admin") {
    res.status(req.routerUserId ? 403 : 401).json({
      error: req.routerUserId ? "Administrator access is required." : "Sign in to continue.",
    });
    return;
  }
  next();
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return (async () => {
    const value = req.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!value || value.length > 512) {
      res.status(401).json({ error: "A valid Bearer API key is required." });
      return;
    }
    const { createHash } = await import("node:crypto");
    const keyHash = createHash("sha256").update(value).digest("hex");
    const { apiKeysTable } = await import("@workspace/db");
    const [key] = await db.select({
      id: apiKeysTable.id,
      userId: apiKeysTable.userId,
    }).from(apiKeysTable).where(and(
      eq(apiKeysTable.keyHash, keyHash),
      eq(apiKeysTable.status, "active"),
    )).limit(1);
    if (!key) {
      res.status(401).json({ error: "The API key is invalid or has been revoked." });
      return;
    }
    await db.update(apiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeysTable.id, key.id));
    req.apiKeyId = key.id;
    req.apiKeyUserId = key.userId;
    next();
  })();
}
