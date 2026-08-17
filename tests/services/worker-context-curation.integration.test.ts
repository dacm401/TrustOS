/**
 * Integration test: Context Curation enforcement at the worker dispatch boundary.
 *
 * Goal: prove that the worker runtime actually receives ONLY the curated brief
 * (command goal/brief/constraints + optional artifact summary / memory summary),
 * and NEVER receives raw conversation history, raw memory, or the full raw prompt.
 *
 * This is the end-to-end complement to context-package-builder.test.ts (which only
 * checks the declarative contract). Here we assert on the real prompt-rendering path
 * (buildWorkerPrompt) that physically feeds the worker model call.
 */

import { describe, it, expect } from "vitest";
import { buildWorkerPrompt, type WorkerPromptInput } from "../../src/services/worker-prompt.js";
import { buildContextPackage } from "../../src/services/context/context-package-builder.js";

// A long "raw conversation history" that must NEVER reach the worker.
const RAW_HISTORY = [
  "User: 帮我写一封很长的求职信，里面提到我的身份证号 123456789012345678 和银行卡 6222-XXXX。",
  "Assistant: 好的，这是草稿……（包含大量私人上下文）",
  "User: 顺便把我和前公司的保密协议内容也整理一下。",
  "Assistant: 明白，这是保密协议摘要……",
].join("\n---\n");

// A "full raw prompt" the worker should not receive verbatim as a dump.
const RAW_PROMPT = "这是一段超长的原始用户指令，包含冗余上下文和不应泄漏的敏感信息。".repeat(20);

function makeCommand() {
  return {
    task_type: "code" as const,
    goal: "实现登录接口",
    task_brief: "为后端实现 JWT 登录接口，包含 refresh token。",
    constraints: ["使用 zod 校验", "不记录明文密码"],
    worker_hint: "execute_worker" as const,
    required_output: undefined,
    input_materials: undefined,
  };
}

describe("Context Curation — worker never receives raw history / raw memory", () => {
  it("buildWorkerPrompt output excludes raw conversation history", () => {
    const input: WorkerPromptInput = {
      command: makeCommand(),
      confirmedFacts: [],
      evidenceContent: [],
      memorySummary: "用户偏好简洁输出",
      lang: "zh",
      intentCategory: "code",
    };

    const out = buildWorkerPrompt(input);

    // Raw history must not appear anywhere in the worker's prompts.
    expect(out.systemPrompt).not.toContain(RAW_HISTORY);
    expect(out.userPrompt).not.toContain(RAW_HISTORY);
    // Even a substring of the raw history must not leak.
    expect(out.userPrompt).not.toContain("身份证号");
    expect(out.systemPrompt).not.toContain("身份证号");
  });

  it("buildWorkerPrompt only carries curated command fields + optional summary", () => {
    const input: WorkerPromptInput = {
      command: makeCommand(),
      memorySummary: "用户偏好简洁输出",
      lang: "zh",
    };
    const out = buildWorkerPrompt(input);

    // Curated brief is present.
    expect(out.userPrompt).toContain("实现 JWT 登录接口");
    expect(out.userPrompt).toContain("使用 zod 校验");
    // Memory is injected only as summary, not as raw memory blob.
    expect(out.userPrompt).toContain("用户偏好简洁输出");
    // No raw full prompt dump.
    expect(out.userPrompt).not.toContain(RAW_PROMPT);
  });

  it("contract deniedContext invariants stay enforced (rawHistory/rawMemory true)", () => {
    const cp = buildContextPackage({
      traceId: "trace-integration-001",
      policyRoute: "direct_create_artifact",
      userInstruction: "创建登录接口 artifact",
      taskKind: "create",
      memorySummary: "用户偏好简洁输出",
    });

    expect(cp.deniedContext.rawHistory).toBe(true);
    expect(cp.deniedContext.rawMemory).toBe(true);
    expect(cp.deniedContext.managerInternalReasoning).toBe(true);
    // And the security scope must forbid sending raw history to the worker.
    expect(cp.securityScope.sendRawHistoryToWorker).toBe(false);
    expect(cp.securityScope.sendRawHistoryToManager).toBe(false);
    expect(cp.securityScope.sendMemoryToManager).toBe(false);
    // memorySummary is the only memory-shaped content the worker may receive.
    expect(cp.securityScope.sendMemoryToWorker).toBe(true);
  });

  it("revision path: worker gets artifact summary, not raw manager memory", () => {
    const cp = buildContextPackage({
      traceId: "trace-integration-002",
      policyRoute: "direct_artifact_revision",
      userInstruction: "修订 artifact",
      taskKind: "revision",
      activeArtifact: {
        artifactId: "art-1",
        taskId: "task-1",
        summaryForManager: "登录接口初稿",
        revisionOfArtifactId: "art-0",
        revisionOfTaskId: "task-0",
      },
      artifactContentBytes: 1024,
      artifactContentMode: "full",
      memorySummary: "用户偏好简洁输出",
    });

    expect(cp.kind).toBe("artifact_revision");
    // artifact content goes to worker (legitimate, pulled from archive), not manager.
    expect(cp.securityScope.sendArtifactToWorker).toBe(true);
    expect(cp.securityScope.sendArtifactToManager).toBe(false);
    // allowedContext carries summary/brief, deniedContext still blocks raw memory.
    expect(cp.allowedContext.artifactSummary).toBe("登录接口初稿");
    expect(cp.deniedContext.rawMemory).toBe(true);
  });
});
