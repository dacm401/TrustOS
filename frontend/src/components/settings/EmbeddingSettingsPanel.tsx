"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchEmbeddingSettings,
  updateEmbeddingSettings,
  validateEmbeddingSettings,
  type EmbeddingProvider,
  type EmbeddingSettingsPayload,
} from "@/lib/api";

const DEV_FALLBACK = "dev-user";

/**
 * RFC-001 Phase 3 — lets the user point TrustOS's memory RAG at a local /
 * self-hosted OpenAI-compatible embedding endpoint. The saved setting is read
 * server-side by resolveEffectiveEmbeddingConfig() so memory storage + query
 * both use the user's model.
 */
export function EmbeddingSettingsPanel() {
  const { user } = useAuth();
  const userId = user?.username ?? DEV_FALLBACK;

  const [provider, setProvider] = useState<EmbeddingProvider>("local");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [dimensions, setDimensions] = useState("768");
  const [enabled, setEnabled] = useState(true);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const [validMsg, setValidMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEmbeddingSettings(userId)
      .then((r) => {
        if (cancelled || !r.settings) return;
        const s = r.settings;
        setProvider(s.provider);
        setBaseUrl(s.baseUrl ?? "");
        setApiKey(s.apiKey ?? "");
        setModel(s.model);
        setDimensions(String(s.dimensions));
        setEnabled(s.enabled !== false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const buildPayload = (): EmbeddingSettingsPayload => ({
    provider,
    baseUrl: baseUrl.trim() || undefined,
    apiKey: apiKey.trim() || undefined,
    model: model.trim(),
    dimensions: parseInt(dimensions, 10) || 0,
    enabled,
  });

  const handleSave = async () => {
    setLoading(true);
    setStatus(null);
    setValidMsg(null);
    try {
      const dims = parseInt(dimensions, 10);
      if (!model.trim()) throw new Error("模型名称必填");
      if (!Number.isInteger(dims) || dims < 1 || dims > 8192) {
        throw new Error("维度需为 1–8192 的整数");
      }
      if (provider === "local" && !baseUrl.trim()) {
        throw new Error("本地模型需填写接入地址 (baseUrl)");
      }
      const r = await updateEmbeddingSettings(userId, buildPayload());
      setStatus({
        kind: "ok",
        msg: `已保存（${r.settings?.provider} / ${r.settings?.model}）`,
      });
    } catch (e: any) {
      setStatus({ kind: "err", msg: e?.message ?? "保存失败" });
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidMsg(null);
    try {
      const r = await validateEmbeddingSettings(buildPayload(), userId);
      if (r.ok) {
        const mismatch = r.dimensionsMatch === false ? "（⚠ 维度与填写值不一致，请核对）" : "";
        setValidMsg(`✅ 连通成功，返回向量维度 ${r.dimensions}${mismatch}`);
      } else {
        setValidMsg(`❌ 探测失败：${r.detail ?? "未知错误"}`);
      }
    } catch (e: any) {
      setValidMsg(`❌ 探测失败：${e?.message ?? "未知错误"}`);
    } finally {
      setValidating(false);
    }
  };

  const inputCls =
    "w-full surface-card border border-subtle rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:ring-2 focus:ring-accent-blue focus:border-accent-blue outline-none transition-colors";

  return (
    <div className="surface-card rounded-lg p-4 border border-subtle">
      <h3 className="text-sm font-semibold text-primary mb-1">本地 RAG 嵌入模型</h3>
      <p className="text-xs text-muted mb-3">
        配置本地 / 自托管的 OpenAI 兼容嵌入端点（如 Ollama、vLLM、LM Studio）。
        保存后记忆检索将用你的模型生成向量，数据不出本机。
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}
            className={inputCls}
          >
            <option value="local">local（本地 / OpenAI 兼容）</option>
            <option value="openai">openai</option>
            <option value="siliconflow">siliconflow</option>
          </select>
        </div>

        {provider === "local" && (
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">
              接入地址 (baseUrl)
            </label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className={inputCls}
            />
            <p className="text-xs text-muted mt-1">例如 Ollama：http://localhost:11434/v1</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-secondary mb-1">模型</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="nomic-embed-text"
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-secondary mb-1">向量维度</label>
          <input
            value={dimensions}
            onChange={(e) => setDimensions(e.target.value)}
            placeholder="768"
            inputMode="numeric"
            className={inputCls}
          />
          <p className="text-xs text-muted mt-1">
            需与模型实际输出维度一致（如 nomic-embed-text = 768）
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-secondary mb-1">
            API Key（可选）
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="本地模型通常无需填写"
            className={inputCls}
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用该嵌入模型（关闭则回退到环境变量配置）
        </label>

        <div className="flex gap-3 pt-1">
          <button
            onClick={handleValidate}
            disabled={validating}
            className="px-3 py-2 surface-card border border-subtle rounded-lg text-secondary hover:text-primary hover:border-default transition-colors disabled:opacity-50 text-sm"
          >
            {validating ? "探测中…" : "测试连接"}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-3 py-2 bg-accent-blue text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 text-sm"
          >
            {loading ? "保存中…" : "保存"}
          </button>
        </div>

        {validMsg && (
          <p
            className="text-xs"
            style={{ color: validMsg.startsWith("✅") ? "var(--accent)" : "var(--accent-red)" }}
          >
            {validMsg}
          </p>
        )}
        {status && (
          <p
            className="text-xs"
            style={{ color: status.kind === "ok" ? "var(--accent)" : "var(--accent-red)" }}
          >
            {status.msg}
          </p>
        )}
      </div>
    </div>
  );
}
