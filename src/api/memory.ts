import { Hono } from "hono";
import { MemoryEntryRepo } from "../db/repositories.js";
import { recentInjections } from "../services/memory/injector.js";
import type { MemoryEntryInput, MemoryEntryUpdate } from "../types/index.js";
import { getContextUserId } from "../middleware/identity.js";

export const memoryRouter = new Hono();

const VALID_CATEGORIES = ["preference", "fact", "context", "instruction"] as const;
// "auto_learn" must be accepted here: the L0 distiller (RFC-001 Phase 1) writes
// entries with that source, and governance needs to be able to create/update
// them through this API too. It previously only worked because the distiller
// writes via the repository, bypassing this whitelist — leaving the API unable
// to represent a source the data model already allows.
const VALID_SOURCES = ["manual", "extracted", "feedback", "auto_learn"] as const;

// ADR-004 阶段 B0：敏感度白名单。
// 与 DB CHECK 约束、types/task.ts 的 MEMORY_SENSITIVITIES 保持一致。
// 在 API 层先拦一次，是为了返回清晰的 400 错误，而不是让调用方收到一个
// 来自数据库的约束违反异常。
const VALID_SENSITIVITIES = ["public", "internal", "sensitive", "restricted", "unknown"] as const;

function errorResp(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

// POST /v1/memory — create
memoryRouter.post("/", async (c) => {
  // C3a: userId from middleware context
  const userId = getContextUserId(c)!;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return errorResp(c, "Invalid JSON body", 400);
  }

  const { category, content, importance, tags, source, sensitivity } = body;

  if (!category || !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    return errorResp(c, `category is required and must be one of: ${VALID_CATEGORIES.join(" | ")}`, 400);
  }
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return errorResp(c, "content is required and must be a non-empty string", 400);
  }
  if (content.length > 2000) {
    return errorResp(c, "content exceeds 2000 character limit", 400);
  }
  if (importance !== undefined) {
    const imp = Number(importance);
    if (!Number.isInteger(imp) || imp < 1 || imp > 5) {
      return errorResp(c, "importance must be an integer between 1 and 5", 400);
    }
  }
  if (tags !== undefined && !Array.isArray(tags)) {
    return errorResp(c, "tags must be an array of strings", 400);
  }
  if (Array.isArray(tags) && tags.length > 10) {
    return errorResp(c, "maximum 10 tags per entry", 400);
  }
  if (Array.isArray(tags) && tags.some((t) => typeof t !== "string" || t.length > 50)) {
    return errorResp(c, "each tag must be a string of at most 50 characters", 400);
  }
  if (source !== undefined && !VALID_SOURCES.includes(source as typeof VALID_SOURCES[number])) {
    return errorResp(c, `source must be one of: ${VALID_SOURCES.join(" | ")}`, 400);
  }
  // ADR-004 阶段 B0：允许创建时指定敏感度。省略则由 Repo 层落为 'unknown'。
  if (
    sensitivity !== undefined &&
    !VALID_SENSITIVITIES.includes(sensitivity as typeof VALID_SENSITIVITIES[number])
  ) {
    return errorResp(c, `sensitivity must be one of: ${VALID_SENSITIVITIES.join(" | ")}`, 400);
  }

  const input: MemoryEntryInput = {
    user_id: userId,
    category: category as MemoryEntryInput["category"],
    content: (content as string).trim(),
    importance: importance !== undefined ? Number(importance) : undefined,
    tags: tags !== undefined ? (tags as string[]) : undefined,
    source: source !== undefined ? (source as MemoryEntryInput["source"]) : undefined,
    sensitivity: sensitivity !== undefined
      ? (sensitivity as MemoryEntryInput["sensitivity"])
      : undefined,
  };

  try {
    const entry = await MemoryEntryRepo.create(input);
    return c.json({ entry }, 201);
  } catch (err: any) {
    console.error("Memory create error:", err);
    return errorResp(c, err.message, 500);
  }
});

/**
 * Governance status is carried as a tag rather than a new column:
 * `status:pending` marks an auto-distilled entry awaiting user confirmation.
 * This keeps the schema unchanged and lets provenance tags live alongside it.
 */
export const PENDING_TAG = "status:pending";

// GET /v1/memory — list
memoryRouter.get("/", async (c) => {
  // C3a: userId from middleware context
  const userId = getContextUserId(c)!;
  const category = c.req.query("category") || undefined;
  // status=pending (awaiting confirmation) | active | all (default)
  const status = c.req.query("status") || "all";
  const limitRaw = c.req.query("limit");
  let limit = 50;
  if (limitRaw !== undefined) {
    const parsed = parseInt(limitRaw, 10);
    if (isNaN(parsed) || parsed < 1) {
      return errorResp(c, "limit must be a positive integer", 400);
    }
    limit = Math.min(parsed, 100);
  }

  try {
    const entries = await MemoryEntryRepo.list(userId, { category, limit });
    const filtered =
      status === "pending"
        ? entries.filter((e: any) => (e.tags ?? []).includes(PENDING_TAG))
        : status === "active"
          ? entries.filter((e: any) => !(e.tags ?? []).includes(PENDING_TAG))
          : entries;
    return c.json({ entries: filtered });
  } catch (err: any) {
    console.error("Memory list error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/memory/injections — what memory the recent turns actually used.
// Answers "why does it know that?" — the transparency half of governance.
memoryRouter.get("/injections", async (c) => {
  const userId = getContextUserId(c)!;
  const limitRaw = c.req.query("limit");
  const parsed = limitRaw === undefined ? 20 : parseInt(limitRaw, 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
  return c.json({ injections: recentInjections(userId, limit) });
});

// POST /v1/memory/:id/confirm — promote a pending entry to active.
// Removing the pending tag is what actually "activates" it: injection only
// considers active memory, so unconfirmed entries never reach the prompt.
memoryRouter.post("/:id/confirm", async (c) => {
  const id = c.req.param("id");
  const userId = getContextUserId(c)!;
  try {
    const entry = await MemoryEntryRepo.getById(id, userId);
    if (!entry) return errorResp(c, `Memory entry not found: ${id}`, 404);

    const tags = (entry.tags ?? []).filter((t: string) => t !== PENDING_TAG);
    // Confirmation is an implicit endorsement → nudge importance up (capped).
    const importance = Math.min(5, (entry.importance ?? 3) + 1);
    const updated = await MemoryEntryRepo.update(id, userId, { tags, importance });
    return c.json({ entry: updated });
  } catch (err: any) {
    console.error("Memory confirm error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/memory/governance — run MWT-6 governance engine over the user's memory.
// Reuses the REAL governance core (src/services/mwt6/memory-governance-core.ts);
// the frontend MemoryGovernanceSurface renders these records instead of fixtures.
// Mapping: MemoryEntry -> MemoryGovernanceInput (honest, source-typed defaults).
import { buildMemoryGovernanceRecord } from "../services/mwt6/memory-governance-core.js";

function mapEntryToGovernanceInput(entry: any): any {
  // MemoryEntry.category (preference/fact/context/instruction) maps to scope.
  const scope = entry.category ?? "user";
  // MemorySource (manual/extracted/feedback/auto_learn) maps to governance source.
  let source: string = entry.source ?? "user_input";
  if (source === "manual") source = "user_input";
  else if (source === "extracted" || source === "auto_learn") source = "assistant_output";
  else if (source === "feedback") source = "approval_review";
  // Importance 4–5 (or auto_learn) => long_term; else session.
  const retention = source === "assistant_output" && entry.source === "auto_learn"
    ? "long_term"
    : (entry.importance >= 4 ? "long_term" : "session");
  return {
    memory_id: entry.id,
    content_digest: entry.id, // placeholder digest; real hash requires content (kept server-side)
    scope,
    source,
    created_at: entry.created_at,
    created_by: entry.user_id,
    retention,
    // ADR-004 阶段 B0：此前硬编码为 "unknown"，使治理层的四级分类
    // （public/internal/sensitive/restricted）完全空转 —— 它永远只收到同一个值。
    // 现在读取真实字段；缺失仍按 unknown（未审阅）处理，保持默认拒绝。
    sensitivity: entry.sensitivity ?? "unknown",
    provenance_refs: entry.tags ?? [],
  };
}

memoryRouter.get("/governance", async (c) => {
  const userId = getContextUserId(c)!;
  try {
    // Pull a generous slice so governance reflects the real corpus.
    const entries = await MemoryEntryRepo.list(userId, { limit: 200 });
    const records = entries.map((e: any) =>
      buildMemoryGovernanceRecord(mapEntryToGovernanceInput(e))
    );
    const summary = {
      total: records.length,
      by_status: records.reduce((acc: Record<string, number>, r: any) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}),
    };
    return c.json({ summary, records });
  } catch (err: any) {
    console.error("Memory governance error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/memory/:id
// PUT  /v1/memory/:id
// DELETE /v1/memory/:id
memoryRouter
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    // C3a: userId from middleware context
    const userId = getContextUserId(c)!;
    try {
      const entry = await MemoryEntryRepo.getById(id, userId);
      if (!entry) return errorResp(c, `Memory entry not found: ${id}`, 404);
      return c.json({ entry });
    } catch (err: any) {
      console.error("Memory get error:", err);
      return errorResp(c, err.message, 500);
    }
  })
  .put("/:id", async (c) => {
    const id = c.req.param("id");
    // C3a: userId from middleware context
    const userId = getContextUserId(c)!;
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResp(c, "Invalid JSON body", 400);
    }

    const { content, importance, tags, category, sensitivity } = body;
    const update: MemoryEntryUpdate = {};

    if (content !== undefined) {
      if (typeof content !== "string" || content.trim().length === 0) {
        return errorResp(c, "content must be a non-empty string", 400);
      }
      if ((content as string).length > 2000) {
        return errorResp(c, "content exceeds 2000 character limit", 400);
      }
      update.content = (content as string).trim();
    }
    if (importance !== undefined) {
      const imp = Number(importance);
      if (!Number.isInteger(imp) || imp < 1 || imp > 5) {
        return errorResp(c, "importance must be an integer between 1 and 5", 400);
      }
      update.importance = imp;
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return errorResp(c, "tags must be an array of strings", 400);
      }
      if ((tags as string[]).length > 10) {
        return errorResp(c, "maximum 10 tags per entry", 400);
      }
      if ((tags as string[]).some((t) => typeof t !== "string" || t.length > 50)) {
        return errorResp(c, "each tag must be a string of at most 50 characters", 400);
      }
      update.tags = tags as string[];
    }
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
        return errorResp(c, `category must be one of: ${VALID_CATEGORIES.join(" | ")}`, 400);
      }
      update.category = category as MemoryEntryUpdate["category"];
    }
    // ADR-004 阶段 B0：允许用户重新标记敏感度（这是 B1 过滤的数据来源）。
    if (sensitivity !== undefined) {
      if (!VALID_SENSITIVITIES.includes(sensitivity as typeof VALID_SENSITIVITIES[number])) {
        return errorResp(
          c,
          `sensitivity must be one of: ${VALID_SENSITIVITIES.join(" | ")}`,
          400
        );
      }
      update.sensitivity = sensitivity as MemoryEntryUpdate["sensitivity"];
    }

    try {
      const entry = await MemoryEntryRepo.update(id, userId, update);
      if (!entry) return errorResp(c, `Memory entry not found: ${id}`, 404);
      return c.json({ entry });
    } catch (err: any) {
      console.error("Memory update error:", err);
      return errorResp(c, err.message, 500);
    }
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    // C3a: userId from middleware context
    const userId = getContextUserId(c)!;
    try {
      const deleted = await MemoryEntryRepo.delete(id, userId);
      if (!deleted) return errorResp(c, `Memory entry not found: ${id}`, 404);
      return c.body(null, 204);
    } catch (err: any) {
      console.error("Memory delete error:", err);
      return errorResp(c, err.message, 500);
    }
  });
