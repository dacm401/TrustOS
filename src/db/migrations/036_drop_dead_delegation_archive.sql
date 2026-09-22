-- RFC-002 Phase 0a: drop the dead/empty delegation_archive table.
-- It was a duplicate of task_archives and was never written at runtime
-- (the only consumer, archive-replay.ts, now reads task_archives directly).
-- Kept as a migration so existing databases (which may still have the empty
-- table) get it removed; fresh init no longer creates it (see schema.sql).
DROP TABLE IF EXISTS delegation_archive;
