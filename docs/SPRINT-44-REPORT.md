# Sprint 44 Report — LLM-Native Routing Benchmark Baseline

**Date**: 2026-04-20
**Status**: ✅ COMPLETE
**Branch**: `master` (V2 repo)

---

## Goals

1. Run LLM-Native Routing Benchmark with local Ollama models
2. Fix benchmark script bugs
3. Establish baseline accuracy metrics
4. Integrate Ollama provider into benchmark harness

---

## Results

### SiliconFlow Qwen2.5-7B (Fast Layer)

| Metric | Result | CI Threshold | Status |
|--------|--------|-------------|--------|
| Mode Accuracy | ~66% | ≥50% | ✅ PASS |
| Intent Accuracy | ~20% | ≥70% | ❌ FAIL |
| Layer Accuracy | ~53% | — | Reference |

**By Layer**:
| Layer | Accuracy | Notes |
|-------|----------|-------|
| L0 (fast) | 100% | Perfect |
| L1 (medium) | 100% | Perfect |
| L2 (slow) | 25-50% | Core bottleneck |

**By Intent** (weakest):
| Intent | Accuracy | Notes |
|--------|----------|-------|
| code | ~12% | Weakest |
| reasoning | ~10% | Weakest |
| math | ~40% | Weak |

### Ollama Gemma 4B (Local)

| Metric | Result | Notes |
|--------|---------|-------|
| Mode Accuracy | 45.5% | All tasks routed to fast |
| Intent Accuracy | ~5% | 95% output "general" |
| Layer Accuracy | 30.3% | All L0 |
| Latency | ~19s/case | 5x slower than SiliconFlow |

**Conclusion**: Gemma 4B is worse than Qwen2.5-7B for routing. Not suitable as Fast layer router.

---

## Root Cause

**7B Model Capability Ceiling**: Qwen2.5-7B is inherently conservative about delegating to slow model. Intent accuracy (< 70% CI threshold) requires stronger model (14B+).

Prompt engineering attempts (expanding `delegate_to_slow` criteria) made things worse — model gets confused with too many rules.

---

## Bugs Fixed

1. **benchmark-routing.cjs**: Mode comparison used raw `"direct_answer"` vs expected `"fast"` — fixed by applying `normalizeMode()` to SiliconFlow results too
2. **eval routing path**: `/api/chat/eval/routing` → `/api/eval/routing`
3. **Ollama model names**: `isOpenAICompatible()` now supports `model.includes(":")` format

---

## Ollama Integration

- `benchmark-routing.cjs --provider ollama`: Direct Ollama API call, bypasses backend
- Available models: `gemma4:e4b` (9.6GB), `qwen3:4b` (2.5GB)
- qwen3:4b does NOT support `/v1/chat/completions` (empty response)
- gemma4:e4b supports `/v1` but has poor routing capability

---

## Next Steps (Sprint 45)

- Accept current baseline: Mode passes CI (50%), Intent needs stronger model
- OR upgrade Fast layer to Qwen2.5-14B+ for Intent CI compliance
- See `docs/ROADMAP-2026Q2.md` for full roadmap

---

## Commits

| SHA | Description |
|-----|-------------|
| `afe5434` | Initial V2 repo: 118 files (src + tests + configs) |
| (pending) | Sprint 44 docs migration + benchmark fixes |
