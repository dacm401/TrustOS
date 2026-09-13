"use client";

// UI-IA-CONSOLIDATION 阶段 4 —— 证据列表的**唯一**展示实现。
//
// 此前同一份渲染逻辑存在两份拷贝：
//   · workbench/EvidencePanel.tsx（工作台「证据」tab）
//   · views/TasksView.tsx 里的 EvidenceList（任务详情「关联证据」）
// 两者数据源相同（fetchEvidence / /v1/evidence），展示却各写一遍，
// 久而久之必然出现差异 —— 这正是「同一个证据有多个入口且长得不一样」
// 的根因。
//
// 现在两处都复用本组件，确保「证据」在任何位置看起来、行为起来都一致。
// SOURCE_CONFIG 也统一取自 lib/constants，不再各自定义第三份。

import { SOURCE_CONFIG } from "@/lib/constants";

export interface EvidenceItem {
  evidence_id: string;
  source: string;
  content: string;
  relevance_score: number | null;
  source_metadata?: Record<string, unknown> | null;
  created_at?: string;
}

/**
 * 展示差异通过参数控制，而不是各写一份实现：
 *   showTime  工作台窄屏会显示时间；任务详情页空间充裕，默认不显示
 *   maxChars  工作台截断 200 字；任务详情默认不截断
 *   divided   工作台用分隔线分隔条目；任务详情用间距
 *
 * 这样「同一份渲染逻辑 + 不同呈现参数」，既保持一致又兼顾场景。
 */
export function EvidenceList({
  evidences,
  emptyText = "暂无关联证据",
  showTime = false,
  maxChars,
  divided = false,
}: {
  evidences: EvidenceItem[];
  emptyText?: string;
  showTime?: boolean;
  maxChars?: number;
  divided?: boolean;
}) {
  if (evidences.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {emptyText}
      </p>
    );
  }

  return (
    <div className={divided ? "" : "space-y-3"}>
      {evidences.map((ev) => {
        const cfg = SOURCE_CONFIG[ev.source] ?? SOURCE_CONFIG.manual;
        const body =
          maxChars && ev.content.length > maxChars
            ? ev.content.slice(0, maxChars) + "…"
            : ev.content;
        return (
          <div
            key={ev.evidence_id}
            className={divided ? "px-3 py-2.5" : "text-xs"}
            style={
              divided
                ? { borderBottom: "1px solid var(--border-subtle)" }
                : undefined
            }
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: cfg.bg, color: cfg.color }}
              >
                {cfg.icon} {cfg.label}
              </span>
              {ev.relevance_score !== null && (
                <span style={{ color: "var(--text-muted)" }}>
                  相关度: {(ev.relevance_score * 100).toFixed(0)}%
                </span>
              )}
              {showTime && ev.created_at && (
                <span
                  className="text-[10px] ml-auto"
                  style={{ color: "var(--text-muted)" }}
                >
                  {new Date(ev.created_at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
            <p
              className="leading-relaxed line-clamp-4"
              style={{ color: "var(--text-secondary)" }}
            >
              {body}
            </p>
            {ev.source_metadata && Boolean(ev.source_metadata.url) && (
              <a
                href={String(ev.source_metadata.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-1 truncate"
                style={{ color: "var(--text-accent)" }}
              >
                {String(ev.source_metadata.url)}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
