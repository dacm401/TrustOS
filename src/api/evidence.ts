import { Hono } from "hono";
import { query } from "../db/connection.js";
import { EvidenceRepo } from "../db/repositories.js";
import type { EvidenceInput } from "../types/index.js";
import { getContextUserId } from "../middleware/identity.js";
import {
  buildEvidenceBundleFromLog,
  verifyBundleSignature,
  type EvidenceBundle,
} from "../services/trst1/evidence-bundle-service.js";

export const evidenceRouter = new Hono();

const VALID_SOURCES = ["web_search", "http_request", "manual"] as const;

function errorResp(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

// ── POST /v1/evidence/bundle/save — build, sign, and persist ────────────────
// Generation alone was not enough: a bundle that is never stored cannot be
// retrieved later, and "prove" implies being able to show it again.
evidenceRouter.post("/bundle/save", async (c) => {
  const userId = getContextUserId(c)!;
  let body: { trace_id?: string; session_id?: string } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const bundle = buildEvidenceBundleFromLog({
      traceId: body.trace_id,
      sessionId: body.session_id,
    });
    const result = await query(
      `INSERT INTO evidence_bundles
         (user_id, trace_id, session_id, schema_version, bundle, digest,
          signed, chain_valid, event_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, created_at`,
      [
        userId,
        body.trace_id ?? null,
        body.session_id ?? null,
        bundle.schema_version,
        JSON.stringify(bundle),
        bundle.signature?.digest ?? null,
        Boolean(bundle.signature?.signed),
        bundle.chain?.valid ?? null,
        bundle.trace?.event_count ?? 0,
      ],
    );
    return c.json(
      {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
        signed: bundle.signature?.signed ?? false,
        chain_valid: bundle.chain?.valid ?? null,
        event_count: bundle.trace?.event_count ?? 0,
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to save evidence bundle: ${message}` }, 500);
  }
});

// ── GET /v1/evidence/bundles — list persisted bundles (metadata only) ───────
evidenceRouter.get("/bundles", async (c) => {
  const userId = getContextUserId(c)!;
  const limitRaw = c.req.query("limit");
  const parsed = limitRaw === undefined ? 20 : parseInt(limitRaw, 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
  try {
    const result = await query(
      `SELECT id, trace_id, session_id, schema_version, digest, signed,
              chain_valid, event_count, created_at
         FROM evidence_bundles
        WHERE user_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return c.json({ bundles: result.rows }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to list evidence bundles: ${message}` }, 500);
  }
});

// ── GET /v1/evidence/bundles/:id — retrieve one for later re-verification ───
evidenceRouter.get("/bundles/:id", async (c) => {
  const id = c.req.param("id");
  const userId = getContextUserId(c)!;
  try {
    const result = await query(
      `SELECT * FROM evidence_bundles WHERE id=$1 AND user_id=$2`,
      [id, userId],
    );
    const row = result.rows[0];
    if (!row) return errorResp(c, `Evidence bundle not found: ${id}`, 404);
    return c.json(row, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to load evidence bundle: ${message}` }, 500);
  }
});

// ── GET /v1/evidence/bundle — signed, privacy-safe evidence bundle ──────────
// Server-side generation (previously built in the browser and never signed).
// Read-only over the Event Backbone; never mutates the log.
evidenceRouter.get("/bundle", async (c) => {
  try {
    const traceId = c.req.query("trace_id") || undefined;
    const sessionId = c.req.query("session_id") || undefined;
    const bundle = buildEvidenceBundleFromLog({ traceId, sessionId });
    return c.json(bundle, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to build evidence bundle: ${message}` }, 500);
  }
});

// ── POST /v1/evidence/bundle/verify — re-verify an issued bundle ────────────
// Lets a third party confirm the bundle was not altered after issuance.
evidenceRouter.post("/bundle/verify", async (c) => {
  let bundle: EvidenceBundle;
  try {
    bundle = (await c.req.json()) as EvidenceBundle;
  } catch {
    return errorResp(c, "Invalid JSON body", 400);
  }
  if (!bundle || bundle.schema_version !== "trstos-evidence-bundle/v1") {
    return errorResp(c, "Unsupported or missing bundle (expected trstos-evidence-bundle/v1)", 400);
  }
  return c.json(
    {
      valid: verifyBundleSignature(bundle),
      signed: Boolean(bundle.signature?.signed),
      algorithm: bundle.signature?.algorithm ?? null,
      reason: bundle.signature?.reason ?? null,
    },
    200,
  );
});

// POST /v1/evidence — create evidence record
evidenceRouter.post("/", async (c) => {
  // C3a: userId from middleware context
  const userId = getContextUserId(c)!;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return errorResp(c, "Invalid JSON body", 400);
  }

  const { task_id, source, content, source_metadata, relevance_score } = body;

  if (!task_id || typeof task_id !== "string") {
    return errorResp(c, "task_id is required and must be a non-empty string", 400);
  }
  if (!source || !VALID_SOURCES.includes(source as typeof VALID_SOURCES[number])) {
    return errorResp(c, `source is required and must be one of: ${VALID_SOURCES.join(" | ")}`, 400);
  }
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return errorResp(c, "content is required and must be a non-empty string", 400);
  }
  if (source_metadata !== undefined && typeof source_metadata !== "object") {
    return errorResp(c, "source_metadata must be an object or omitted", 400);
  }
  if (relevance_score !== undefined) {
    const score = Number(relevance_score);
    if (isNaN(score) || score < 0 || score > 1) {
      return errorResp(c, "relevance_score must be a number between 0 and 1", 400);
    }
  }

  const input: EvidenceInput = {
    task_id: task_id as string,
    user_id: userId,
    source: source as EvidenceInput["source"],
    content: (content as string).trim(),
    source_metadata: source_metadata as Record<string, unknown> | undefined,
    relevance_score: relevance_score !== undefined ? Number(relevance_score) : undefined,
  };

  try {
    const evidence = await EvidenceRepo.create(input);
    return c.json({ evidence }, 201);
  } catch (err: any) {
    console.error("Evidence create error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/evidence?task_id=xxx — list by task
// GET /v1/evidence/:id — get by id
evidenceRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const evidence = await EvidenceRepo.getById(id);
    if (!evidence) return errorResp(c, `Evidence not found: ${id}`, 404);
    return c.json({ evidence });
  } catch (err: any) {
    console.error("Evidence get error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/evidence?task_id=xxx
evidenceRouter.get("/", async (c) => {
  const taskId = c.req.query("task_id");
  if (taskId) {
    try {
      const records = await EvidenceRepo.listByTask(taskId);
      return c.json({ evidence: records });
    } catch (err: any) {
      console.error("Evidence listByTask error:", err);
      return errorResp(c, err.message, 500);
    }
  }
  // If no filter, require userId context (middleware always provides it)
  const userId = getContextUserId(c)!;
  const limitRaw = c.req.query("limit");
  let limit = 100;
  if (limitRaw !== undefined) {
    const parsed = parseInt(limitRaw, 10);
    if (isNaN(parsed) || parsed < 1) {
      return errorResp(c, "limit must be a positive integer", 400);
    }
    limit = Math.min(parsed, 500);
  }
  try {
    const records = await EvidenceRepo.listByUser(userId, limit);
    return c.json({ evidence: records });
  } catch (err: any) {
    console.error("Evidence listByUser error:", err);
    return errorResp(c, err.message, 500);
  }
});
