# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start dev server (tsx watch, port 3001)
npm run build        # TypeScript compile
npm run dev:check    # Prerequisites health check (DB, Redis, ports)

# Testing — 3 separate vitest configs, never run together
npm run test         # Unit tests (vitest -- no DB needed)
npm run test:run     # Unit tests (single run)
npm run test:repos   # Repository + feature integration tests (requires DB)
npm run test:api     # API integration tests (requires DB, sequential files)
npm run test:coverage# Unit tests with coverage

# Docker
docker-compose up -d           # Start PostgreSQL, Redis, MinIO, Prometheus
docker-compose -f docker-compose.dev.yml up -d  # Dev stack (uses host DB)

# Evaluation runner
npm run benchmark              # Run full benchmark suite
npm run benchmark:routing      # Routing-specific benchmarks
```

## Architecture Overview

**TrustOS** is an LLM-native routing system with a Manager-Worker runtime. Its core idea: the bottleneck is not model capability but "who decides what information to show to whom."

### Gated Delegation v2 (Pipeline)

The core routing pipeline in `src/services/llm-native-router.ts`:

1. **G0**: Fast LLM produces ManagerDecision JSON with scores for 4 actions
2. **G1** (`gating/system-confidence.ts`): Calculate system confidence from decision features
3. **G2** (`gating/policy-calibrator.ts`): Apply policy rules (penalize/boost/block actions)
4. **G3** (`gating/delegation-reranker.ts`): Rule-based reranking when confidence is low
5. **G4**: Async learning loop — logs delegation outcomes for offline analysis

Four ManagerDecision actions: `direct_answer` (L0), `ask_clarification` (L0), `delegate_to_slow` (L2), `execute_task` (L3).

### Key Directories

| Path | Purpose |
|------|---------|
| `src/api/` | Hono route handlers (controllers — thin, request/response only) |
| `src/services/` | Business logic (llm-native-router, execution-loop, permission-manager, task-workspace, etc.) |
| `src/services/gating/` | G1–G3 gating submodules (system-confidence, policy-calibrator, delegation-reranker, knowledge-boundary-signals, hard-policy, sensitive-data-rule) |
| `src/services/phase3/` | Manager-Worker runtime (slow-worker-loop, execute-worker-loop, sse-poller, stream-v2) |
| `src/services/phase4/` | Security layer (data-classifier, permission-checker, redaction-engine, small-model-guard) |
| `src/services/phase5/` | Archive storage backends (local, s3, pg) + TTL eviction |
| `src/trust/` | TrustPolicy Engine (policy-engine, policy-rules, sanitizer, field-classification) |
| `src/models/` | Model gateway + providers (OpenAI, Anthropic) |
| `src/tools/` | Tool registry + definitions + executor |
| `src/db/` | Connection pool, repositories, migrations |
| `src/context/` | Token budget + context compressor |
| `src/logging/` | Decision logger + metrics calculator |
| `src/metrics/` | Prometheus metrics endpoint |
| `src/middleware/` | Identity (JWT + X-User-Id), rate limiting |
| `src/types/` | TypeScript types (index.ts — single-file, very large) |
| `src/config/` | Config, model pricing, model capability matrix |
| `src/features/` | Feedback collector, growth tracker, learning engine |
| `tests/` | Divided into `tests/api/`, `tests/repositories/`, `tests/features/`, `tests/middleware/`, `tests/db/` |

### Separation of Concerns (from dev-rules.md)

- **Controllers** (`src/api/`) handle request/response only — no business logic
- **Services** contain business logic — all model calls go through `model-gateway.ts`
- **DB access** via repositories in `src/db/repositories.ts` — no raw queries in controllers
- **Prompt assembly** through `prompt-assembler.ts` — never in controllers
- **Task state transitions** centralized — routes must not change task state directly

### Key Infrastructure

- **PostgreSQL 16 + pgvector** — primary store (schema at `src/db/schema.sql`, auto-loaded via docker-compose)
- **Redis** — cache layer for sessions, rate limiting
- **MinIO** — S3-compatible archive storage for Phase 5
- **Model providers**: SiliconFlow (default, for Qwen models), OpenAI, Anthropic — configured via `.env`

### Testing Strategy

Three isolated vitest processes (process isolation prevents module-level pool contamination):
- `vitest.config.ts` — unit tests (mocks, no DB), pool=forks, excludes repos/api/features
- `vitest.repo.config.ts` — repository + feature tests (real DB), pool=threads singleThread, has setup/teardown
- `vitest.api.config.ts` — API integration tests (real DB), fileParallelism=false

Each test file in the repo/API suites operates on `smartrouter_test` DB. Setup loads schema, teardown drops it.

### Phase 4 Security Layer (Feature-Gated)

Controlled by config settings (master kill switches):
- `permission.enabled` — Permission Layer master switch
- `permission.dataClassification` — Data Classification (local_only / local_summary_shareable / cloud_allowed)
- `permission.redaction` — Redaction Engine (email/phone/id card/API key/credit card/bank account/password)
- `permission.smallModelGuard` — Small Model Guard (jailbreak/prompt injection/command injection detection)
