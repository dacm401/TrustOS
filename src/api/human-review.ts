/**
 * S78P: Human Review Resolution API
 *
 * POST /v1/human-review/:id/resolve  — 处置一个 pending 请求
 * GET  /v1/human-review/:id         — 查询单个请求
 * GET  /v1/human-review             — 列举请求（支持 ?status=pending）
 */

import { Hono } from "hono";
import {
  resolveHumanReviewRequest,
  createHumanReviewRequestFromCycle,
  buildHumanReviewResolutionEvent,
  buildHumanReviewResumeDecision,
  createOrGetResumeDecision,
} from "../services/human-review/human-review-service.js";
import { HumanReviewRequestRepo } from "../db/human-review-repo.js";
import { HumanReviewResumeDecisionRepo } from "../db/human-review-decision-repo.js";
import type {
  HumanReviewResolution,
  HumanReviewResolutionEvent,
} from "../services/human-review/human-review-types.js";

const hrRouter = new Hono();

// ── POST /v1/human-review/:id/resolve ───────────────────────────────────────

hrRouter.post("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const rawBody = await c.req.raw.text();

  let body: { action: string; note?: string; resolvedBy?: string };
  try {
    body = JSON.parse(rawBody) as { action: string; note?: string; resolvedBy?: string };
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const validActions = ["accept", "revise", "rewrite", "block"] as const;
  if (!validActions.includes(body.action as (typeof validActions)[number])) {
    return c.json(
      { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
      400
    );
  }

  let resolved;
  try {
    const resolution: HumanReviewResolution = {
      action: body.action as HumanReviewResolution["action"],
      note: body.note,
      resolvedBy: body.resolvedBy,
    };
    resolved = await resolveHumanReviewRequest(id, resolution);
  } catch (err: any) {
    if (err.message.includes("not found")) {
      return c.json({ error: err.message }, 404);
    }
    if (err.message.includes("not pending")) {
      return c.json({ error: err.message }, 409);
    }
    return c.json({ error: err.message }, 500);
  }

  const event: HumanReviewResolutionEvent = buildHumanReviewResolutionEvent(
    resolved,
    "pending"
  );

  return c.json({ request: resolved, event }, 200);
});

// ── GET /v1/human-review/:id ─────────────────────────────────────────────────

hrRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const req = await HumanReviewRequestRepo.getById(id);
  if (!req) {
    return c.json({ error: `HumanReviewRequest ${id} not found` }, 404);
  }
  return c.json({ request: req }, 200);
});

// ── GET /v1/human-review ─────────────────────────────────────────────────────

hrRouter.get("/", async (c) => {
  const status = c.req.query("status") as
    | "pending"
    | "approved"
    | "rejected"
    | "needs_revision"
    | "cancelled"
    | undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;

  const requests = await HumanReviewRequestRepo.list({ status, limit });
  return c.json({ requests }, 200);
});

// ── GET /v1/human-review/:id/resume-decision ──────────────────────────────

hrRouter.get("/:id/resume-decision", async (c) => {
  const id = c.req.param("id");
  const req = await HumanReviewRequestRepo.getById(id);
  if (!req) {
    return c.json({ error: `HumanReviewRequest ${id} not found` }, 404);
  }
  if (req.status === "pending") {
    return c.json(
      { error: `HumanReviewRequest ${id} is still pending, cannot generate resume decision` },
      409
    );
  }

  // S80P: 使用持久化 decision（幂等 create-or-get）
  const decision = await createOrGetResumeDecision(req);
  return c.json({ request: req, decision }, 200);
});

// ── GET /v1/human-review/:id/resume-decision/:decisionId ──────────────────
// S80P: 直接按 decision ID 查询（不依赖 review request 状态）

hrRouter.get("/:id/resume-decision/:decisionId", async (c) => {
  const decisionId = c.req.param("decisionId");
  const decision = await HumanReviewResumeDecisionRepo.getById(decisionId);
  if (!decision) {
    return c.json({ error: `ResumeDecision ${decisionId} not found` }, 404);
  }
  return c.json({ decision }, 200);
});

export { hrRouter };
