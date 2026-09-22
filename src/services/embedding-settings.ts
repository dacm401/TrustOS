/**
 * User-configurable embedding settings (RFC-001 Phase 3 — local RAG model).
 *
 * Stored as a JSON file under the TrustOS data dir (.trustos/embedding-settings.json),
 * keyed by user_id. This fits the local-OS, single-user product model: no DB
 * migration, fail-open, and consistent with the .trustos/ event backbone.
 *
 * The embedding service resolves the *effective* config by overlaying the user's
 * setting on top of the static env config (config.embedding). When the user picks
 * provider "local" (an OpenAI-compatible /v1/embeddings endpoint they host), the
 * retrieval layer uses their machine's model instead of a cloud embedding API —
 * unlocking RFC-001 Phase 3 RAG without sending memory to a cloud embedder.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";
import type { EmbeddingConfig } from "./embedding.js";

function settingsPath(): string {
  return (
    process.env.TRUSTOS_EMBEDDING_SETTINGS_PATH ||
    `${dirname(config.trustosEventLogPath || ".trustos/events.jsonl")}/embedding-settings.json`
  );
}

export type EmbeddingProviderSetting = "openai" | "siliconflow" | "local";

export interface EmbeddingUserSettings {
  provider: EmbeddingProviderSetting;
  /** Base URL of an OpenAI-compatible /v1 embeddings endpoint (for "local"). */
  baseUrl?: string;
  /** Optional; many local models need no key. */
  apiKey?: string;
  model: string;
  dimensions: number;
  enabled: boolean;
}

type Store = Record<string, EmbeddingUserSettings>;

// In-memory cache; invalidated on save. Avoids re-reading the file on every retrieval.
let cache: Store | null = null;

function loadStore(): Store {
  if (cache) return cache;
  try {
    if (existsSync(settingsPath())) {
      cache = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Store;
    } else {
      cache = {};
    }
  } catch {
    cache = {};
  }
  return cache!;
}

function persist(store: Store): void {
  cache = store;
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[embedding-settings] persist failed: ${(err as Error).message}`);
  }
}

export function getEmbeddingSettings(userId: string): EmbeddingUserSettings | null {
  return loadStore()[userId] ?? null;
}

export function saveEmbeddingSettings(userId: string, settings: EmbeddingUserSettings): void {
  const store = loadStore();
  store[userId] = settings;
  persist(store);
}

/**
 * Resolve the effective embedding config used by getEmbedding().
 *
 * TrustOS is a single-user local OS (multi-tenant explicitly excluded), so the
 * user's embedding setting is treated as the host-wide RAG model: the first
 * enabled user setting wins. This guarantees memory STORAGE and QUERY vectors
 * are always produced by the same model (dimension match), which vector
 * retrieval requires. Falls back to the static env config otherwise.
 */
export function resolveEffectiveEmbeddingConfig(): EmbeddingConfig & { baseUrl?: string } {
  const env = config.embedding;
  const user = Object.values(loadStore()).find((s) => s.enabled);
  if (user) {
    return {
      provider: user.provider,
      apiKey: user.apiKey ?? env.apiKey,
      model: user.model,
      dimensions: user.dimensions,
      enabled: true,
      siliconflowApiKey: env.siliconflowApiKey,
      siliconflowBaseUrl: env.siliconflowBaseUrl,
      baseUrl: user.baseUrl,
    };
  }
  return {
    ...env,
    baseUrl: env.provider === "openai" ? (config.openaiBaseUrl || undefined) : undefined,
  };
}
