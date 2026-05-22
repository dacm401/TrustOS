// src/db/repositories/index.ts
// 统一导出所有 repository，保持向后兼容

export { DecisionRepo, FeedbackEventRepo } from "./decision-feedback.js";
export { GrowthRepo, MemoryEntryRepo, MemoryRepo } from "./memory-growth.js";
export { DelegationArchiveRepo, DelegationLogRepo } from "./delegation.js";
export { ExecutionResultRepo, EvidenceRepo } from "./execution.js";
export { TaskArchiveRepo, TaskRepo } from "./task-archive.js";
export {
  PermissionRequestRepo,
  PromptTemplateRepo,
  ScopedTokenRepo,
  SessionContextRepo,
  TaskWorkspaceRepo,
} from "./system.js";
export { HumanReviewRequestRepo } from "../human-review-repo.js";
export { HumanReviewResumeDecisionRepo } from "../human-review-decision-repo.js";
export { HumanReviewResumeExecutionRepo } from "../human-review-execution-repo.js";

// Re-export interfaces for convenience
export type { DelegationArchiveEntry } from "./delegation.js";
export type { TaskArchiveEntry } from "./task-archive.js";
export type {
  PermissionRequestInput,
  PermissionRequestRecord,
} from "./system.js";
export type { ScopedTokenRecord, TaskWorkspaceInput, TaskWorkspaceRecord } from "./system.js";
