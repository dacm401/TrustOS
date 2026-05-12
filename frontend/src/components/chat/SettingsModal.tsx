"use client";
import { useState, useEffect } from "react";
import { getSecureApiKey, setSecureApiKey } from "@/lib/crypto-utils";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [fastModel, setFastModel] = useState("");
  const [slowModel, setSlowModel] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLlmBaseUrl(localStorage.getItem("llm_base_url") || "");
      setFastModel(localStorage.getItem("fast_model") || "");
      setSlowModel(localStorage.getItem("slow_model") || "");
      setSaved(false);
      getSecureApiKey().then((key) => {
        setApiKey(key || "");
        setHasExistingKey(!!key);
      });
    }
  }, [isOpen]);

  const handleSave = async () => {
    localStorage.setItem("llm_base_url", llmBaseUrl);
    localStorage.setItem("fast_model", fastModel);
    localStorage.setItem("slow_model", slowModel);
    await setSecureApiKey(apiKey);
    setHasExistingKey(!!apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 surface-overlay flex items-center justify-center z-50">
      <div
        className="surface-elevated rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: "0 25px 50px -12px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-primary">模型设置</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-primary transition-colors text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">
              LLM API 地址
            </label>
            <input
              type="text"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              className="w-full surface-card border border-subtle rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:ring-2 focus:ring-accent-blue focus:border-accent-blue outline-none transition-colors"
            />
            <p className="text-xs text-muted mt-1">支持任意 OpenAI 兼容接口</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary mb-1">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasExistingKey ? "••••••••••••（已加密存储）" : "sk-..."}
              className="w-full surface-card border border-subtle rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:ring-2 focus:ring-accent-blue focus:border-accent-blue outline-none transition-colors"
            />
            {hasExistingKey && (
              <p className="text-xs text-muted mt-1">
                已加密存储；留空则保持不变，修改则重新加密。
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary mb-1">
              快模型（简单任务）
            </label>
            <input
              type="text"
              value={fastModel}
              onChange={(e) => setFastModel(e.target.value)}
              placeholder="qwen/qwen-2.5-72b-instruct"
              className="w-full surface-card border border-subtle rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:ring-2 focus:ring-accent-blue focus:border-accent-blue outline-none transition-colors"
            />
            <p className="text-xs text-muted mt-1">填写对应平台的模型 ID</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary mb-1">
              慢模型（复杂任务）
            </label>
            <input
              type="text"
              value={slowModel}
              onChange={(e) => setSlowModel(e.target.value)}
              placeholder="qwen/qwen-2.5-72b-instruct"
              className="w-full surface-card border border-subtle rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted focus:ring-2 focus:ring-accent-blue focus:border-accent-blue outline-none transition-colors"
            />
          </div>

          <div className="surface-card rounded-lg p-3 text-xs text-secondary border border-subtle">
            <p className="font-medium mb-1">💡 配置示例（OpenRouter）</p>
            <p>
              API 地址：
              <code className="ml-1 px-1 py-0.5 rounded text-accent" style={{ background: "var(--bg-overlay)" }}>
                https://openrouter.ai/api/v1
              </code>
            </p>
            <p>
              快/慢模型：
              <code className="ml-1 px-1 py-0.5 rounded text-accent" style={{ background: "var(--bg-overlay)" }}>
                qwen/qwen-2.5-72b-instruct
              </code>
            </p>
            <p className="mt-1 font-medium">💡 配置示例（硅基流动）</p>
            <p>
              API 地址：
              <code className="ml-1 px-1 py-0.5 rounded text-accent" style={{ background: "var(--bg-overlay)" }}>
                https://api.siliconflow.cn/v1
              </code>
            </p>
            <p>
              快/慢模型：
              <code className="ml-1 px-1 py-0.5 rounded text-accent" style={{ background: "var(--bg-overlay)" }}>
                Qwen/Qwen2.5-72B-Instruct
              </code>
            </p>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 surface-card border border-subtle rounded-lg text-secondary hover:text-primary hover:border-default transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-accent-blue text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              {saved ? "已保存!" : "保存设置"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
