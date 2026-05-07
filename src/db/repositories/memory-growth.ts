import { v4 as uuid } from "uuid";
import { query } from "../connection.js";
import { GROWTH_LEVELS } from "../../config.js";
import type { BehavioralMemory, IdentityMemory, GrowthProfile, MemoryEntry, MemoryEntryInput, MemoryEntryUpdate } from "../../types/index.js";
import { getEmbedding } from "../../services/embedding.js";
import { DecisionRepo } from "./decision-feedback.js";

// ── MemoryRepo ────────────────────────────────────────────────────────────────

export const MemoryRepo = {
  async getIdentity(userId: string): Promise<IdentityMemory | null> {
    const result = await query(`SELECT * FROM identity_memories WHERE user_id=$1`, [userId]);
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      user_id: r.user_id,
      response_style: r.response_style,
      expertise_level: r.expertise_level,
      domains: r.domains || [],
      quality_sensitivity: r.quality_sensitivity,
      cost_sensitivity: r.cost_sensitivity,
      preferred_fast_model: r.preferred_fast_model,
      preferred_slow_model: r.preferred_slow_model,
      updated_at: new Date(r.updated_at).getTime(),
    };
  },

  async upsertIdentity(mem: Partial<IdentityMemory> & { user_id: string }): Promise<void> {
    await query(
      `INSERT INTO identity_memories (user_id, response_style, expertise_level, domains, quality_sensitivity, cost_sensitivity)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         response_style = COALESCE($2, identity_memories.response_style),
         expertise_level = COALESCE($3, identity_memories.expertise_level),
         domains = COALESCE($4, identity_memories.domains),
         quality_sensitivity = COALESCE($5, identity_memories.quality_sensitivity),
         cost_sensitivity = COALESCE($6, identity_memories.cost_sensitivity),
         updated_at = NOW()`,
      [
        mem.user_id,
        mem.response_style || "balanced",
        mem.expertise_level || "intermediate",
        mem.domains || [],
        mem.quality_sensitivity ?? 0.5,
        mem.cost_sensitivity ?? 0.5,
      ]
    );
  },

  async getBehavioralMemories(userId: string): Promise<BehavioralMemory[]> {
    const result = await query(
      `SELECT * FROM behavioral_memories WHERE user_id=$1 AND strength > 0.1 ORDER BY strength DESC LIMIT 50`,
      [userId]
    );
    return result.rows.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      trigger_pattern: r.trigger_pattern,
      observation: r.observation,
      learned_action: r.learned_action,
      strength: r.strength,
      reinforcement_count: r.reinforcement_count,
      last_activated: new Date(r.last_activated || r.created_at).getTime(),
      source_decision_ids: r.source_decision_ids || [],
      created_at: new Date(r.created_at).getTime(),
    }));
  },

  async saveBehavioralMemory(mem: BehavioralMemory): Promise<void> {
    await query(
      `INSERT INTO behavioral_memories (id, user_id, trigger_pattern, observation, learned_action, strength, reinforcement_count, last_activated, source_decision_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        mem.id,
        mem.user_id,
        mem.trigger_pattern,
        mem.observation,
        mem.learned_action,
        mem.strength,
        mem.reinforcement_count,
        new Date(mem.last_activated).toISOString(),
        mem.source_decision_ids,
      ]
    );
  },

  async reinforceMemory(id: string, delta: number): Promise<void> {
    await query(
      `UPDATE behavioral_memories
       SET strength = LEAST(1.0, GREATEST(0.0, strength + $1)),
           reinforcement_count = reinforcement_count + 1,
           last_activated = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [delta, id]
    );
  },

  async decayMemories(): Promise<void> {
    await query(`UPDATE behavioral_memories SET strength = strength * 0.98 WHERE last_activated < NOW() - INTERVAL '7 days'`);
  },
};

// ── MemoryEntryRepo ────────────────────────────────────────────────────────────

function mapMemoryRow(r: any): MemoryEntry {
  return {
    id: r.id,
    user_id: r.user_id,
    category: r.category,
    content: r.content,
    importance: r.importance,
    tags: r.tags ?? [],
    source: r.source,
    relevance_score: r.relevance_score ?? 0.5,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

export const MemoryEntryRepo = {
  async create(data: MemoryEntryInput): Promise<MemoryEntry> {
    const id = uuid();
    // M2: default relevance_score based on source (manual=0.5, auto_learn=0.3)
    const relevanceScore = data.relevance_score ?? (data.source === "auto_learn" ? 0.3 : 0.5);
    const result = await query(
      `INSERT INTO memory_entries (id, user_id, category, content, importance, tags, source, relevance_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        data.user_id,
        data.category,
        data.content,
        data.importance ?? 3,
        data.tags ?? [],
        data.source ?? "manual",
        relevanceScore,
      ]
    );
    const entry = mapMemoryRow(result.rows[0]);

    // Sprint 25: Async fire-and-forget embedding generation
    setImmediate(async () => {
      try {
        const embedding = await getEmbedding(data.content);
        if (embedding) {
          const vectorStr = `[${embedding.join(",")}]`;
          await query(
            `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
            [vectorStr, id]
          );
        }
      } catch {
        // Silent fail: embedding is optional
      }
    });

    return entry;
  },

  async boostRecentAutoLearn(userId: string, windowMs: number = 300_000): Promise<void> {
    const since = new Date(Date.now() - windowMs).toISOString();
    await query(
      `UPDATE memory_entries
       SET relevance_score = LEAST(relevance_score + 0.3, 1.0)
       WHERE user_id = $1 AND source = 'auto_learn' AND created_at > $2`,
      [userId, since]
    );
  },

  async searchByVector(
    userId: string,
    queryEmbedding: number[],
    limit: number = 20,
    category?: string
  ): Promise<Array<MemoryEntry & { similarity: number }>> {
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const params: unknown[] = [userId, vectorStr, limit];
    let categoryClause = "";

    if (category) {
      params.push(category);
      categoryClause = `AND category = $${params.length}`;
    }

    const result = await query(
      `SELECT *,
              1 - (embedding <=> $2::vector) AS similarity
       FROM memory_entries
       WHERE user_id = $1 AND embedding IS NOT NULL
         ${categoryClause}
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      params
    );

    return result.rows.map((r: any) => ({
      ...mapMemoryRow(r),
      similarity: parseFloat(r.similarity),
    }));
  },

  async getById(id: string, userId: string): Promise<MemoryEntry | null> {
    const result = await query(
      `SELECT * FROM memory_entries WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (result.rows.length === 0) return null;
    return mapMemoryRow(result.rows[0]);
  },

  async list(
    userId: string,
    opts?: { category?: string; limit?: number }
  ): Promise<MemoryEntry[]> {
    let sql = `SELECT * FROM memory_entries WHERE user_id=$1`;
    const params: any[] = [userId];
    if (opts?.category) {
      sql += ` AND category=$2`;
      params.push(opts.category);
    }
    sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
    params.push(opts?.limit ?? 100);
    const result = await query(sql, params);
    return result.rows.map(mapMemoryRow);
  },

  async update(
    id: string,
    userId: string,
    data: MemoryEntryUpdate
  ): Promise<MemoryEntry | null> {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (data.content !== undefined) {
      sets.push(`content=$${idx++}`);
      params.push(data.content);
    }
    if (data.importance !== undefined) {
      sets.push(`importance=$${idx++}`);
      params.push(data.importance);
    }
    if (data.tags !== undefined) {
      sets.push(`tags=$${idx++}`);
      params.push(data.tags);
    }
    if (data.category !== undefined) {
      sets.push(`category=$${idx++}`);
      params.push(data.category);
    }
    if (sets.length === 0) return this.getById(id, userId);
    sets.push(`updated_at=NOW()`);
    params.push(id, userId);
    const result = await query(
      `UPDATE memory_entries SET ${sets.join(", ")} WHERE id=$${idx++} AND user_id=$${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return null;
    return mapMemoryRow(result.rows[0]);
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM memory_entries WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async getTopForUser(userId: string, limit: number): Promise<MemoryEntry[]> {
    const result = await query(
      `SELECT * FROM memory_entries
       WHERE user_id=$1
       ORDER BY importance DESC, updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapMemoryRow);
  },

  async findRecent(userId: string, category: string, days: number): Promise<MemoryEntry[]> {
    const result = await query(
      `SELECT * FROM memory_entries
       WHERE user_id=$1 AND category=$2
         AND created_at > NOW() - ($3 || ' days')::INTERVAL
       ORDER BY created_at DESC`,
      [userId, category, days]
    );
    return result.rows.map(mapMemoryRow);
  },
};

// ── GrowthRepo ────────────────────────────────────────────────────────────────

export const GrowthRepo = {
  async getProfile(userId: string): Promise<GrowthProfile> {
    const stats = await DecisionRepo.getTodayStats(userId);
    const history = await DecisionRepo.getRoutingAccuracyHistory(userId);
    const memories = await MemoryRepo.getBehavioralMemories(userId);

    const totalResult = await query(
      `SELECT COUNT(*)::int as total FROM decision_logs WHERE user_id=$1`,
      [userId]
    );
    const totalInteractions = totalResult.rows[0]?.total || 0;

    let currentLevel = GROWTH_LEVELS[0];
    for (const lvl of GROWTH_LEVELS) {
      if (totalInteractions >= lvl.min_interactions) currentLevel = lvl;
    }
    const nextLevel = GROWTH_LEVELS.find((l) => l.level === currentLevel.level + 1) || currentLevel;
    const progress =
      nextLevel === currentLevel
        ? 100
        : Math.round(
            ((totalInteractions - currentLevel.min_interactions) /
              (nextLevel.min_interactions - currentLevel.min_interactions)) *
              100
          );

    const savedResult = await query(
      `SELECT COALESCE(SUM(cost_saved_vs_slow), 0)::float as total FROM decision_logs WHERE user_id=$1`,
      [userId]
    );
    const total_saved_usd = savedResult.rows[0]?.total || 0;
    const milestonesResult = await query(
      `SELECT title, created_at FROM growth_milestones WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );

    const recentMemories = memories
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 5);

    return {
      user_id: userId,
      level: currentLevel.level,
      level_name: currentLevel.name,
      level_progress: progress,
      routing_accuracy: stats.satisfaction_rate || 0,
      satisfaction_history: history,
      cost_saving_rate:
        stats.total_cost > 0
          ? Math.round((stats.saved_cost / (stats.total_cost + stats.saved_cost)) * 100)
          : 0,
      total_saved_usd: total_saved_usd,
      satisfaction_rate: stats.satisfaction_rate || 0,
      total_interactions: totalInteractions,
      behavioral_memories_count: memories.length,
      milestones: milestonesResult.rows.map((r: any) => ({
        date: new Date(r.created_at).toISOString().split("T")[0],
        event: r.title,
      })),
      recent_learnings: recentMemories.map((m) => ({
        date: new Date(m.created_at).toISOString().split("T")[0],
        learning: m.observation,
      })),
    };
  },

  async addMilestone(
    userId: string,
    type: string,
    title: string,
    value?: number
  ): Promise<void> {
    await query(
      `INSERT INTO growth_milestones (id, user_id, milestone_type, title, metric_value) VALUES ($1, $2, $3, $4, $5)`,
      [uuid(), userId, type, title, value || null]
    );
  },
};
