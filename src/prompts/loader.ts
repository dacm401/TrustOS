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
  switch (version) {
    case "v4": {
      const { buildManagerSystemPrompt: fn, MANAGER_PROMPT_VERSION } = await import(
        "./manager/v4.js"
      );
      return {
        prompt: fn(lang, crossSessionContext, userMemories),
        version: MANAGER_PROMPT_VERSION,
      };
    }
    default:
      throw new Error(`Unknown manager prompt version: "${version}". Supported: v4`);
  }
}
