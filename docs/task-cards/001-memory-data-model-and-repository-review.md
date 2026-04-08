# MC-001 Review: Memory Data Model + Repository

## Result
Completed

---

## What Was Delivered

### 1. Schema (`backend/src/db/schema.sql`)
Added `memory_entries` table with columns:
- `id` VARCHAR(36) PRIMARY KEY
- `user_id` VARCHAR(36) NOT NULL
- `category` VARCHAR(50) NOT NULL
- `content` TEXT NOT NULL
- `importance` INTEGER NOT NULL DEFAULT 3
- `tags` TEXT[] DEFAULT '{}'
- `source` VARCHAR(50) NOT NULL DEFAULT 'manual'
- `created_at` TIMESTAMPTZ DEFAULT NOW()
- `updated_at` TIMESTAMPTZ DEFAULT NOW()

Indexes added:
- `idx_me_user` on (user_id)
- `idx_me_user_importance` on (user_id, importance DESC, updated_at DESC) — covers getTopForUser ordering
- `idx_me_user_category` on (user_id, category)

Style matches existing tables (behavioral_memories, identity_memories):
- VARCHAR(36) for ids (not UUID)
- TIMESTAMPTZ for timestamps
- TEXT[] for array fields

### 2. Type Definitions (`backend/src/types/index.ts`)
Added:
- `MemoryCategory` — union type: "preference" | "fact" | "context" | "instruction"
- `MemorySource` — union type: "manual" | "extracted" | "feedback"
- `MemoryEntry` — full outward-facing interface with ISO 8601 string timestamps
- `MemoryEntryInput` — input DTO for create (omits id + timestamps)
- `MemoryEntryUpdate` — partial update DTO for update

### 3. Repository (`backend/src/db/repositories.ts`)
Added `MemoryEntryRepo` with 6 methods:
- `create(data)` — INSERT + RETURNING, sets id + timestamps, defaults importance=3, source='manual'
- `getById(id, userId)` — ownership check on user_id
- `list(userId, opts?)` — optional category filter + limit; ordered by updated_at DESC
- `update(id, userId, data)` — partial update, dynamic SET list, ownership check
- `delete(id, userId)` — ownership check, returns boolean
- `getTopForUser(userId, limit)` — ordered by importance DESC, updated_at DESC; used by MC-003 injection

Helper `mapMemoryRow()` — normalizes raw DB row to `MemoryEntry` with ISO 8601 timestamps (TC-007 convention).

---

## Design Decisions

### Why `TEXT[]` for tags (same as behavioral_memories.domains)
PostgreSQL TEXT[] is natively supported by `pg` (node-postgres). Existing tables already use it. Keeping consistent avoids introducing a new serialization concern at this stage.

### Why dynamic SQL SET list in `update()`
Using a loop to build `sets[]` array allows partial updates without requiring all fields. Avoids overwriting with nulls if only one field is passed.

### Why `RETURNING *` in create/update
Avoids a second round-trip. Maps directly via `mapMemoryRow()`.

---

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| `memory_entries` table defined in schema.sql | ✅ |
| `MemoryEntry` TypeScript type exported | ✅ |
| All 6 repo methods compile and are accessible | ✅ |
| All repo methods return ISO 8601 strings for time fields | ✅ |
| TypeScript build passes zero errors | ✅ |
| Repo methods validate user ownership on read/update/delete | ✅ |

---

## Outward API Time Convention
Per TC-007: all outward-facing time fields return ISO 8601 strings.
`created_at` and `updated_at` on `MemoryEntry` follow this convention via `mapMemoryRow()`.
Internal DB storage format (TIMESTAMPTZ) is unchanged.

---

## Non-Goals Enforced
- Memory APIs (MC-002) — not touched
- Prompt injection (MC-003) — repo layer ready but not wired
- Autonomous extraction — not implemented
- Tag management UI — not implemented

---

## Known Notes for MC-002 and MC-003
- `MemoryEntryRepo.getTopForUser(userId, limit)` is the primary read path for prompt injection (MC-003)
- `MemoryEntryInput.importance` defaults to 3 in repo (not in API layer — MC-002 can enforce range 1-5 before calling repo)
- `MemoryEntryInput.source` defaults to 'manual' in repo; MC-002 may want to restrict write access to 'extracted'/'feedback' to system-only
- Mount path for MC-002 APIs: `/v1/memory` (consistent with task path `/v1/tasks`)

---

## Files Changed
```
backend/src/db/schema.sql         — ADD memory_entries table + 3 indexes
backend/src/types/index.ts         — ADD MemoryEntry, MemoryCategory, MemorySource, MemoryEntryInput, MemoryEntryUpdate
backend/src/db/repositories.ts     — ADD MemoryEntryRepo (6 methods) + mapMemoryRow helper
```
