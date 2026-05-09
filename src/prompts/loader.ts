/**
 * Unified Prompt loader.
 * Each subdirectory under src/prompts/ represents one category (e.g. manager/).
 * Each file inside is named {version}.ts (e.g. v4.ts).
 *
 * Usage:
 *   import { loadManagerPrompt } from "./loader.js";
 *   const { prompt, version } = await loadManagerPrompt(lang, context, memories);
 *   // 版本由 MANAGER_PROMPT_VERSION 环境变量控制（默认 v4）
 *
 * For synchronous access (when version is known at build time):
 *   import { buildManagerSystemPrompt } from "./manager/v4.js";
 */
export { buildManagerSystemPrompt } from "./manager/v4.js";
export { MANAGER_PROMPT_VERSION } from "./manager/v4.js";

import type { buildManagerSystemPrompt as BmspSig } from "./manager/v4.js";

/**
 * 从环境变量读取当前 Manager Prompt 版本。
 * 可在 .env 中通过 MANAGER_PROMPT_VERSION 设置（默认 v4）。
 */
export function getManagerPromptVersion(): string {
  return (process.env["MANAGER_PROMPT_VERSION"] as string) ?? "v4";
}

export interface LoadedPrompt {
  prompt: string;
  version: string;
}

// Module-level cache for dynamic imports
interface PromptModuleCache {
  buildManagerSystemPrompt: BmspSig;
  MANAGER_PROMPT_VERSION: string;
  timestamp: number;
}

let moduleCache: PromptModuleCache | null = null;
let moduleCacheVersion: string | null = null;
const MODULE_CACHE_TTL_MS = 60_000;

async function getPromptModule(version: string): Promise<PromptModuleCache> {
  const now = Date.now();
  if (moduleCache && moduleCacheVersion === version && now - moduleCache.timestamp < MODULE_CACHE_TTL_MS) {
    return moduleCache;
  }

  switch (version) {
    case "v4": {
      const mod = await import("./manager/v4.js");
      moduleCache = {
        buildManagerSystemPrompt: mod.buildManagerSystemPrompt as BmspSig,
        MANAGER_PROMPT_VERSION: mod.MANAGER_PROMPT_VERSION,
        timestamp: now,
      };
      moduleCacheVersion = version;
      return moduleCache;
    }
    default:
      throw new Error(`Unknown manager prompt version: "${version}". Supported: v4`);
  }
}

/**
 * Invalidate the module-level prompt cache.
 * Call this when MANAGER_PROMPT_VERSION changes at runtime.
 */
export function invalidatePromptCache(): void {
  moduleCache = null;
  moduleCacheVersion = null;
}

/**
 * Load a Manager prompt using the version from MANAGER_PROMPT_VERSION env var.
 * Falls back to "v4" if the env var is not set.
 *
 * Usage:
 *   const { prompt, version } = await loadManagerPrompt("zh", context, memories);
 */
export async function loadManagerPrompt(
  lang: "zh" | "en",
  crossSessionContext?: string,
  userMemories?: string,
): Promise<LoadedPrompt> {
  const version = getManagerPromptVersion();
  const mod = await getPromptModule(version);
  return {
    prompt: mod.buildManagerSystemPrompt(lang, crossSessionContext, userMemories),
    version: mod.MANAGER_PROMPT_VERSION,
  };
}
