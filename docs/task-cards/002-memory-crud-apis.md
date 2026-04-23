# Task Card 002: Memory CRUD APIs

## Goal
Implement REST endpoints for memory entry CRUD operations.

---

## Scope

### Routes (mounted at `/v1/memory`)

#### POST /v1/memory — Create
Request body:
```ts
{
  category: "preference" | "fact" | "context" | "instruction";
  content: string;      // required, non-empty
  importance?: number;  // optional, 1–5, default 3
  tags?: string[];      // optional, default []
  source?: string;      // optional, default "manual"
}
```
Response: `201` with created `MemoryEntry`
Errors: `400` for validation failure

#### GET /v1/memory — List
Query params:
- `user_id` (required, default `"default-user"`)
- `category` (optional filter)
- `limit` (optional, default 50, max 100)

Response: `200` with `{ entries: MemoryEntry[] }`

#### GET /v1/memory/:id — Get single
Response: `200` with `{ entry: MemoryEntry }`
Errors: `404` if not found or not owned by user

#### PUT /v1/memory/:id — Update
Request body: partial fields
```ts
{
  content?: string;
  importance?: number;
  tags?: string[];
  category?: "preference" | "fact" | "context" | "instruction";
}
```
Response: `200` with updated `MemoryEntry`
Errors: `404` if not found or not owned

#### DELETE /v1/memory/:id — Delete
Response: `204` on success
Errors: `404` if not found or not owned

### Implementation Notes
- Use `MemoryEntryRepo` from MC-001
- All endpoints require `user_id` — default to `"default-user"` if absent
- PUT and DELETE must verify `user_id` ownership before proceeding
- Consistent error shape: `{ error: string }`

---

## Non-Goals
- Memory injection into prompts (MC-003)
- Authentication / multi-user isolation beyond `user_id` field
- Batch operations

---

## Acceptance Criteria
- All 5 endpoints functional and return correct HTTP status codes
- Request validation in place for POST and PUT
- 404 returned for non-existent or unowned entries
- TypeScript build passes with zero errors
- Regression: existing `/api/chat` and task APIs unaffected

---

## File Changes
```
backend/src/api/memory.ts   — NEW router file
backend/src/index.ts        — mount at /v1/memory (or /v1/memories — decide before impl)
```
