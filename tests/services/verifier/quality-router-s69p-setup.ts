/**
 * S69P vitest setup — runs BEFORE any module is loaded.
 *
 * Mocks pg.Pool and key repositories so that:
 *   - index.ts startup: query("SELECT 1") succeeds → no process.exit(1)
 *   - checkDbAvailability: probe pool query() FAILS → returns false
 *   - TaskArchiveRepo.findActiveBySession: returns null (no active task)
 *   - All other repo calls: return safe empty values
 */
import { vi } from "vitest";

let _queryCallCount = 0;

vi.mock("pg", () => ({
  default: {
    Pool: vi.fn().mockImplementation(() => ({
      query: vi.fn().mockImplementation(() => {
        _queryCallCount++;
        if (_queryCallCount === 1) {
          // First call (index.ts startup "SELECT 1"): succeed
          return Promise.resolve({ rows: [] });
        } else {
          // All subsequent calls: throw → checkDbAvailability returns false
          return Promise.reject(new Error("DB unavailable"));
        }
      }),
      on: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));
