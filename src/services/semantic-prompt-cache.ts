/**
 * Prompt 语义缓存 - Stream V2
 * 基于关键词相似度的 Prompt 缓存
 * 当相似 Prompt (相似度 > 0.8) 命中时，返回缓存结果
 */

import { createHash } from "crypto";

export interface CachedPrompt {
  hash: string;
  response: string;
  model: string;
  timestamp: number;
  hitCount: number;
  keywords: string[];
}

export interface SimilarityResult {
  similarity: number;
  cached: CachedPrompt | null;
}

/**
 * 提取文本关键词（简单分词 + 停用词过滤）
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
    "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
    "自己", "这", "那", "他", "她", "它", "们", "这个", "那个", "什么", "怎么",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "it", "this",
    "that", "what", "which", "who", "whom", "how", "and", "or", "but",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));

  return [...new Set(words)];
}

/**
 * 计算两个关键词集合的 Jaccard 相似度
 */
function calculateKeywordSimilarity(keywords1: string[], keywords2: string[]): number {
  if (keywords1.length === 0 && keywords2.length === 0) return 1;
  if (keywords1.length === 0 || keywords2.length === 0) return 0;

  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);

  let intersection = 0;
  for (const word of set1) {
    if (set2.has(word)) intersection++;
  }

  const union = set1.size + set2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * 计算两个文本的相似度（综合多种方法）
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);

  // Jaccard 相似度
  const jaccard = calculateKeywordSimilarity(keywords1, keywords2);

  // 长度相似度
  const len1 = text1.length;
  const len2 = text2.length;
  const lengthSimilarity = len1 > 0 && len2 > 0 ? 1 - Math.abs(len1 - len2) / Math.max(len1, len2) : 0;

  // 加权平均
  return jaccard * 0.7 + lengthSimilarity * 0.3;
}

/**
 * 生成 Prompt 的哈希值
 */
function hashPrompt(prompt: string): string {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex").substring(0, 16);
}

/**
 * 语义 Prompt 缓存
 * 使用 Redis 作为底层存储
 */
export class SemanticPromptCache {
  private redis: import("redis").RedisClientType | null = null;
  private redisUrl: string;
  private ttl: number;
  private similarityThreshold: number;

  constructor(options?: {
    redisUrl?: string;
    ttl?: number;
    similarityThreshold?: number;
  }) {
    this.redisUrl = options?.redisUrl || process.env.REDIS_URL || "redis://localhost:6379";
    this.ttl = options?.ttl || 300; // 5 分钟
    this.similarityThreshold = options?.similarityThreshold || 0.8; // 80% 相似度阈值
  }

  private async getRedis(): Promise<import("redis").RedisClientType | null> {
    if (this.redis?.isOpen) return this.redis;

    try {
      const { createClient } = await import("redis");
      this.redis = createClient({ url: this.redisUrl });
      this.redis.on("error", (err) => console.warn("[SemanticPromptCache] Redis error:", err.message));
      await this.redis.connect();
      return this.redis;
    } catch (error) {
      console.warn("[SemanticPromptCache] Redis connection failed:", error);
      return null;
    }
  }

  private getCacheKey(hash: string): string {
    return `semantic_prompt:${hash}`;
  }

  private getIndexKey(keyword: string): string {
    return `semantic_prompt:index:${keyword}`;
  }

  /**
   * 查找相似的缓存 Prompt
   */
  async findSimilar(prompt: string): Promise<SimilarityResult> {
    const redis = await this.getRedis();
    if (!redis) return { similarity: 0, cached: null };

    const keywords = extractKeywords(prompt);
    const targetHash = hashPrompt(prompt);

    // 1. 先检查精确匹配
    const exactKey = this.getCacheKey(targetHash);
    const exact = await redis.get(exactKey);
    if (exact) {
      const cached = JSON.parse(exact) as CachedPrompt;
      return { similarity: 1.0, cached };
    }

    // 2. 如果没有精确匹配，检查关键词相似
    if (keywords.length === 0) {
      return { similarity: 0, cached: null };
    }

    // 查找共享关键词的缓存
    let bestSimilarity = 0;
    let bestCached: CachedPrompt | null = null;

    // 限制搜索范围，避免过度扫描
    const searchLimit = 20;
    let searched = 0;

    for (const keyword of keywords.slice(0, 5)) {
      // 只取前5个关键词
      const indexKey = this.getIndexKey(keyword);
      const hashes = await redis.sMembers(indexKey);

      for (const hash of hashes) {
        if (searched >= searchLimit) break;
        searched++;

        if (hash === targetHash) continue; // 跳过精确匹配

        const cachedKey = this.getCacheKey(hash);
        const data = await redis.get(cachedKey);
        if (!data) continue;

        try {
          const cached = JSON.parse(data) as CachedPrompt;
          const similarity = calculateTextSimilarity(prompt, cached.hash + ":" + cached.keywords.join(","));

          // 重新计算相似度（基于当前 prompt 和缓存的关键词）
          const cachedText = cached.keywords.join(" ");
          const currentText = keywords.join(" ");
          const actualSimilarity = calculateTextSimilarity(currentText, cachedText);

          if (actualSimilarity > bestSimilarity && actualSimilarity >= this.similarityThreshold) {
            bestSimilarity = actualSimilarity;
            bestCached = cached;
          }
        } catch {
          continue;
        }
      }

      if (searched >= searchLimit) break;
    }

    return { similarity: bestSimilarity, cached: bestCached };
  }

  /**
   * 存储 Prompt 和响应
   */
  async set(prompt: string, response: string, model: string): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) return;

    const hash = hashPrompt(prompt);
    const keywords = extractKeywords(prompt);
    const cacheKey = this.getCacheKey(hash);

    const cached: CachedPrompt = {
      hash,
      response,
      model,
      timestamp: Date.now(),
      hitCount: 0,
      keywords,
    };

    // 存储缓存数据
    await redis.setEx(cacheKey, this.ttl, JSON.stringify(cached));

    // 更新关键词索引
    for (const keyword of keywords) {
      const indexKey = this.getIndexKey(keyword);
      await redis.sAdd(indexKey, hash);
      // 设置索引过期时间（比缓存 TTL 稍长）
      await redis.expire(indexKey, this.ttl + 60);
    }
  }

  /**
   * 增加缓存命中计数
   */
  async incrementHitCount(hash: string): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) return;

    const cacheKey = this.getCacheKey(hash);
    const data = await redis.get(cacheKey);
    if (data) {
      const cached = JSON.parse(data) as CachedPrompt;
      cached.hitCount++;
      await redis.setEx(cacheKey, this.ttl, JSON.stringify(cached));
    }
  }

  /**
   * 清除所有缓存
   */
  async clear(): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) return;

    const keys = await redis.keys("semantic_prompt:*");
    if (keys.length > 0) {
      await redis.del(keys);
    }
  }
}

// 全局单例
export const semanticPromptCache = new SemanticPromptCache();
