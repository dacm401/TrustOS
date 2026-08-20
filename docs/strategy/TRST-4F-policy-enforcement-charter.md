# TRST-4F Policy Enforcement Charter (DRAFT — Planning only, no implementation authorized)

```text
Status:        DRAFT (planning baseline, NOT implementation)
Date:          2026-08-17
Author:        Agent (autonomous, Boss-approved planning)
Trigger:       MWT-21 (real worker wiring) ✅ + MWT-22 (backend assessment API) ✅
               — both medium-effort items from the Governance Closure Plan are now
               COMPLETE, satisfying the "完成中等后进行" gate for the high-risk core.
Baseline gate: Private Beta = validated trusted observation/recording system
               (NOT governance-grade). 4F is the observation→governance shift.
```

---

## 0. Honest framing

This is a **charter draft only**. No code is written, no migration is added, no
service is changed by this document. It exists so the Boss can decide whether and
how TRST-4F (autonomous policy enforcement) should be implemented.

It does NOT claim:
- ❌ that policy enforcement is implemented
- ❌ that `would_block` becomes a real action yet
- ❌ that TrustOS is governance-grade yet
- ❌ that any 4F work is authorized to implement

The limitations statement in `private-beta-limitations.md` — ❌ "no autonomous
policy execution / no real enforcement" — **REMAINS TRUE** until 4F ships.

---

## 1. Why 4F now (and not before)

Per the 2026-08-17 Governance Closure Plan, three tiers were defined:
- EXCLUDED: 4E (identity), 4G (prod ops) — deferred by Boss.
- MEDIUM (done): Real Worker Wiring (MWT-21), Backend Assessment API (MWT-22).
- HIGH-RISK CORE (deferred until medium done): **TRST-4F Policy Enforcement**.

MWT-21 and MWT-22 are now committed (`6e5a6af`, `22049fd`). The gate condition
is satisfied. This charter upgrades 4F from `RECORDED_ONLY ⏸️` to `DRAFT` so the
Boss can evaluate the paradigm shift on concrete footing.

---

## 2. Current state — what already exists (do not rebuild)

| Asset | Path | Status |
|---|---|---|
| Policy engine (defined, decision logic) | `src/trust/policy-engine.ts` (8 KB) | DEFINED, has 12 KB test, **NEVER CALLED in execution path** |
| Assessment + dry-run control label | `src/services/assessment/assess-engine.ts` + `src/api/assess.ts` (MWT-22) | LIVE — returns `control.action: allow|review|would_block`, `runtimeEffect: "none"` |
| Contract gate (only approved may run) | `src/services/manager/execution-attempt-service.ts` (MWT-21) | LIVE — HITL boundary |
| Gateway interception point | chat → gateway forwarder | EXISTS — natural enforcement insertion point |

**Critical insight**: the *decision* half of enforcement (policy-engine + assess
control label) already exists and is tested. What is missing is the *action* half:
turning `would_block` into a real runtime effect (block / mandatory-approval /
redact) at the Gateway interception point, plus a human-override/appeal flow.
4F is therefore **wiring + action + override**, not greenfield policy logic.

---

## 3. The paradigm shift (observe → govern)

Today TrustOS is an **observation/recording** system:
- It observes events, hashes them, records completeness signals.
- `Review` (MWT-19) is an internal audit — evidence completeness, hash coverage,
  missing-signal detection — NOT governance.
- Control is dry-run: `would_block` is a label only; the system still `allow`s.

4F turns `observe + record + allow` into `observe + decide + act`:
- `would_block` → real block at Gateway (request not forwarded to upstream).
- `review` → mandatory human approval gate before execution.
- `allow` → unchanged.
- Every enforcement action is itself an audited, hash-chained event (no silent
  blocking — preserves the "no silent event loss" frozen principle).

This is the same capability the earlier 7-area map called #2 (autonomous policy
execution) + #7 (enforcement). They are one charter.

---

## 4. Scope (proposed)

### In scope
- Wire `policy-engine` decision into the execution path (currently dead code).
- Map assessment `control.action` → real Gateway behavior:
  - `would_block` → block + emit enforcement event
  - `review` → pre-execution mandatory-approval hold
  - `allow` → passthrough
- Human-override / appeal flow for blocked or held actions (who can override, log
  the override as a first-class event).
- Enforcement events enter the same Event Backbone (hash-chained, no silent loss).
- Dry-run shadow mode FIRST: run enforcement decisions side-by-side with allow,
  log divergences, no real blocking — until Boss flips the switch.

### Out of scope (guardrails — carry from TRST-3)
- No **semantic** DLP detection (no LLM/ML-based PII inference) — frozen consensus.
- **模式 DLP 是 4F 的核心检测引擎（竞争力优先的可选能力，2026-08-20 重新规划）**：当
  `config.permission.dlpEnabled=true` 时，`buildEngine()` 注入 `DEFAULT_POLICY_RULES`（基于
  `field-classification.ts` 字段级分类 + `inferClassification` 关键词/模式 PII 检测，
  **零语义模型依赖**）。dry_run 下采集 PII 分歧信号，live 下 strictly_private→deny、
  confidential→ask_user。**企业部署档建议默认开启**（Private Beta 局限文档已标注为一键启用
  的核心防护力），不再作为"红线放宽"，而是产品卖点。
- No Trust Spine semantic/hashing changes.
- No Memory Governance bypass.
- **raw payload 绝不落库（保留为隐私基线，不削弱竞争力）**：enforcement 事件只携带 hash + 标签 + 元数据。
- **enforcement 事件仅 hash+标签（保留为证据设计）**：与 raw 不落库共同构成隐私/证据基线。
- No raw content expansion (enforcement decisions stay metadata/hash-driven).
- Migrations additive/reversible only.
- No auth/RBAC overhaul (4E deferred) — 4F must work within current
  `X-User-Id` trust boundary; flag the dependency explicitly.

---

## 5. Risks & guardrails (why this was deferred, not skipped)

> 2026-08-20 重新规划：原"红线"（R1 No DLP、无真实 enforcement）已让位于竞争力优先。
> 保留的 TRST-0.3 共识基线：**Shadow 默认、No silent loss、Enforcement→Observation→Governance
> 顺序、不生产化、raw 绝不落库、enforcement 仅 hash+标签**。

| Risk | Mitigation |
|---|---|
| False-block on clean traffic (over-enforcement) | Dry-run shadow window first; `would_block` only on high-severity privacy/trace_integrity signals, never on operational/behavioral |
| Silent blocking violates "no silent event loss" | Every block/hold is an explicit hash-chained event (R3 保留) |
| Couples to identity boundary (4E deferred) | Document 4E as hard dependency for override attribution; 4F override is operator-only in v0 |
| Trust Spine / Memory touched | Explicit guardrail; enforcement is metadata-only, never reads/modifies raw payloads (raw 不落库 保留) |
| Rollback safety | Enforcement toggle is config-flagged; instant revert to dry-run |
| Live enforcement safety | Go-live requires explicit `APPROVE_TRST-4F_IMPLEMENTATION`; default remains dry-run until then |

---

## 6. Sequencing & decision gates

4F should NOT enter implementation until:
1. This charter reviewed and scoped by Boss (which sub-capabilities: block? hold?
   override? all three?).
2. Dry-run shadow mode deployed and observed for a defined window (no real blocks).
3. Rollback plan validated (toggle → dry-run, verified in staging).
4. Explicit Boss directive: `APPROVE_TRST-4F_IMPLEMENTATION` with chosen scope.

This draft becomes an **authorized implementation charter** only by that directive.

---

## 7. Open questions for Boss

- Which enforcement actions are in v0: block only? hold-only? both? override flow?
- Is dry-run shadow window length defined (e.g. N sessions / days) before go-live?
- Override authority: operator-only (current identity boundary) acceptable for v0,
  or is 4E (authenticated identity) a prerequisite before 4F ships?
- Does 4F require the real worker runtime (MWT-21) to be live-validated first, or
  is the zero-DB seam sufficient for charter approval?

---

## 8. Source of truth

- Governance Closure Plan: `docs/strategy/TRST-execution-log.md` (§1522, §1583)
- Policy engine (defined, un-wired): `src/trust/policy-engine.ts`
- Assessment + dry-run control: `src/services/assessment/assess-engine.ts`, `src/api/assess.ts` (MWT-22)
- TRST-4 umbrella draft: `docs/strategy/TRST-4-charter-draft.md`
- Private Beta limitations (honesty boundary): `docs/private-beta-limitations.md`

---

## 9. 2026-08-20 重新规划（竞争力优先，取消 5 条重设红线）

取消上一轮（2026-08-19）对 5 条红线的"重设"，回到**可自由重设态**，并以企业买家最看重的
防护力为优先级重排。已实现的代码（模式 DLP opt-in、user-anchored Merkle 锚定、4E signer_identity、
4G readinessCheck）**保留**，但叙事从"红线放宽"改为"竞争力优先的可选能力 / 产品卖点"。

**保留的 TRST-0.3 共识基线（不可逾越）**：
- Shadow Mode 默认首跑体验
- No silent event loss（无静默事件丢失）
- Enforcement → Observation → Governance 顺序
- 不生产化（gateway 非产品级基础设施）
- **raw payload 绝不落库**（隐私基线，企业买家同样要求）
- **enforcement 事件仅 hash + 标签**（证据设计，不削弱竞争力）

**竞争力优先级（企业买家视角）**：
1. 真实拦截（4F live）—— 最高优先，企业最看重"能否真挡住敏感数据出域"
2. 模式 DLP（R1）—— 作为 4F 检测引擎，企业档默认建议开启
3. 合规锚定（R4）—— enforcement 事件自动进 Merkle root，导出合规证据包
4. 身份归因（4E signer_identity）—— 拦截/锚定都带 signer_identity
5. 运维就绪（4G readiness）—— 拦截上线前健康/降级自检

**落地路径（A→B→C）**：
- A（已完成）：文档口径重述，代码不动。
- B（已完成）：4F live 上线决策包——
  `scripts/trst/4f-dryrun-divergence-report.mts`（dry-run 分歧采集，GO/HOLD 决策）、
  `docs/strategy/TRST-4F-go-live-decision-pack.md`（回滚开关 + go-live checklist）。
- C（已完成，按 Boss "按 ABC 顺序做" 指令执行）：真实拦截接线——
  - `policy-enforcement.ts` `emitEnforcementEvent` 自动把 enforcement 事件 `payload_hash`
    并入 4R 合规锚定累积器（`addEnforcementEventHash`），导出时形成"谁被拦截"的不可篡改审计链。
  - `preLlmEnforce` signer 归因修正：无显式 signer 时回退 `req.userId ?? "system"`，支持上游传入真实用户。
  - 默认仍 `dry_run` / `dlpEnabled=false`，live 拦截需双开关 + 显式 deny 规则匹配（fail-open）。
  - 测试：evidence-anchor.test.ts 新增 3 例 4F→4R 合并（21 PASS, tsc 0）。
  - 注：4F 拦截当前作用于 agent 内部 LLM 调用（worker/planner/compressor 经 model-gateway）；
    HTTP 网关 `/v1/chat/completions` 转发路径不在此列（符合 gateway=observe 入口定位）。
  下一步：push 到 origin（待网络恢复）；PM 决策是否 flip `live`（go-live 决策包 §4）。
