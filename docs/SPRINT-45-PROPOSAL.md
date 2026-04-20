# Sprint 45 Proposal — Phase 5 Storage Backend Integration

**Date**: 2026-04-20
**Author**: 蟹小钳 🦀

---

## Context

Sprint 43 built `LocalArchiveStore` — a local filesystem storage backend.
Sprint 45's job: Connect real storage backends so the archive system is actually usable.

---

## Goals

1. Design a `StorageBackend` interface (abstraction layer)
2. Implement **S3-compatible** storage backend (MinIO / AWS S3 / R2)
3. Implement **PostgreSQL/pgvector** as query backend (archive metadata + semantic search)
4. Replace in-memory state with persistent storage
5. Write integration tests

---

## Scope

### P0 — Core
- [ ] `StorageBackend` interface: `save()`, `load()`, `delete()`, `list()`, `query()`
- [ ] `S3ArchiveStorage`: multipart upload, configurable bucket, TTL support
- [ ] `PGArchiveStorage`: metadata in Postgres, full-text + vector search via pgvector
- [ ] Config-driven backend selection (`STORAGE_BACKEND=s3|pg|local`)
- [ ] End-to-end test: save + retrieve + delete round-trip

### P1 — Polish
- [ ] Health checks for each backend
- [ ] Error handling: retry on transient failure, circuit breaker
- [ ] Archive cleanup: TTL-based eviction

### P2 — Future (out of scope)
- Multi-region replication
- Encryption at rest

---

## Technical Notes

### StorageBackend Interface

```typescript
interface ArchiveStorage {
  save(archive: TaskArchive): Promise<string>; // returns archiveId
  load(archiveId: string): Promise<TaskArchive | null>;
  delete(archiveId: string): Promise<void>;
  list(userId: string, limit?: number): Promise<string[]>;
}

interface ArchiveQueryBackend {
  query(embedding: number[], filters: QueryFilters): Promise<ArchiveSearchResult[]>;
  saveMetadata(meta: ArchiveMetadata): Promise<void>;
}
```

### Config

```bash
# .env
STORAGE_BACKEND=s3        # s3 | pg | local
S3_BUCKET=smartrouter-archives
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
DATABASE_URL=postgresql://...   # already configured
```

---

## Dependencies

- Docker: MinIO (local S3) + existing Postgres/pgvector
- Existing: `src/services/phase5/local-archive-store.ts`

---

## Deliverables

| Item | File |
|------|------|
| StorageBackend interface | `src/services/phase5/storage-backend.ts` |
| S3 implementation | `src/services/phase5/s3-archive-storage.ts` |
| PG implementation | `src/services/phase5/pg-archive-storage.ts` |
| Integration tests | `tests/services/phase5/integration.test.ts` |
| Config updates | `.env.example`, `src/config.ts` |
