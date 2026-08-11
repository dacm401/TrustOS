import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchTasks,
  fetchTaskDetail,
  patchTask,
  fetchMemory,
  deleteMemory,
  createMemoryEntry,
  fetchEvidence,
  fetchTraces,
  fetchDecision,
  fetchHealth,
  fetchGatewayHealth,
  fetchGatewayEvents,
  fetchGatewaySessions,
  getApiConfig,
  type GatewayEventsResponse,
  type GatewayEventsParams,
  type GatewaySessionsResponse,
  type MemoryEntry,
  type CostStats,
  type HealthStatus,
  type GatewayHealth,
} from '@/lib/api';

// Tasks
export function useTasks(userId: string, sessionId?: string) {
  return useQuery({
    queryKey: ['tasks', userId, sessionId],
    queryFn: () => fetchTasks(userId, sessionId),
    staleTime: 2 * 60 * 1000, // 2 分钟
    refetchInterval: 30000, // 30 秒轮询
    enabled: !!userId,
  });
}

export function useTaskDetail(taskId: string | null, userId: string) {
  return useQuery({
    queryKey: ['task-detail', taskId, userId],
    queryFn: () => taskId ? fetchTaskDetail(taskId, userId) : Promise.resolve(null),
    enabled: !!taskId,
    staleTime: 1 * 60 * 1000,
  });
}

export function usePatchTask(userId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: 'resume' | 'pause' | 'cancel' }) =>
      patchTask(taskId, userId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-detail'] });
    },
  });
}

// Memory
export function useMemory(userId: string, category?: string) {
  return useQuery({
    queryKey: ['memory', userId, category],
    queryFn: () => fetchMemory(userId, category),
    staleTime: 3 * 60 * 1000,
    enabled: !!userId,
  });
}

export function useDeleteMemory(userId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => deleteMemory(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

export function useCreateMemory(userId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { category: string; content: string; source?: string }) =>
      createMemoryEntry(userId, data.category, data.content, data.source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

// Evidence
export function useEvidence(taskId: string | null, userId: string) {
  return useQuery({
    queryKey: ['evidence', taskId, userId],
    queryFn: () => taskId ? fetchEvidence(taskId, userId) : Promise.resolve({ evidence: [] }),
    enabled: !!taskId,
    staleTime: 2 * 60 * 1000,
  });
}

// Traces
export function useTraces(taskId: string | null, userId: string) {
  return useQuery({
    queryKey: ['traces', taskId, userId],
    queryFn: () => taskId ? fetchTraces(taskId, userId) : Promise.resolve({ traces: [] }),
    enabled: !!taskId,
    staleTime: 1 * 60 * 1000,
    refetchInterval: taskId ? 3000 : false, // 3 秒轮询
  });
}

// Decision (debug panel)
export function useDecision(taskId: string | null, userId: string) {
  return useQuery({
    queryKey: ['decision', taskId, userId],
    queryFn: () => taskId ? fetchDecision(taskId, userId) : Promise.resolve(null),
    enabled: !!taskId,
    staleTime: 1 * 60 * 1000,
  });
}

// Health status (polled)
export function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 5 * 1000,
    refetchInterval: 10000,
  });
}

// TRST-2 Gateway Health (polled)
export function useGatewayHealth() {
  return useQuery<GatewayHealth>({
    queryKey: ['gateway-health'],
    queryFn: fetchGatewayHealth,
    staleTime: 5 * 1000,
    refetchInterval: 15000,
    retry: 2,
  });
}

// TRST-4C Gateway Events (paginated, filterable)
export function useGatewayEvents(params: GatewayEventsParams = {}) {
  const key = ['gateway-events', params.page || 1, params.limit || 50, params.session_id, params.event_type, params.agent_id];
  return useQuery<GatewayEventsResponse>({
    queryKey: key,
    queryFn: () => fetchGatewayEvents(params),
    staleTime: 10 * 1000,
    refetchInterval: 30000,
    retry: 2,
  });
}

// TRST-4C Gateway Sessions
export function useGatewaySessions(limit = 20) {
  return useQuery<GatewaySessionsResponse>({
    queryKey: ['gateway-sessions', limit],
    queryFn: () => fetchGatewaySessions(limit),
    staleTime: 30 * 1000,
    refetchInterval: 60000,
    retry: 2,
  });
}

// Legacy wrapper for components using old signature
export function useGatewayEventsLegacy(limit: number = 50) {
  return useGatewayEvents({ limit, page: 1 });
}

// Task summary (custom endpoint per task)
export function useTaskSummary(taskId: string | null, userId: string) {
  return useQuery({
    queryKey: ['task-summary', taskId, userId],
    queryFn: async () => {
      if (!taskId) return null;
      const { apiBase } = await getApiConfig();
      const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/summary`, {
        headers: { "X-User-Id": userId },
      });
      if (!res.ok) throw new Error(`加载任务摘要失败 (${res.status})`);
      return res.json() as Promise<{ summary?: string }>;
    },
    enabled: !!taskId,
    staleTime: 30 * 1000,
  });
}

// Cost stats
export function useCostStats(userId: string) {
  return useQuery({
    queryKey: ['cost-stats', userId],
    queryFn: async (): Promise<CostStats> => {
      const res = await fetch(`http://localhost:3001/api/cost-stats/${encodeURIComponent(userId)}`, {
        headers: { "X-User-Id": userId },
      });
      if (!res.ok) throw new Error(`加载成本统计失败 (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!userId,
  });
}
