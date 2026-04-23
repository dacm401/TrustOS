# Task Card 001: Memory Data Model + Repository

## Goal
Define the `memory_entries` table schema, TypeScript types, and `MemoryEntryRepo` CRUD operations.

---

## Scope

### Database
Define `memory_entries` table:
```sql
CREATE TABLE IF NOT EXISTS memory_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR(255) NOT NULL,
  category    VARCHAR(50) NOT NULL,      -- "preference" | "fact" | "context" | "instruction"
  content     TEXT NOT NULL,
  importance  INT NOT NULL DEFAULT 3,    -- 1–5, higher = more important
  tags        TEXT[] DEFAULT '{}',
  source      VARCHAR(50) NOT NULL DEFAULT 'manual',  -- "manual" | "extracted" | "feedback"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_user_id ON memory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_user_importance ON memory_entries(user_id, importance DESC);
```

### TypeScript Types (`backend/src/types/index.ts`)
Add `MemoryEntry` interface:
```ts
export interface MemoryEntry {
  id: string;
  user_id: string;
  category: "preference" | "fact" | "context" | "instruction";
  content: string;
  importance: number;   // 1–5
  tags: string[];
  source: "manual" | "extracted" | "feedback";
  created_at: string;   // ISO 8601 string (outward API)
  updated_at: string;
}
```

### MemoryEntryRepo (`backend/src/db/repositories.ts`)
Add to existing `repositories.ts`:
```ts
export const MemoryEntryRepo = {
  async create(data: Omit<MemoryEntry, "id" | "created_at" | "updated_at">): Promise<MemoryEntry>
  async getById(id: string, userId: string): Promise<MemoryEntry | null>
  async list(userId: string, opts?: { category?: string; limit?: number }): Promise<MemoryEntry[]>
  async update(id: string, userId: string, data: Partial<Pick<MemoryEntry, "content" | "importance" | "tags" | "category">>): Promise<MemoryEntry | null>
  async delete(id: string, userId: string): Promise<boolean>
  async getTopForUser(userId: string, limit: number): Promise<MemoryEntry[]>
}
```

**Rules:**
- `create`: set `id = uuid()`, `created_at = NOW()`, `updated_at = NOW()`
- `getById` / `update` / `delete`: always filter by `user_id` (ownership check)
- `getTopForUser`: ordered by `importance DESC, updated_at DESC`
- Return values: `created_at` / `updated_at` → ISO 8601 string (match TC-007 convention)

---

## Non-Goals
- Memory APIs (those are MC-002)
- Prompt injection (that is MC-003)
- Autonomous memory extraction
- Tag management UI

---

## Acceptance Criteria
- `memory_entries` table can be created via raw SQL
- `MemoryEntry` TypeScript type is exported from `types/index.ts`
- All 6 repo methods compile and are accessible
- All repo methods return ISO 8601 strings for time fields
- TypeScript build passes with zero errors
- Repo methods validate user ownership on read/update/delete

---

## File Changes
```
backend/src/types/index.ts              — ADD MemoryEntry interface
backend/src/db/repositories.ts          — ADD MemoryEntryRepo
```
