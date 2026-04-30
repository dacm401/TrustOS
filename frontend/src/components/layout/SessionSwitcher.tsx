"use client";

import { useState, useEffect, useRef } from 'react';

interface Session {
  id: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRecentSessions();
  }, [userId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchRecentSessions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/v1/sessions/recent?user_id=${encodeURIComponent(userId)}&limit=10`, {
        headers: { 'X-User-Id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.warn('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (sessionId: string) => {
    onSessionChange(sessionId);
    setIsOpen(false);
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

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
          {currentSession?.summary || `Session ${currentSessionId.slice(0, 8)}`}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 w-64 rounded-xl shadow-lg z-50 overflow-hidden"
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
          <div className="max-h-64 overflow-y-auto">
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
                  key={session.id}
                  onClick={() => handleSelect(session.id)}
                  className="w-full px-3 py-2 text-left transition-colors hover:opacity-80"
                  style={{
                    backgroundColor: session.id === currentSessionId ? 'var(--bg-overlay)' : 'transparent',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm flex-shrink-0">💬</span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs truncate"
                        style={{
                          color: session.id === currentSessionId ? 'var(--text-accent)' : 'var(--text-secondary)',
                        }}
                      >
                        {session.summary || `Session ${session.id.slice(0, 8)}`}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {new Date(session.updated_at).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    {session.id === currentSessionId && (
                      <span className="text-[10px]" style={{ color: 'var(--accent-blue)' }}>
                        ✓
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            className="px-3 py-2 text-center"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <button
              onClick={() => {
                onNewSession();
                setIsOpen(false);
              }}
              className="text-xs transition-opacity hover:opacity-80"
              style={{ color: 'var(--accent-blue)' }}
            >
              查看全部会话 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
