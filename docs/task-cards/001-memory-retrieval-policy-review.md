# MR-001 Review: Memory Retrieval Policy

## Result
**Completed** ✅

---

## What Was Delivered

### 1. New Types (`backend/src/types/index.ts`)

Added three new interfaces for the v2 retrieval pipeline:

- **`MemoryRetrievalContext`** — carries retrieval context from the chat request: `userMessage` (required) + `keywords` (optional, reserved for MR-003 auto-extraction)
- **`MemoryRetrievalResult`** — wraps a `MemoryEntry` with `score: number` and human-readable `reason: string`
- **`MemoryCategoryPolicy`** — per-category injection policy: `minImportance`, `alwaysInject`, `maxCount`

### 2. Retrieval Configuration (`backend/src/config.ts`)

Extended `config.memory` with a new `retrieval` section:

```ts
retrieval: {
  strategy: "v1" | "v2"  // controlled via MEMORY_RETRIEVAL_STRATEGY env var
  categoryPolicy: {
    instruction: { minImportance: 3, alwaysInject: true, maxCount: 2 },
    preference:  { minImportance: 4, alwaysInject: false, maxCount: 2 },
    fact:        { minImportance: 4, alwaysInject: false, maxCount: 1 },
    context:     { minImportance: 4, alwaysInject: false, maxCount: 1 },
  }
}
```

- Default strategy is `"v1"` (no behavior change unless explicitly enabled)
- Category policies are config-driven, not hard-coded in the pipeline

### 3. Retrieval Service (`backend/src/services/memory-retrieval.ts`)

New file implementing the v2 retrieval pipeline.

**Scoring model (fixed weights, explainable):**

| Component | Max Points | Basis |
|---|---|---|
| Importance | 30 | `importance × 6` |
| Recency | 20 | Exponential decay, half-life ~10 days |
| Keyword match | 10 | Token overlap with `userMessage` |

**Pipeline stages:**

1. Score all candidate entries (importance + recency + keyword)
2. Check category eligibility via `categoryPolicy`
3. AlwaysInject categories fill first (up to `maxCount` each)
4. Remaining slots filled by highest-scoring relevance-gated entries
5. Result sorted by score descending

**Key properties:**
- Every score has a `reason` string (e.g., `"importance=5 | recency=18pts(age=2.3d) | keywords=project"`), making the pipeline auditable
- If v2 returns zero results, falls back to v1 (no silent failures)
- No external ML or vector DB dependencies

### 4. Chat Integration (`backend/src/api/chat.ts`)

Upgraded the memory injection block to support the v2 pipeline:

- `strategy === "v1"`: flat `getTopForUser()` ordering (identical to MC-003, no change)
- `strategy === "v2"`: runs `runRetrievalPipeline()`, candidate pool = `1.5×` injection limit
- v2 fallback to v1 if pipeline returns empty
- Feature flag safe: existing deployments with `MEMORY_RETRIEVAL_STRATEGY` unset continue unchanged

---

## Design Decisions

### Why scoring in JavaScript, not SQL?
SQL `ORDER BY` can only sort by a single dimension. Retrieval scoring requires combining multiple signals (importance + recency + keyword) with different scales and weights — SQL is not expressive enough here without stored procedures. Keeping scoring in the service layer also makes it easier to inspect, test, and modify.

### Why v1 as the default?
The v2 pipeline introduces behavioral changes to memory injection. Defaulting to v1 means zero disruption to existing users. The retrieval strategy can be flipped per-deployment via env var without code changes.

### Why `categoryPolicy` not enum-based policy classes?
A config-based map (`Record<string, MemoryCategoryPolicy>`) is more flexible than enum-based inheritance. Adding a new category only requires adding an entry to the config map — no code changes needed for policy tuning.

---

## Acceptance Criteria Status

| Criterion | Status | Notes |
|---|---|---|
| `MemoryRetrievalContext` and `MemoryRetrievalResult` types exported | ✅ | |
| `runRetrievalPipeline()` implements explainable scoring | ✅ | reason strings on every result |
| `categoryPolicy` config-driven | ✅ | Defined in `config.ts` |
| v1 behavior unchanged by default | ✅ | Default strategy is "v1" |
| v2 fallback to v1 on empty results | ✅ | |
| TypeScript build passes zero errors | ✅ | `npx tsc --noEmit` clean |
| MR-001 review doc completed | ✅ | This file |

---

## Non-Goals Enforced
- MR-002 Category-Aware Injection config wiring — configured but not yet enforced in chat path beyond pipeline
- MR-003 keyword auto-extraction from userMessage — `keywords` field in context reserved as future extension
- Vector-based semantic search — reserved for Memory v3
- Memory deduplication or conflict resolution

---

## Files Changed

```
backend/src/types/index.ts                    — ADD MemoryRetrievalContext, MemoryRetrievalResult, MemoryCategoryPolicy
backend/src/config.ts                         — ADD memory.retrieval config section
backend/src/services/memory-retrieval.ts      — NEW retrieval pipeline service
backend/src/api/chat.ts                        — MOD upgrade memory injection to support v2 pipeline
```

---

_Completed: 2026-04-08_
