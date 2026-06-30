"use client";

export default function PrivacyPage() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start px-6 py-16"
      style={{ backgroundColor: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      <div className="max-w-2xl w-full">
        <h1
          className="text-2xl font-bold mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          Privacy Notice
        </h1>
        <p
          className="text-sm mb-8"
          style={{ color: "var(--text-muted)" }}
        >
          最后更新：2026-06-30 &nbsp;|&nbsp; TrustOS Private Beta
        </p>

        <section className="mb-8">
          <h2
            className="text-lg font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            1. 我们收集什么数据
          </h2>
          <ul
            className="list-disc pl-5 space-y-2 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            <li><strong>对话内容</strong>：你发送给 AI 的消息和 AI 的回复，用于生成响应和改进服务质量。</li>
            <li><strong>使用统计</strong>：会话数量、任务数量、Token 用量、成本估算，用于运营监控和成本控制。</li>
            <li><strong>反馈数据</strong>：你对 AI 回复的 👍/👎 评价及可选原因，用于改进模型路由和响应质量。</li>
            <li><strong>技术日志</strong>：请求时间戳、模型名称、延迟、错误类型等元数据，用于排障和性能优化。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2
            className="text-lg font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            2. 我们不收集什么
          </h2>
          <ul
            className="list-disc pl-5 space-y-2 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            <li><strong>个人身份信息 (PII)</strong>：我们不主动收集姓名、邮箱、电话号码、身份证号等。</li>
            <li><strong>支付信息</strong>：Private Beta 阶段不涉及任何支付。</li>
            <li><strong>设备指纹</strong>：不收集浏览器指纹、设备 ID 等唯一标识。</li>
            <li><strong>第三方追踪</strong>：不使用任何第三方分析或广告追踪。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2
            className="text-lg font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            3. 数据如何存储和保护
          </h2>
          <ul
            className="list-disc pl-5 space-y-2 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            <li>数据存储在受访问控制的 PostgreSQL 数据库中。</li>
            <li>日志中的敏感内容（如对话原文）会进行脱敏处理，仅保留结构化元数据。</li>
            <li>API 访问需要通过 JWT 认证或可信代理注入的身份标识。</li>
            <li>生产环境部署在私有服务器上，不对外公开数据库端口。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2
            className="text-lg font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            4. 数据保留与删除
          </h2>
          <ul
            className="list-disc pl-5 space-y-2 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            <li>Private Beta 期间数据保留用于产品迭代和模型改进。</li>
            <li>你可以通过反馈渠道请求删除你的数据。</li>
            <li>Beta 结束后将根据正式隐私政策处理数据。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2
            className="text-lg font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            5. 你的权利
          </h2>
          <ul
            className="list-disc pl-5 space-y-2 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            <li>你可以随时查看你的对话历史和使用统计。</li>
            <li>你可以请求导出或删除你的数据。</li>
            <li>你可以选择不使用某些功能。</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2
            className="text-lg font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}
          >
            6. 联系我们
          </h2>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            如有隐私相关问题，请通过 TrustOS 项目仓库 (dacm401/TrustOS) 提交 Issue 或联系开发团队。
          </p>
        </section>

        <div
          className="mt-10 pt-6 text-xs"
          style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
        >
          <p>TrustOS Private Beta — Feedback Loop Ready</p>
          <p className="mt-1">S98P Beta Hardening, Safety &amp; Cost Guardrails</p>
        </div>
      </div>
    </div>
  );
}
