/**
 * Settings API — user-configurable embedding (local RAG model) for RFC-001 Phase 3.
 *
 * Routes (all under identity middleware, like the rest of /v1):
 *   GET  /v1/settings/embedding        → current setting (apiKey masked)
 *   PUT  /v1/settings/embedding        → upsert setting (provider/baseUrl/model/dimensions/apiKey)
 *   POST /v1/settings/embedding/validate → probe the endpoint, return ok + vector dims
 */

import { Hono } from "hono";
import { config } from "../config.js";
import { getContextUserId } from "../middleware/identity.js";
import {
  getEmbeddingSettings,
  saveEmbeddingSettings,
  type EmbeddingUserSettings,
  type EmbeddingProviderSetting,
} from "../services/embedding-settings.js";

export const settingsRouter = new Hono();

const VALID_PROVIDERS: EmbeddingProviderSetting[] = ["openai", "siliconflow", "local"];

function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  return key.length <= 4 ? "****" : `****${key.slice(-4)}`;
}

settingsRouter.get("/embedding", (c) => {
  const userId = getContextUserId(c)!;
  const s = getEmbeddingSettings(userId);
  if (!s) return c.json({ settings: null });
  return c.json({ settings: { ...s, apiKey: maskKey(s.apiKey) } });
});

settingsRouter.put("/embedding", async (c) => {
  const userId = getContextUserId(c)!;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { provider, baseUrl, apiKey, model, dimensions, enabled } = body;
  if (!VALID_PROVIDERS.includes(provider as EmbeddingProviderSetting)) {
    return c.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(" | ")}` }, 400);
  }
  if (provider === "local" && !baseUrl) {
    return c.json({ error: "local provider requires baseUrl (your model's /v1 base address)" }, 400);
  }
  if (!model || typeof model !== "string" || !model.trim()) {
    return c.json({ error: "model is required" }, 400);
  }
  const dims = Number(dimensions);
  if (!Number.isInteger(dims) || dims < 1 || dims > 8192) {
    return c.json({ error: "dimensions must be an integer between 1 and 8192" }, 400);
  }

  const settings: EmbeddingUserSettings = {
    provider: provider as EmbeddingProviderSetting,
    baseUrl: baseUrl ? String(baseUrl) : undefined,
    apiKey: apiKey ? String(apiKey) : undefined,
    model: String(model).trim(),
    dimensions: dims,
    enabled: enabled === undefined ? true : !!enabled,
  };
  saveEmbeddingSettings(userId, settings);
  return c.json({ settings: { ...settings, apiKey: maskKey(settings.apiKey) } });
});

settingsRouter.post("/embedding/validate", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { provider, baseUrl, apiKey, model, dimensions } = body;
  const prov = provider as EmbeddingProviderSetting;
  if (!VALID_PROVIDERS.includes(prov)) {
    return c.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(" | ")}` }, 400);
  }
  const url =
    `${(baseUrl ? String(baseUrl) : prov === "openai" ? config.openaiBaseUrl : "").replace(/\/$/, "")}/embeddings`;
  if (!/^https?:\/\//.test(url)) {
    return c.json({ ok: false, detail: "a valid http(s) baseUrl is required" }, 400);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${String(apiKey)}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model ? String(model) : "text-embedding-3-small",
        input: "ping",
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return c.json({ ok: false, status: res.status, detail: `HTTP ${res.status}` });
    }
    const data = (await res.json()) as { data?: { embedding: number[] }[] };
    const emb = data?.data?.[0]?.embedding;
    if (!Array.isArray(emb)) {
      return c.json({ ok: false, detail: "response missing embedding array" });
    }
    const got = emb.length;
    const expected = dimensions ? Number(dimensions) : undefined;
    return c.json({
      ok: true,
      dimensions: got,
      dimensionsMatch: expected === undefined ? true : got === expected,
    });
  } catch (err: any) {
    return c.json({ ok: false, detail: err?.message ?? "request failed" });
  }
});
