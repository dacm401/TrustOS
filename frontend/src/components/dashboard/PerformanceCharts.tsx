"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
} from 'recharts';

interface PerformanceChartProps {
  data: Array<{
    timestamp: string;
    p50?: number;
    p95?: number;
    p99?: number;
  }>;
  title?: string;
  height?: number;
}

export function LatencyChart({ data, title = '响应延迟趋势', height = 200 }: PerformanceChartProps) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <defs>
            <linearGradient id="p50Gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="p95Gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-amber)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--accent-amber)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={{ stroke: 'var(--border-subtle)' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={{ stroke: 'var(--border-subtle)' }}
            tickFormatter={(value) => `${value}ms`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            iconType="line"
          />
          <Area
            type="monotone"
            dataKey="p50"
            stroke="var(--accent-blue)"
            fill="url(#p50Gradient)"
            strokeWidth={2}
            name="P50"
          />
          <Area
            type="monotone"
            dataKey="p95"
            stroke="var(--accent-amber)"
            fill="url(#p95Gradient)"
            strokeWidth={2}
            name="P95"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface QPSChartProps {
  data: Array<{
    timestamp: string;
    qps?: number;
    errors?: number;
  }>;
  title?: string;
  height?: number;
}

export function QPSChart({ data, title = 'QPS 趋势', height = 200 }: QPSChartProps) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={{ stroke: 'var(--border-subtle)' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={{ stroke: 'var(--border-subtle)' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Line
            type="monotone"
            dataKey="qps"
            stroke="var(--accent-blue)"
            strokeWidth={2}
            name="QPS"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="errors"
            stroke="var(--accent-red)"
            strokeWidth={2}
            name="Errors"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TokenChartProps {
  data: Array<{
    timestamp: string;
    inputTokens?: number;
    outputTokens?: number;
  }>;
  title?: string;
  height?: number;
}

export function TokenChart({ data, title = 'Token 消耗趋势', height = 200 }: TokenChartProps) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <defs>
            <linearGradient id="inputGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-purple)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--accent-purple)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="outputGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-green)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--accent-green)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={{ stroke: 'var(--border-subtle)' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={{ stroke: 'var(--border-subtle)' }}
            tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Area
            type="monotone"
            dataKey="inputTokens"
            stroke="var(--accent-purple)"
            fill="url(#inputGradient)"
            strokeWidth={2}
            name="Input"
          />
          <Area
            type="monotone"
            dataKey="outputTokens"
            stroke="var(--accent-green)"
            fill="url(#outputGradient)"
            strokeWidth={2}
            name="Output"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
