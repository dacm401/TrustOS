"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { routeManagerMessage, fetchManagerMessages, createManagerMessage } from "@/lib/api";
import { ExecutionMetadata } from "@/components/chat/ExecutionMetadata";
import type { ManagerMessage, RouteMessageResponse, UsageInfo, ExecutionProgress } from "@/types/dashboard";

interface DisplayMessage {
  id: string;
  role: "user" | "manager" | "system";
  content: string;
  relatedSessionId?: string;
  createdAt: string;
  /** S101P Phase B: execution metadata — gracefully hidden when absent */
  usage?: UsageInfo;
  terminalSummary?: unknown;
  executionProgress?: ExecutionProgress;
}

interface ManagerConversationProps {
  userId: string;
  conversationId: string;
  onSessionCreated?: (sessionId: string) => void;
  onSessionUpdated?: (sessionId: string) => void;
  onSelectSession?: (sessionId: string) => void;
}

export function ManagerConversation({
  userId,
  conversationId,
  onSessionCreated,
  onSessionUpdated,
  onSelectSession,
}: ManagerConversationProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load existing messages on mount
  useEffect(() => {
    let cancelled = false;
    setInitLoading(true);
    fetchManagerMessages(userId, conversationId, 100)
      .then((data) => {
        if (cancelled) return;
        const list: ManagerMessage[] = data.messages ?? [];
        setMessages(
          list.map((m) => ({
            id: m.id,
            role: m.role as DisplayMessage["role"],
            content: m.content,
            relatedSessionId: m.related_session_id,
            createdAt: m.created_at,
          }))
        );
        setInitLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInitLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId, conversationId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setInput("");
    setLoading(true);

    // Save user message locally first (optimistic)
    const userMsg: DisplayMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    try {
      // Also persist user message to backend
      createManagerMessage(userId, {
        conversationId,
        role: "user",
        content: trimmed,
      }).catch(() => {}); // fire-and-forget, non-critical

      // Route the message
      const result: RouteMessageResponse = await routeManagerMessage(userId, {
        conversationId,
        message: trimmed,
      });

      // Build display messages
      const newMsgs: DisplayMessage[] = [userMsg];

      if (result.managerMessage) {
        newMsgs.push({
          id: result.managerMessage.id,
          role: result.managerMessage.role as DisplayMessage["role"],
          content: result.managerMessage.content,
          relatedSessionId: result.managerMessage.related_session_id,
          createdAt: result.managerMessage.created_at,
        });
      }

      setMessages((prev) => [...prev, ...newMsgs]);

      // Notify parent of session changes
      if (result.createdSession?.id) {
        onSessionCreated?.(result.createdSession.id);
        // Auto-select the new session
        setTimeout(() => onSelectSession?.(result.createdSession!.id), 200);
      }
      if (result.routeType === "update_existing_session" && result.targetSessionId) {
        onSessionUpdated?.(result.targetSessionId);
      }
    } catch (err: any) {
      const errMsg: DisplayMessage = {
        id: `err-${Date.now()}`,
        role: "system",
        content: `❌ ${err.message}`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, errMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, userId, conversationId, onSessionCreated, onSessionUpdated, onSelectSession]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {initLoading && (
          <div className="flex items-center justify-center h-full text-xs" style={{ color: "var(--text-muted)" }}>
            加载对话...
          </div>
        )}

        {!initLoading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <span className="text-3xl mb-3">💬</span>
            <div className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>
              Manager 对话
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              输入消息开始对话，或发起委托任务
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[80%] rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor:
                  msg.role === "user"
                    ? "var(--accent-blue)"
                    : msg.role === "system"
                    ? "var(--bg-error)"
                    : "var(--bg-overlay)",
                color:
                  msg.role === "user"
                    ? "#fff"
                    : msg.role === "system"
                    ? "var(--text-error)"
                    : "var(--text-primary)",
              }}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              {msg.relatedSessionId && (
                <button
                  onClick={() => onSelectSession?.(msg.relatedSessionId!)}
                  className="text-[10px] mt-1 opacity-70 hover:opacity-100 underline"
                  style={{ color: msg.role === "user" ? "rgba(255,255,255,0.8)" : "var(--text-accent)" }}
                >
                  查看任务 →
                </button>
              )}
              <div
                className="text-[10px] mt-1 opacity-50"
                style={{ color: msg.role === "user" ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}
              >
                {new Date(msg.createdAt).toLocaleTimeString()}
              </div>
            </div>
            {/* S101P Phase B: Execution metadata — conditionally rendered for manager messages */}
            {msg.role === "manager" && (
              <ExecutionMetadata
                usage={msg.usage}
                terminalSummary={msg.terminalSummary}
                executionProgress={msg.executionProgress}
              />
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start mb-3">
            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-muted)" }}
            >
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>●</span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className="flex-shrink-0 px-4 py-3"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息或委托任务..."
            disabled={loading}
            rows={2}
            className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
            style={{
              backgroundColor: "var(--bg-base)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
            style={{
              backgroundColor: "var(--accent-blue)",
              color: "#fff",
            }}
          >
            {loading ? "..." : "发送"}
          </button>
        </div>
        <div className="text-[10px] mt-1.5 px-1" style={{ color: "var(--text-muted)" }}>
          提示: 输入委托任务创建 Session，如 "帮我修登录页UI"
        </div>
      </div>
    </div>
  );
}
