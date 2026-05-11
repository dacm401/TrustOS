"use client";
import Link from "next/link";
import { useDashboard } from "@/hooks/useQueries";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { TokenSankey } from "@/components/dashboard/TokenSankey";
import { DecisionTimeline } from "@/components/dashboard/DecisionTimeline";
import { GrowthChart } from "@/components/dashboard/GrowthChart";
import { LearningPanel } from "@/components/dashboard/LearningPanel";

const USER_ID = "user-001";

export default function DashboardPage() {
  const { data, isLoading, refetch } = useDashboard(USER_ID);
  const lastUpdated = new Date();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 返回对话</Link>
          <span className="text-gray-300">|</span>
          <div className="flex items-center gap-2"><span className="text-xl">📊</span><span className="font-bold text-gray-800">透明观测仪表盘</span></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">更新于 {lastUpdated.toLocaleTimeString()}</span>
          <button onClick={() => refetch()} className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">🔄 刷新</button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <div className="text-gray-500 text-sm">加载仪表盘数据...</div>
            </div>
          </div>
        ) : (
          <>
            <StatsCards data={data} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TokenSankey tokenFlow={data?.token_flow} />
              <GrowthChart growth={data?.growth} />
            </div>
            <DecisionTimeline decisions={data?.recent_decisions || []} />
            <LearningPanel growth={data?.growth} />
          </>
        )}
      </main>
    </div>
  );
}
