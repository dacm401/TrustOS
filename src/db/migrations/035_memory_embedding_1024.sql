-- ══════════════════════════════════════════════════════════════════════════════
-- memory_entries.embedding: 1536 → 1024 dims
-- Migration 035
--
-- WHY
-- ──
-- The column was sized for OpenAI `text-embedding-3-small` (1536 dims), but
-- this deployment runs on SiliconFlow, whose Chinese embedding models
-- (`BAAI/bge-large-zh-v1.5`, `BAAI/bge-m3`) are 1024 dims.
--
-- Combined with a second bug (fixed alongside this migration): the OpenAI
-- embedding provider hardcoded https://api.openai.com and ignored
-- OPENAI_BASE_URL, so it sent the SiliconFlow key to openai.com and only
-- failed after a ~10.6s connection timeout. Net effect:
--
--   · getEmbedding() always returned null
--   · ALL 25 memory rows have embedding IS NULL (verified before migrating)
--   · retrieval silently degraded to keyword matching
--   · every candidate got an identical score → relevance recomputed to 0.00
--   · so only `inject: "always"` rules (instruction) ever fired —
--     the memories the user marked `public` (fact / preference) were never
--     selected, i.e. Stage C was wired up but delivered nothing.
--
-- SAFETY
-- ──
-- Verified before running: `SELECT count(*) FROM memory_entries
-- WHERE embedding IS NOT NULL` = 0. There are no existing vectors to
-- convert, so the column type can change without data loss. If vectors are
-- ever populated at 1536 dims, this migration must be replaced by a
-- backfill-with-reembed instead.
--
-- The HNSW index is dropped and recreated because it is bound to the
-- operator class of the old dimension.
--
-- Additive + reversible:
--   Down migration: ALTER COLUMN embedding TYPE vector(1536) USING NULL;
--   (then recreate the HNSW index)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- No rows carry a vector, so USING NULL is safe (see SAFETY above).
DROP INDEX IF EXISTS memory_entries_embedding_idx;

ALTER TABLE memory_entries
  ALTER COLUMN embedding TYPE vector(1024) USING NULL;

CREATE INDEX IF NOT EXISTS memory_entries_embedding_idx
  ON memory_entries USING hnsw (embedding vector_cosine_ops)
  WITH (m = '16', ef_construction = '64');

COMMIT;
