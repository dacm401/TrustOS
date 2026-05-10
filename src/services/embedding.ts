/**
 * Embedding Service — Sprint 25 / Cache: Sprint 76
 *
 * Provides semantic text embedding for vector-based memory retrieval.
 * Supports multiple providers with graceful fallback.
 *
 * Providers:
 * - OpenAI text-embedding-3-small (1536 dims, $0.02/1M tokens)
 * - SiliconFlow BAAI/bge-large-zh-v1.5 (1024 dims)
 *
 * Design principles:
 * - Fail-safe: any error returns null, caller must handle gracefully
 * - Configurable: provider/model/dimensions via env vars
 * - Rate-limit aware: input truncated to 8000 chars to prevent oversized requests
 * - Sprint 76: In-memory LRU cache — reduces API calls for repeated queries in the same session.
 *   key = sha256(model + ":" + text[:8000])
 *   Env vars: EMBEDDING_CACHE_ENABLED (default true), EMBEDDING_CACHE_TTL_SECONDS (default 3600),
 *             EMBEDDING_CACHE_MAX_SIZE (default 500)
 */

import { createHash } from "crypto";
import { config } from "../config.js";

// ── Lightweight LRU cache (no external dependency) ──────────────────────────

interface CacheEntry {
  value: number[];
  expiresAt: number;
}

class EmbeddingLRUCache {
  private map = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): number[] | null {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.misses++;
      return null;
    }
    // LRU: move to end
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: number[]): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first key in insertion order)
      this.map.delete(this.map.keys().next().value!);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  getStats() {
    return {
      size: this.map.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + "%"
        : "0%",
    };
  }
}

const CACHE_ENABLED = process.env.EMBEDDING_CACHE_ENABLED !== "false";
const CACHE_TTL_MS = parseInt(process.env.EMBEDDING_CACHE_TTL_SECONDS ?? "3600") * 1000;
const CACHE_MAX_SIZE = parseInt(process.env.EMBEDDING_CACHE_MAX_SIZE ?? "500");

const embeddingCache = new EmbeddingLRUCache(CACHE_MAX_SIZE, CACHE_TTL_MS);

/** Build cache key: sha256 of "model:text" (first 8000 chars) */
function buildCacheKey(model: string, text: string): string {
  return createHash("sha256")
    .update(model + ":" + text.slice(0, 8000))
    .digest("hex");
}

/** Export cache stats for health/debug endpoints */
export function getEmbeddingCacheStats() {
  return embeddingCache.getStats();
}

export interface EmbeddingConfig {
  provider: "openai" | "siliconflow";
  apiKey: string;
  model: string;
  dimensions: number;
  enabled: boolean;
  // SiliconFlow 专用配置
  siliconflowApiKey: string;
  siliconflowBaseUrl: string;
}

/**
 * Get embedding vector for text.
 * Returns null if embedding is disabled or any error occurs.
 * Sprint 76: results are cached in-memory (LRU, configurable TTL/size).
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!config.embedding?.enabled) {
    return null;
  }

  const model = config.embedding.model;

  // ── Cache lookup ──────────────────────────────────────────────────────────
  if (CACHE_ENABLED) {
    const key = buildCacheKey(model, text);
    const cached = embeddingCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const provider = config.embedding.provider;
      let result: number[] | null = null;

      if (provider === "openai") {
        result = await getOpenAIEmbedding(text, config.embedding);
      } else if (provider === "siliconflow") {
        result = await getSiliconFlowEmbedding(text, config.embedding);
      }

      if (result) {
        embeddingCache.set(key, result);
      }
      return result;
    } catch {
      return null;
    }
  }

  // ── Cache disabled: direct call ───────────────────────────────────────────
  try {
    const provider = config.embedding.provider;

    if (provider === "openai") {
      return await getOpenAIEmbedding(text, config.embedding);
    }

    if (provider === "siliconflow") {
      return await getSiliconFlowEmbedding(text, config.embedding);
    }

    return null;
  } catch {
    // Fail-safe: any error returns null
    return null;
  }
}

async function getOpenAIEmbedding(
  text: string,
  cfg: EmbeddingConfig
): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      input: text.slice(0, 8000),
      dimensions: cfg.dimensions,
    }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    data: { embedding: number[] }[];
  };
  return data.data[0]?.embedding ?? null;
}

async function getSiliconFlowEmbedding(
  text: string,
  cfg: EmbeddingConfig
): Promise<number[] | null> {
  // 优先用专用 siliconflowApiKey，否则降级到 apiKey
  const apiKey = cfg.siliconflowApiKey || cfg.apiKey;
  const baseUrl = cfg.siliconflowBaseUrl || "https://api.siliconflow.cn";
  const url = `${baseUrl}/v1/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      input: text.slice(0, 8000),
    }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    data: { embedding: number[] }[];
  };
  return data.data[0]?.embedding ?? null;
}

/**
 * Calculate cosine similarity between two vectors.
 * Returns 0-1 where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
