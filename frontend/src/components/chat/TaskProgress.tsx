"use client";

import { useEffect, useState } from 'react';

interface TaskProgressState {
  status: 'routing' | 'executing' | 'completed' | 'failed';
  percentage: number;
  message: string;
}

interface Trace {
  trace_id: string;
  type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface TaskProgressProps {
  taskId: string;
  userId: string;
  onComplete?: () => void;
  className?: string;
}

const STATUS_MESSAGES: Record<TaskProgressState['status'], string> = {
  routing: '智能路由中...',
  executing: '任务执行中...',
  completed: '任务已完成',
  failed: '任务执行失败',
};

const STATUS_COLORS: Record<TaskProgressState['status'], string> = {
  routing: 'var(--accent-purple)',
  executing: 'var(--accent-blue)',
  completed: 'var(--accent-green)',
  failed: 'var(--accent-red)',
};

function calculateProgressFromTraces(traces: Trace[]): {
  percentage: number;
  status: TaskProgressState['status'];
  message: string;
} {
  if (!traces || traces.length === 0) {
    return { percentage: 0, status: 'routing', message: '准备中...' };
  }

  const traceTypes = traces.map(t => t.type);
  const hasClassification = traceTypes.includes('classification');
  const hasRouting = traceTypes.includes('routing');
  const hasPlanning = traceTypes.includes('planning');
  const hasStep = traceTypes.some(t => t.type === 'step');
  const hasResponse = traceTypes.includes('response');
  const hasError = traceTypes.includes('error');

  if (hasError) {
    return { percentage: 100, status: 'failed', message: '执行过程中遇到错误' };
  }

  if (hasResponse) {
    return { percentage: 100, status: 'completed', message: '任务已完成' };
  }

  let percentage = 5; // Starting base
  let status: TaskProgressState['status'] = 'routing';
  let message = STATUS_MESSAGES.routing;

  if (hasClassification) {
    percentage = 20;
    status = 'routing';
    message = '意图识别完成，正在路由...';
  }

  if (hasRouting) {
    percentage = 40;
    status = 'routing';
    message = '路由决策完成，准备执行...';
  }

  if (hasPlanning) {
    percentage = 50;
    status = 'executing';
    message = '任务规划完成，开始执行...';
  }

  if (hasStep) {
    const stepCount = traceTypes.filter(t => t === 'step').length;
    percentage = Math.min(50 + stepCount * 10, 90);
    status = 'executing';
    message = `执行中 (${stepCount} 步骤完成)...`;
  }

  return { percentage, status, message };
}

export function TaskProgress({ taskId, userId, onComplete, className = '' }: TaskProgressProps) {
  const [progress, setProgress] = useState<TaskProgressState>({
    status: 'routing',
    percentage: 0,
    message: '初始化中...',
  });
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!polling) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `http://localhost:3001/v1/tasks/${encodeURIComponent(taskId)}/traces`,
          { headers: { 'X-User-Id': userId } }
        );
        
        if (!res.ok) {
          console.error('Failed to fetch traces:', res.status);
          return;
        }

        const data = await res.json();
        const { percentage, status, message } = calculateProgressFromTraces(data.traces || []);

        setProgress({ percentage, status, message });

        if (status === 'completed' || status === 'failed') {
          setPolling(false);
          if (onComplete) {
            onComplete();
          }
        }
      } catch (error) {
        console.warn('Progress polling error:', error);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);

    return () => clearInterval(interval);
  }, [taskId, userId, onComplete, polling]);

  const color = STATUS_COLORS[progress.status];

  return (
    <div className={`my-3 ${className}`}>
      {/* Progress bar */}
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--border-subtle)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progress.percentage}%`,
            backgroundColor: color,
          }}
        />
      </div>

      {/* Status text */}
      <div className="flex items-center justify-between mt-2">
        <span
          className="text-xs"
          style={{ color: color }}
        >
          {progress.message}
        </span>
        <span
          className="text-[10px]"
          style={{ color: 'var(--text-muted)' }}
        >
          {progress.percentage}%
        </span>
      </div>
    </div>
  );
}
