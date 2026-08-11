// MWT-4A — useTaskEvidence hook (frontend-only projection over Gateway events).
"use client";

import { useEffect, useState } from "react";
import { fetchGatewayEventsByTask } from "@/lib/api";
import { aggregateTaskEvidence, sortEventsByTimestamp, EMPTY_SUMMARY } from "@/lib/taskEvidence";
import type { TaskEvidenceState } from "@/types/task-evidence";

export function useTaskEvidence(taskId: string | null): TaskEvidenceState {
  const [state, setState] = useState<TaskEvidenceState>({
    loading: false,
    error: null,
    events: [],
    summary: EMPTY_SUMMARY,
  });

  useEffect(() => {
    if (!taskId) {
      setState({ loading: false, error: null, events: [], summary: EMPTY_SUMMARY });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetchGatewayEventsByTask(taskId)
      .then((res) => {
        if (cancelled) return;
        const events = sortEventsByTimestamp(res.events);
        setState({ loading: false, error: null, events, summary: aggregateTaskEvidence(events) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load task evidence";
        setState({ loading: false, error: msg, events: [], summary: EMPTY_SUMMARY });
      });

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  return state;
}
