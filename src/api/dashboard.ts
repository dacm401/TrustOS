import { Hono } from "hono";
import { calculateDashboard } from "../logging/metrics-calculator.js";
import { GrowthRepo, DecisionRepo, DelegationLogRepo } from "../db/repositories.js";
import { getContextUserId } from "../middleware/identity.js";
import { calcBaselineCost } from "../config/pricing.js";

const dashboardRouter = new Hono();

// C3a: userId now comes from middleware context (trusted source), not path param.
// The :userId path segment is no longer used for identity.
dashboardRouter.get("/dashboard/:userId", async (c) => {
  // C3a: read from middleware context
  const userId = getContextUserId(c)!;
  try {
    const data = await calculateDashboard(userId);
    return c.json(data);
  } catch (error: any) {
    console.error("Dashboard error:", error);
    return c.json({ error: error.message }, 500);
  }
});

dashboardRouter.get("/growth/:userId", async (c) => {
  // C3a: read from middleware context (middleware always sets userId for /v1/* routes)
  const userId = getContextUserId(c)!;
  try {
    const profile = await GrowthRepo.getProfile(userId);
    return c.json(profile);
  } catch (error: any) { return c.json({ error: error.message }, 500); }
});

dashboardRouter.get("/cost-stats/:userId", async (c) => {
  const userId = getContextUserId(c)!;
  try {
    const stats = await DecisionRepo.getCostStats(userId);
    return c.json(stats);
  } catch (error: any) {
    console.error("Cost stats error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// G4: Delegation logs — list with pagination
dashboardRouter.get("/delegation-logs/:userId", async (c) => {
  const userId = getContextUserId(c)!;
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const offset = Number(c.req.query("offset") ?? "0");
  try {
    const logs = await DelegationLogRepo.listByUser(userId, limit, offset);
    return c.json({ logs, limit, offset });
  } catch (error: any) {
    console.error("Delegation logs error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// G4: Delegation benchmark — aggregate stats for dashboard
dashboardRouter.get("/delegation-stats/:userId", async (c) => {
  const userId = getContextUserId(c)!;
  try {
    const [metrics, rerankStats, actionDist] = await Promise.all([
      DelegationLogRepo.getBenchmarkMetrics(userId),
      DelegationLogRepo.getRerankStats(userId),
      DelegationLogRepo.getActionStats(userId, "routed_action"),
    ]);
    return c.json({ metrics, rerankStats, actionDistribution: actionDist });
  } catch (error: any) {
    console.error("Delegation stats error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export { dashboardRouter };
