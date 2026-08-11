# T100 文档索引

> T100 — TrustOS OS Reframing & Architecture Planning  
> 两套文档并存：**Engineering 版**（含 Current State + Gap Analysis）和 **PM Draft 版**（v0.1 目标态草稿）

## 文档对照表

| # | 主题 | Engineering 版 (v1.0) | PM Draft 版 (v0.1) | 差异 |
|---|---|---|---|---|
| 1 | OS Manifesto | `strategy/TrustOS-OS-Manifesto.md` | `strategy/TrustOS-OS-Manifesto-PM-draft.md` | Eng 版含痛点表格、Current State；PM 版为 17 条短原则 |
| 2 | OS Primitives | `architecture/TrustOS-OS-Primitives.md` | `architecture/TrustOS-OS-Primitives-PM-draft.md` | Eng 版含 OS 类比 + Current State；PM 版多 Capability 原语 |
| 3 | Trust Model | `architecture/Manager-Worker-Trust-Model.md` | `architecture/Manager-Worker-Trust-Model-PM-draft.md` | Eng 版含信任三角图 + L0-L6 决策流水线；PM 版含完整 Contract JSON 示例 |
| 4 | Trust Kernel RFC | `architecture/Trust-Kernel-RFC.md` | `architecture/Trust-Kernel-RFC-PM-draft.md` | Eng 版含完整 API 设计；PM 版含 Policy Hierarchy 优先级 |
| 5 | **AI Syscall Protocol** | *(无独立文档，分散在 Primitives/Kernel)* | `architecture/AI-Syscall-Action-Protocol-PM-draft.md` | **PM 独有** — Action/Decision Schema、批量请求、可见性等级 |
| 6 | Performance Model | `architecture/TrustOS-Performance-Model.md` | `architecture/TrustOS-Performance-Model-PM-draft.md` | Eng 版 L0-L6 延迟分层；PM 版含 Background Path 概念 |
| 7 | Session Runtime | `architecture/Session-Runtime-RFC.md` | `architecture/Session-Runtime-RFC-PM-draft.md` | Eng 版含 10 张表 + 事件流；PM 版含工作流引擎选型 + 幂等性 |
| 8 | UX Blueprint | `product/TrustOS-UX-Blueprint.md` | `product/TrustOS-UX-Blueprint-PM-draft.md` | Eng 版含 5 个关键界面；PM 版含 Approval Card 示例 + Tone Principles |
| 9 | **Local-First Hybrid** | *(无独立文档，分散在 Manifesto/Kernel)* | `architecture/Local-First-Hybrid-Architecture-PM-draft.md` | **PM 独有** — 5 种混合执行模式 + 数据路由规则 + 本地守护进程 |
| 10 | Planning Report | `sprints/T100-planning-report.md` | `sprints/T100-planning-report-PM-draft.md` | Eng 版含实际代码审计数据；PM 版含四组开放问题 + S100P-S103P 定义 |

## 目录结构

```text
docs/
  strategy/
    TrustOS-OS-Manifesto.md              ← Engineering v1.0
    TrustOS-OS-Manifesto-PM-draft.md     ← PM v0.1
  architecture/
    TrustOS-OS-Primitives.md             ← Engineering v1.0
    TrustOS-OS-Primitives-PM-draft.md    ← PM v0.1
    Manager-Worker-Trust-Model.md        ← Engineering v1.0
    Manager-Worker-Trust-Model-PM-draft.md ← PM v0.1
    Trust-Kernel-RFC.md                  ← Engineering v1.0
    Trust-Kernel-RFC-PM-draft.md         ← PM v0.1
    AI-Syscall-Action-Protocol-PM-draft.md ← PM 独有 v0.1
    TrustOS-Performance-Model.md         ← Engineering v1.0
    TrustOS-Performance-Model-PM-draft.md ← PM v0.1
    Session-Runtime-RFC.md               ← Engineering v1.0
    Session-Runtime-RFC-PM-draft.md      ← PM v0.1
    Local-First-Hybrid-Architecture-PM-draft.md ← PM 独有 v0.1
  product/
    TrustOS-UX-Blueprint.md              ← Engineering v1.0
    TrustOS-UX-Blueprint-PM-draft.md     ← PM v0.1
  sprints/
    T100-planning-report.md              ← Engineering v1.0
    T100-planning-report-PM-draft.md     ← PM v0.1
```

## 使用指南

- **看目标态设计** → PM Draft 版（简洁、宣言式）
- **看实现现状 + 差距** → Engineering 版（含代码审计数据）
- **两套互补，方向一致，不矛盾**

## 下一步

T100 文档封板后，进入 S100P — Manager Shell v1 实施阶段。
