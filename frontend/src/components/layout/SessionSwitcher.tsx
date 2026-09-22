"use client";

import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '@/lib/api';

interface Session {
  session_id: string;
  active_topic?: string;
  summary_text?: string;
  topic?: string;
  last_user_message?: string | null;
  total_requests?: number;
  turn_count?: number;
  created_at: string;
  updated_at: string;
}

interface SessionSwitcherProps {
  currentSessionId: string;
  userId: string;
  onSessionChange: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionSwitcher({
  currentSessionId,
  userId,
  onSessionChange,
  onNewSession,
}: SessionSwitcherProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchRecentSessions(controller.signal);
    return () => controller.abort();
  }, [userId, page]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchRecentSessions = async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/v1/sessions/recent?limit=20`,
        { headers: { 'X-User-Id': userId }, signal }
      );
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.warn('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const sessionLabel = (s: Session): string => {
    // 优先显示用户实际问的最后一句（最有辨识度），退化顺序：
    // 生成摘要主题 → 活跃主题 → 摘要正文 → 新对话占位。
    return s.last_user_message || s.topic || s.active_topic || s.summary_text || "新对话";
  };

  // 相对时间：让"什么时候聊的"一眼可读，而非裸日期。
  function formatRelative(iso: string): string {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} 天前`;
    return d.toLocaleDateString("zh-CN");
  }

  const handleSelect = (sessionId: string) => {
    onSessionChange(sessionId);
    setIsOpen(false);
  };

  const currentSession = sessions.find(s => s.session_id === currentSessionId);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <span className="text-sm">💬</span>
        <span className="text-xs max-w-[120px] truncate" style={{ color: 'var(--text-secondary)' }}>
          {currentSession ? sessionLabel(currentSession) : `Session ${currentSessionId.slice(0, 8)}`}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 w-72 rounded-xl shadow-lg z-50 overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {/* Header */}
          <div
            className="px-3 py-2 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              最近会话
            </span>
            <button
              onClick={() => {
                onNewSession();
                setIsOpen(false);
              }}
              className="text-xs px-2 py-1 rounded-md transition-colors hover:opacity-80"
              style={{
                backgroundColor: 'var(--accent-blue)',
                color: 'white',
              }}
            >
              + 新建
            </button>
          </div>

          {/* Session List */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center">
                <span className="text-xs animate-pulse" style={{ color: 'var(--text-muted)' }}>
                  加载中...
                </span>
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-4 text-center">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  暂无会话记录
                </span>
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.session_id}
                  onClick={() => handleSelect(session.session_id)}
                  className="w-full px-3 py-2.5 text-left transition-colors hover:opacity-80"
                  style={{
                    backgroundColor: session.session_id === currentSessionId ? 'var(--bg-overlay)' : 'transparent',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm flex-shrink-0 mt-0.5">💬</span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs truncate font-medium"
                        style={{
                          color: session.session_id === currentSessionId ? 'var(--text-accent)' : 'var(--text-secondary)',
                        }}
                      >
                        {sessionLabel(session)}
                      </p>
                      {session.summary_text && session.summary_text !== sessionLabel(session) && (
                        <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {session.summary_text.slice(0, 60)}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {formatRelative(session.updated_at)}
                        </span>
                      </div>
                    </div>
                    {session.session_id === currentSessionId && (
                      <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-blue)' }}>
                        ✓
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
