import { createClient, type RedisClientType } from 'redis';
import { createHash } from 'crypto';

export type CacheKey = 
  | 'prompt' 
  | 'session_summary' 
  | 'dashboard_stats' 
  | 'memory_entries';

export interface CacheServiceConfig {
  url: string;
  ttl?: {
    prompt: number;
    session_summary: number;
    dashboard_stats: number;
    memory_entries: number;
  };
}

export class CacheService {
  private client: RedisClientType | null = null;
  private config: CacheServiceConfig;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(config?: Partial<CacheServiceConfig>) {
    this.config = {
      url: config?.url || process.env.REDIS_URL || 'redis://localhost:6379',
      ttl: {
        prompt: 300, // 5 分钟
        session_summary: 600, // 10 分钟
        dashboard_stats: 60, // 1 分钟
        memory_entries: 120, // 2 分钟
        ...config?.ttl,
      },
    };
  }

  private async ensureConnection(): Promise<void> {
    if (this.connected) return;
    
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      try {
        this.client = createClient({ url: this.config.url });
        
        this.client.on('error', (err) => {
          console.warn('Redis Client Error:', err.message);
          this.connected = false;
        });

        this.client.on('connect', () => {
          console.log('✅ Redis connected:', this.config.url);
          this.connected = true;
        });

        await this.client.connect();
      } catch (error) {
        console.warn('⚠️  Redis connection failed, cache disabled:', error instanceof Error ? error.message : error);
        this.connected = false;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureConnection();
    
    if (!this.client || !this.connected) {
      return null;
    }

    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.warn('Cache GET error:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    await this.ensureConnection();

    if (!this.client || !this.connected) {
      return false;
    }

    try {
      const ttl = ttlSeconds ?? 300;
      await this.client.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('Cache SET error:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    await this.ensureConnection();

    if (!this.client || !this.connected) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.warn('Cache DEL error:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    await this.ensureConnection();

    if (!this.client || !this.connected) {
      return keys.map(() => null);
    }

    try {
      const results = await this.client.mGet(keys);
      return results.map((data) => (data ? JSON.parse(data) : null));
    } catch (error) {
      console.warn('Cache MGET error:', error instanceof Error ? error.message : error);
      return keys.map(() => null);
    }
  }

  async invalidate(pattern: string): Promise<number> {
    await this.ensureConnection();

    if (!this.client || !this.connected) {
      return 0;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return keys.length;
    } catch (error) {
      console.warn('Cache invalidate error:', error instanceof Error ? error.message : error);
      return 0;
    }
  }

  async health(): Promise<{
    status: 'ok' | 'error';
    latency_ms: number | null;
  }> {
    if (!this.client || !this.connected) {
      return { status: 'error', latency_ms: null };
    }

    try {
      const start = Date.now();
      await this.client.ping();
      return {
        status: 'ok',
        latency_ms: Date.now() - start,
      };
    } catch (error) {
      return { status: 'error', latency_ms: null };
    }
  }

  makeKey(prefix: CacheKey, ...parts: (string | number | undefined)[]): string {
    const filtered = parts.filter(Boolean).map(String);
    if (filtered.length === 0) {
      return prefix;
    }
    return `${prefix}:${filtered.join(':')}`;
  }

  hashKey(...parts: string[]): string {
    const key = parts.join(':');
    return createHash('sha256').update(key).digest('hex');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
      this.client = null;
    }
  }
}

// Single instance for the application
export const cache = new CacheService();
