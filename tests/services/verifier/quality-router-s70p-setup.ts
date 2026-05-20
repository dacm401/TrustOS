/**
 * S70P: Seed test data into smartrouter_test DB.
 *
 * Usage:
 *   import "./quality-router-s70p-setup.ts";   // runs seed before any test in the file
 *
 * Tables seeded: memory_entries (3 entries for TEST_USER_ID)
 *
 * If seeding fails (DB not ready or not available), the import throws and
 * vitest marks all S70P tests as FAILED — which is correct behavior.
 * Docker must be running before running S70P tests.
 */
import { MemoryEntryRepo } from "../../../src/db/repositories/index.js";

export const TEST_USER_ID = "s70p-test-user";

async function seedTestData(): Promise<void> {
  console.log("[s70p-setup] Seeding test data into smartrouter_test DB...");

  await MemoryEntryRepo.create({
    user_id: TEST_USER_ID,
    category: "instruction",
    content: "Always use simplified Chinese for responses",
    importance: 5,
    tags: ["language", "chinese"],
    source: "manual",
  });

  await MemoryEntryRepo.create({
    user_id: TEST_USER_ID,
    category: "preference",
    content: "Prefers concise answers with code examples",
    importance: 4,
    tags: ["style", "code"],
    source: "manual",
  });

  await MemoryEntryRepo.create({
    user_id: TEST_USER_ID,
    category: "fact",
    content: "User works in financial data analysis domain",
    importance: 3,
    tags: ["domain", "finance"],
    source: "auto_learn",
  });

  console.log(`[s70p-setup] Seeded 3 memory entries for user: ${TEST_USER_ID}`);
}

// Top-level await — throws if seed fails (vitest catches and marks test FAILED)
await seedTestData();
console.log("[s70p-setup] Seed complete.");
