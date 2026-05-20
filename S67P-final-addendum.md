# Sprint 67P Final Addendum

> **Date:** 2026-05-20
> **Addendum to:** `S67P-closure-report.md`
> **Closure candidate:** `5ba457b`
> **Purpose:** 补充 PM 要求的三项验收缺口：单测结果 / `patchFirstAfter` 替代语义 / E2E case 明细

---

## A. 单测结果（PM 阻塞点 1 已消除）

单测已于 2026-05-20 09:56 实际跑通，环境：vitest v2.1.9。

### A.1 quality-router.test.ts

| **Test ID** | **Description** | **Result** |
|---|---|---:|
| QR-001 | score=0.9 → allow_patch_first | ✅ |
| QR-001b | score=0.8 (boundary) → allow_patch_first | ✅ |
| QR-002 | score=0.75 → prefer_full_rewrite | ✅ |
| QR-002b | score=0.7 (boundary) → prefer_full_rewrite | ✅ |
| QR-003 | score=0.4 → force_full_rewrite | ✅ |
| QR-003b | score=0 → force_full_rewrite | ✅ |
| QR-004 | VF-006 security → block_or_full_rewrite | ✅ |
| QR-004b | VF-007 security (高分也拦) → block_or_full_rewrite | ✅ |
| QR-004c | VF-008 security → block_or_full_rewrite | ✅ |
| QR-004d | VF-003 warning (非 security) 不触发 block | ✅ |
| QR-005 | null entry → allow_patch_first (首次不惩罚) | ✅ |
| QR-005b | undefined entry → allow_patch_first | ✅ |
| QR-006 | TRUSTOS_QUALITY_ROUTING_ENABLED=false → allow_patch_first | ✅ |
| QR-999 | 所有返回字段结构完整性 | ✅ |
| QR-007 | extractLastVerification — 正确提取最新 artifact | ✅ |
| QR-007b | 多条 artifact 取最新一条 | ✅ |
| QR-008 | 无 artifact meta → null | ✅ |
| QR-008b | 空 history → null | ✅ |
| QR-008c | origin=manager (非 worker) → 跳过，返回 null | ✅ |

**质量路由单测结果：19/19 PASS ✅**

---

### A.2 artifact-verifier.test.ts

| **Test ID** | **Description** | **Result** |
|---|---|---:|
| VF-01 | valid React artifact passes | ✅ |
| VF-02 | empty content fails (VF-001 error) | ✅ |
| VF-03 | unknown artifact type → VF-002 warning | ✅ |
| VF-04 | missing React structure → VF-003 warning | ✅ |
| VF-05 | revision lineage valid passes | ✅ |
| VF-06 | revision lineage mismatch → VF-004 error | ✅ |
| VF-07 | artifactToManager=true → VF-006 error | ✅ |
| VF-08 | rawHistoryToWorker=true → VF-007 error | ✅ |
| VF-09 | rawMemoryToWorker=true → VF-008 error | ✅ |
| VF-10 | patchApplied=true + empty content → VF-005 error | ✅ |
| VF-11 | score degrades on warning (VF-002 → score < 1.0) | ✅ |
| VF-12 | multiple errors stack (score ≥ 0.0) | ✅ |
| VF-13 | verifierVersion always "v0" | ✅ |
| VF-14 | passed=true when only warnings | ✅ |
| VF-15 | patchApplied=true → targetType is "patch" | ✅ |
| VF-16 | patchApplied=false → targetType is "artifact" | ✅ |
| VF-17 | patchApplied=true + non-empty content → passed=true | ✅ |
| VF-18 | patchApplied=true + valid lineage → lineageValid=true | ✅ |
| VF-19 | patchApplied=true + lineage mismatch → VF-004 error | ✅ |
| — | verificationToLedgerEntry produces correct counts | ✅ |
| — | minimal export default function passes VF-003 | ✅ |
| — | all security flags false → security checks pass | ✅ |
| — | null actual revisionId with non-null expected → VF-004 warning | ✅ |

**Artifact Verifier 单测结果：23/23 PASS ✅**

---

### A.3 单测汇总

| **Test File** | **Tests** | **Result** |
|---|---:|---:|
| `quality-router.test.ts` | 19 | ✅ 19/19 |
| `artifact-verifier.test.ts` | 23 | ✅ 23/23 |
| S67P E2E runtime proof | 6 | ✅ 6/6 |
| **Total** | **48** | **✅ 48/48** |

---

## B. `patchFirstAfter` 替代语义（PM 阻塞点 2 已消除）

### B.1 正式 PM 口径

```
patchFirstAfter is not persisted in S67P V0 (deferred to S68P).

Instead, the effective final patch-first state is fully derivable from three
degradation flags that ARE persisted in the ledger as of S67P:

  - patchFirstBefore          (snapshot before quality routing decision)
  - patchFirstDowngradedByQuality (hard disable: force_full_rewrite / block_or_full_rewrite)
  - patchFirstDegradedByWarning   (advisory: prefer_full_rewrite, V0 does NOT hard-disable)
  - qualityRouting.decision   (the routing outcome itself)

These four fields together are sufficient to unambiguously determine
the effective patch-first state without any additional field.
```

### B.2 决策 → 最终状态映射表

| **qualityRouting.decision** | **patchFirstBefore** | **Quality Flag Set** | **Effective patchFirst After** | **Hard Disabled?** |
|---|:---:|---|:---:|:---:|
| `allow_patch_first` | `true` | — (none) | `true` | ❌ |
| `prefer_full_rewrite` | `true` | `patchFirstDegradedByWarning=true` | `true` (V0 advisory) | ❌ (advisory only) |
| `force_full_rewrite` | `true` | `patchFirstDowngradedByQuality=true` | `false` | ✅ |
| `block_or_full_rewrite` | `true` | `patchFirstDowngradedByQuality=true` | `false` | ✅ |
| `allow_patch_first` | `false` | — (no artifact) | `false` | N/A (initial ineligible) |
| `allow_patch_first` | `true` | — (no prior verification) | `true` | ❌ |

### B.3 `patchFirstDegradedByWarning` 字段语义正式固化

```
patchFirstDegradedByWarning = true

Meaning:
  The quality router emitted a "prefer_full_rewrite" advisory preference.
  This is a SOFT signal only. Patch-first is NOT hard-disabled in S67P V0.
  The field name uses "degraded" (not "downgraded") to distinguish advisory from hard disable.

Hard disable is ONLY indicated by:
  patchFirstDowngradedByQuality = true

Three-tier taxonomy (S67P V0 canonical):
  Tier 1  allow_patch_first               → no degradation flag set
  Tier 2  prefer_full_rewrite  (advisory) → patchFirstDegradedByWarning=true
  Tier 3  force/block          (hard)     → patchFirstDowngradedByQuality=true
```

> **S68P follow-up:** `patchFirstAfter` can be materialized as a derived boolean if downstream consumers (e.g., patch executor) need a single-field read. It would be computed as `patchFirstBefore && !patchFirstDowngradedByQuality`. The advisory flag would be consulted separately for preference routing.

---

## C. E2E 6 Case 明细（PM 签字留痕）

### C.1 Case 矩阵（从 test-s67p-e2e.mjs 脚本提取，E2E 实际运行值）

| **Case** | **Label** | **Purpose** | **Input** | **Expected Decision** | **Expected Flags** | **PASS** |
|---|---|---|---|---|---|---:|
| P1 | No activeArtifact (create path) | 验证 create path 无 artifact 时 patchFirstBefore=false | history 无 artifact meta | `allow_patch_first` | patchFirstBefore=false, degradedByWarning=false, downgraded=false | ✅ |
| P2 | Good (score=0.9) — full eligible path | 验证正常全链路 eligible | score=0.9, verification.passed=true | `allow_patch_first` | patchFirstBefore=true, degradedByWarning=false, downgraded=false | ✅ |
| C2 | Warning (score=0.75) — advisory degraded | 验证 advisory warning 标记写入 ledger | score=0.75, VF-003 warning | `prefer_full_rewrite` | patchFirstBefore=true, **degradedByWarning=true**, downgraded=false | ✅ |
| C3 | Bad (score=0.4) — hard downgrade | 验证 hard downgrade 路径 | score=0.4, VF-002 error | `force_full_rewrite` | patchFirstBefore=true, degradedByWarning=false, **downgraded=true** | ✅ |
| C4 | Security (VF-006) — hard block | 验证安全干预路径 | score=0.0, VF-006 error | `block_or_full_rewrite` | patchFirstBefore=true, degradedByWarning=false, **downgraded=true** | ✅ |
| P3 | Has artifact, no prior verification | 验证首次 revision 无 verification 时的 fallback | artifact 存在但 meta 无 verification | `allow_patch_first` | patchFirstBefore=true, source=no_prior_verification | ✅ |

**E2E: 6/6 PASS ✅**

### C.2 S66P vs S67P case 覆盖对比

| **维度** | **S66P** | **S67P** |
|---|---|---|
| Good / allow_patch_first | ✅ (Case 1) | ✅ (Case P2) |
| Warning / prefer_full_rewrite | ✅ (Case 2) | ✅ (Case C2) + advisory flag 验证 |
| Bad / force_full_rewrite | ✅ (Case 3) | ✅ (Case C3) + patchFirstBefore 验证 |
| Security / block_or_full_rewrite | ✅ (Case 4) | ✅ (Case C4) + patchFirstBefore 验证 |
| create path (no artifact) | ❌ 未覆盖 | ✅ **新增 Case P1** |
| first revision (no prior verification) | ❌ 未覆盖 | ✅ **新增 Case P3** |

S67P 比 S66P 多覆盖两个 edge case（P1/P3），且每个 case 新增了 `patchFirstBefore` 和两个 degradation flag 的精确断言。

---

## D. PM 阻塞点结清汇总

| **PM 阻塞点** | **状态** | **证据** |
|---|:---:|---|
| 单测 skipped | ✅ 已消除 | quality-router 19/19 + artifact-verifier 23/23，实际运行于 2026-05-20 09:56 |
| patchFirstAfter 语义不明 | ✅ 已消除 | Section B 映射表 + 三层分类法正式固化；final state 由 patchFirstBefore + downgraded + degradedByWarning 无歧义推导 |
| E2E case 明细未贴出 | ✅ 已消除 | Section C 6 case 完整展开，含 input/expected/flags/PASS |

---

## E. PM Conclusion Requested

S67P closure 条件全部满足：

| **验收条目** | **状态** |
|---|---:|
| origin = `5ba457b` (三端同步) | ✅ |
| E2E runtime proof 6/6 PASS | ✅ |
| quality-router.test.ts 19/19 PASS | ✅ |
| artifact-verifier.test.ts 23/23 PASS | ✅ |
| S66P 4 项 known limitation 已处置 | ✅ |
| patchFirstBefore 进入 ledger | ✅ |
| patchFirstDegradedByWarning 进入 ledger | ✅ |
| patchFirstDowngradedByQuality 已存在 | ✅ |
| patchFirstAfter 替代语义明确（flags 无歧义推导） | ✅ |
| Warning advisory 语义文档固化，不阻断 patch-first | ✅ |
| S64P/S65P/S66P 字段全部保持 | ✅ |

**请 PM 对 `5ba457b` 签：**

```
Sprint 67P — Quality Ledger Hardening V0 — CLOSED ✅
```

---

*Addendum prepared by: 蟹小钳 🦀*
*Baseline: `5ba457b` | Sprint: S67P | Date: 2026-05-20*
