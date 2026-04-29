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
  getDashboard,
  getGrowth,
  type MemoryEntry,
  type CostStats,
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

// Dashboard
export function useDashboard(userId: string) {
  return useQuery({
    queryKey: ['dashboard', userId],
    queryFn: () => getDashboard(userId),
    staleTime: 1 * 60 * 1000,
    refetchInterval: 30000, // 30 秒轮询
    enabled: !!userId,
  });
}

export function useGrowth(userId: string) {
  return useQuery({
    queryKey: ['growth', userId],
    queryFn: () => getGrowth(userId),
    staleTime: 2 * 60 * 1000,
    enabled: !!userId,
  });
}

// Cost stats
export function useCostStats(userId: string) {
  return useQuery({
    queryKey: ['cost-stats', userId],
    queryFn: async (): Promise<CostStats> => {
      const res = await fetch(`http://localhost:3001/api/cost-stats/${encodeURIComponent(userId)}`);
      if (!res.ok) throw new Error(`加载成本统计失败 (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!userId,
  });
}
