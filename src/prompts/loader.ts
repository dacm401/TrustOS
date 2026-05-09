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
/**
 * 模块级缓存：避免每次请求都执行 await import()
 * 失效条件：MANAGER_PROMPT_VERSION 环境变量变更（服务重启即刷新，合理）
 */
let cachedModule: { buildManagerSystemPrompt: (...args: Parameters<typeof buildManagerSystemPrompt>) => string; MANAGER_PROMPT_VERSION: string } | null = null;
let cachedVersion: string | null = null;

async function getPromptModule() {
  const version = getManagerPromptVersion();
  if (cachedModule && cachedVersion === version) return cachedModule;

  const { buildManagerSystemPrompt, MANAGER_PROMPT_VERSION } = await import(
    `./manager/${version}.js`
  );
  cachedModule = { buildManagerSystemPrompt, MANAGER_PROMPT_VERSION };
  cachedVersion = version;
  return cachedModule;
}

export async function loadManagerPrompt(
  lang: "zh" | "en",
  crossSessionContext?: string,
  userMemories?: string,
): Promise<LoadedPrompt> {
  const version = getManagerPromptVersion();
  if (version !== "v4") {
    throw new Error(`Unknown manager prompt version: "${version}". Supported: v4`);
  }

  const mod = await getPromptModule();
  return {
    prompt: mod.buildManagerSystemPrompt(lang, crossSessionContext, userMemories),
    version: mod.MANAGER_PROMPT_VERSION,
  };
}
