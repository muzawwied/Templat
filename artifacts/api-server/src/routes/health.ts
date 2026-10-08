import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/ready", async (_req, res): Promise<void> => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

router.get("/metrics", (_req, res) => {
  const memory = process.memoryUsage();
  res.type("text/plain").send([
    "# HELP ai_router_process_uptime_seconds Process uptime in seconds",
    "# TYPE ai_router_process_uptime_seconds gauge",
    `ai_router_process_uptime_seconds ${Math.floor(process.uptime())}`,
    "# HELP ai_router_process_memory_bytes Process memory usage in bytes",
    "# TYPE ai_router_process_memory_bytes gauge",
    `ai_router_process_memory_bytes{type="rss"} ${memory.rss}`,
    `ai_router_process_memory_bytes{type="heap_used"} ${memory.heapUsed}`,
  ].join("\n") + "\n");
});

export default router;
