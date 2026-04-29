"use client";
import { useState, useEffect } from "react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [fastModel, setFastModel] = useState("");
  const [slowModel, setSlowModel] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLlmBaseUrl(localStorage.getItem("llm_base_url") || "");
      setApiKey(localStorage.getItem("api_key") || "");
      setFastModel(localStorage.getItem("fast_model") || "");
      setSlowModel(localStorage.getItem("slow_model") || "");
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem("llm_base_url", llmBaseUrl);
    localStorage.setItem("api_key", apiKey);
    localStorage.setItem("fast_model", fastModel);
    localStorage.setItem("slow_model", slowModel);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-800">模型设置</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LLM API 地址</label>
            <input
              type="text"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">支持任意 OpenAI 兼容接口</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">快模型（简单任务）</label>
            <input
              type="text"
              value={fastModel}
              onChange={(e) => setFastModel(e.target.value)}
              placeholder="qwen/qwen-2.5-72b-instruct"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">填写对应平台的模型 ID</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">慢模型（复杂任务）</label>
            <input
              type="text"
              value={slowModel}
              onChange={(e) => setSlowModel(e.target.value)}
              placeholder="qwen/qwen-2.5-72b-instruct"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
            <p className="font-medium mb-1">💡 配置示例（OpenRouter）</p>
            <p>API 地址：<code className="bg-blue-100 px-1 rounded">https://openrouter.ai/api/v1</code></p>
            <p>快/慢模型：<code className="bg-blue-100 px-1 rounded">qwen/qwen-2.5-72b-instruct</code></p>
            <p className="mt-1 font-medium">💡 配置示例（硅基流动）</p>
            <p>API 地址：<code className="bg-blue-100 px-1 rounded">https://api.siliconflow.cn/v1</code></p>
            <p>快/慢模型：<code className="bg-blue-100 px-1 rounded">Qwen/Qwen2.5-72B-Instruct</code></p>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              {saved ? "已保存!" : "保存设置"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
