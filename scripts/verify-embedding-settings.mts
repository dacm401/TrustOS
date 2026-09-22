/**
 * Verify the user-configurable embedding settings (RFC-001 Phase 3 — local RAG).
 *
 * Run: npx tsx scripts/verify-embedding-settings.mts
 * Pure (no DB): exercises the file-backed store + resolver with a temp path.
 */

import { resolveEffectiveEmbeddingConfig, getEmbeddingSettings, saveEmbeddingSettings } from "../src/services/embedding-settings.js";
import { existsSync, unlinkSync } from "fs";

// Point the store at a temp file (env is read lazily by the store, so this works
// even though ESM imports are hoisted).
const TMP = ".trustos/verify-embedding-settings.tmp.json";
process.env.TRUSTOS_EMBEDDING_SETTINGS_PATH = TMP;
if (existsSync(TMP)) unlinkSync(TMP);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n── 1. No user setting → env config wins ──────────────");
{
  const eff = resolveEffectiveEmbeddingConfig();
  check("enabled is boolean", typeof eff.enabled === "boolean");
  check("provider is a known value", ["openai", "siliconflow", "local"].includes(eff.provider), eff.provider);
}

console.log("\n── 2. User 'local' setting overrides env ─────────────");
{
  saveEmbeddingSettings("admin", {
    provider: "local",
    baseUrl: "http://localhost:11434/v1",
    model: "nomic-embed-text",
    dimensions: 768,
    enabled: true,
  });
  const eff = resolveEffectiveEmbeddingConfig();
  check("provider = local", eff.provider === "local", eff.provider);
  check("baseUrl = user address", eff.baseUrl === "http://localhost:11434/v1", eff.baseUrl);
  check("model = user model", eff.model === "nomic-embed-text", eff.model);
  check("dimensions = 768", eff.dimensions === 768, String(eff.dimensions));
  const got = getEmbeddingSettings("admin");
  check("round-trips via store", got?.baseUrl === "http://localhost:11434/v1");
}

console.log("\n── 3. Disabled setting falls back to env ─────────────");
{
  saveEmbeddingSettings("admin", {
    provider: "local",
    baseUrl: "http://localhost:11434/v1",
    model: "x",
    dimensions: 768,
    enabled: false,
  });
  const eff = resolveEffectiveEmbeddingConfig();
  check("disabled local is ignored (provider != local)", eff.provider !== "local", eff.provider);
}

if (existsSync(TMP)) unlinkSync(TMP);
console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
