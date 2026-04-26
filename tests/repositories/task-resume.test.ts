// workspace: 20260416214742
/**
 * T1: Task Resume v1 — Repository tests for findActiveBySession
 *
 * Tests the TaskRepo.findActiveBySession() method which is the core of
 * implicit task resumption (Task Resume v1, 方案 C).
 *
 * DB prerequisite: PostgreSQL must be running.
 * If DB is unavailable, all tests fail with ECONNREFUSED — this is an
 * infrastructure issue, not a code issue.
 *
 * Infrastructure: tests/db/harness.ts → createTestTask()
 */
import { TaskRepo } from "../../src/db/repositories.js";
import {
  truncateTables,
  createTestTask,
  withTestUser,
} from "../db/harness.js";

const USER_A = "task-resume-test-user-a";
const USER_B = "task-resume-test-user-b";

beforeEach(async () => {
  await truncateTables();
});

describe("TaskRepo.findActiveBySession", () => {
  it(
    "returns the most recent non-terminal task for session+user",
    async () => {
      const userId = USER_A;
      const sessionId = "test-session-resume-1";

      // Create a completed task (should NOT be returned)
      await createTestTask({ userId, sessionId, status: "completed" });

      // Create a responding task (should be returned — most recent active)
      await createTestTask({ userId, sessionId, status: "responding" });

      // Create another responding task (newer, should be returned instead)
      const newerTask = await createTestTask({
        userId,
        sessionId,
        status: "responding",
      });

      const result = await TaskRepo.findActiveBySession(sessionId, userId);

      expect(result).not.toBeNull();
      // Must be the most recently updated one
      expect(result!.task_id).toBe(newerTask.task_id);
      expect(result!.status).toBe("responding");
    }
  );

  it(
    "excludes completed, failed, and cancelled tasks",
    async () => {
      const userId = USER_A;
      const sessionId = "test-session-resume-2";

      await createTestTask({ userId, sessionId, status: "completed" });
      await createTestTask({ userId, sessionId, status: "failed" });
      await createTestTask({ userId, sessionId, status: "cancelled" });

      const result = await TaskRepo.findActiveBySession(sessionId, userId);

      expect(result).toBeNull();
    }
  );

  it(
    "returns null when no tasks exist for session",
    async () => {
      const userId = USER_A;
      const result = await TaskRepo.findActiveBySession(
        "non-existent-session",
        userId
      );
      expect(result).toBeNull();
    }
  );

  it(
    "only returns tasks belonging to the specified user",
    async () => {
      const userA = USER_A;
      const userB = USER_B;
      const sessionId = "test-session-resume-3";

      // Task belonging to userA
      await createTestTask({
        userId: userA,
        sessionId,
        status: "responding",
      });

      // Task belonging to userB in same session (should NOT be returned for userA)
      await createTestTask({
        userId: userB,
        sessionId,
        status: "responding",
      });

      const result = await TaskRepo.findActiveBySession(sessionId, userA);

      expect(result).not.toBeNull();
      expect(result!.user_id).toBe(userA);
    }
  );

  it(
    "returns the single active task when only one exists",
    async () => {
      const userId = USER_A;
      const sessionId = "test-session-resume-4";
      const task = await createTestTask({
        userId,
        sessionId,
        status: "paused",
      });

      const result = await TaskRepo.findActiveBySession(sessionId, userId);

      expect(result).not.toBeNull();
      expect(result!.task_id).toBe(task.task_id);
      expect(result!.status).toBe("paused");
    }
  );
});
