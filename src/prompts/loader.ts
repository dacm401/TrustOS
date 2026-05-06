/**
 * Unified Prompt loader.
 * Each subdirectory under src/prompts/ represents one category (e.g. manager/).
 * Each file inside is named {version}.ts (e.g. v4.ts).
 *
 * Usage:
 *   import { loadManagerPrompt } from "./loader.js";
 *   const { prompt, version } = await loadManagerPrompt("v4", "zh", context, memories);
 *
 * For synchronous access (when version is known at build time):
 *   import { buildManagerSystemPrompt } from "./manager/v4.js";
 */
export { buildManagerSystemPrompt } from "./manager/v4.js";
export { MANAGER_PROMPT_VERSION } from "./manager/v4.js";

import type { buildManagerSystemPrompt as BmspSig } from "./manager/v4.js";

export interface LoadedPrompt {
  prompt: string;
  version: string;
}

/**
 * Load a Manager prompt by version string.
 * Currently only "v4" is supported.
 */
export async function loadManagerPrompt(
  version: string,
  lang: "zh" | "en",
  crossSessionContext?: string,
  userMemories?: string,
): Promise<LoadedPrompt> {
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
