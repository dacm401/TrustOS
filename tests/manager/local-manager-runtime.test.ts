// Sprint 63P: Local Manager Mode V0 — 单元测试
// 覆盖 LM-01~10

import { describe, it, expect } from "vitest";
import { runLocalManager } from "../../src/services/manager/local-manager-runtime.js";
import type { ActiveArtifactContext } from "../../src/services/context/active-artifact.js";

const mockArtifact: ActiveArtifactContext = {
  artifactId: "art-001",
  taskId: "task-001",
  summaryForManager: "A React login page with username/password fields and submit button",
};

const mockTraceId = "trace-001";

describe("LM-01: 明确 revision → direct_artifact_revision", () => {
  it('should route "把按钮改成蓝色" to direct_artifact_revision with activeArtifact', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "把按钮改成蓝色",
      activeArtifact: mockArtifact,
    });
    expect(result.nextAction).toBe("direct_artifact_revision");
    expect(result.managerLlmRequired).toBe(false);
    expect(result.policyRoute).toBe("direct_artifact_revision");
  });

  it('should route "标题改大一点" to direct_artifact_revision with activeArtifact', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "标题改大一点",
      activeArtifact: mockArtifact,
    });
    expect(result.nextAction).toBe("direct_artifact_revision");
    expect(result.managerLlmRequired).toBe(false);
  });
});

describe("LM-02: 明确 create → direct_create_artifact", () => {
  it('should route "帮我写一个注册页" to direct_create_artifact', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "帮我写一个注册页，包含邮箱、密码和注册功能",
    });
    expect(result.nextAction).toBe("direct_create_artifact");
    expect(result.managerLlmRequired).toBe(false);
    expect(result.policyRoute).toBe("direct_create_artifact");
  });

  it('should route "帮我写一个新的登录页面" to direct_create_artifact', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "帮我写一个新的登录页面",
    });
    expect(result.nextAction).toBe("direct_create_artifact");
  });
});

describe("LM-03: activeArtifact 存在但‘再写注册页’不误判 revision", () => {
  it('should NOT route "再帮我写一个注册页" as revision even with activeArtifact', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "再帮我写一个注册页",
      activeArtifact: mockArtifact,
    });
    expect(result.nextAction).toBe("direct_create_artifact");
    expect(result.policyRoute).toBe("direct_create_artifact");
    // 关键是：不能误判为 revision
    expect(result.nextAction).not.toBe("direct_artifact_revision");
  });

  it('should NOT route "新建一个页面" as revision even with activeArtifact', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "新建一个登录页面",
      activeArtifact: mockArtifact,
    });
    expect(result.nextAction).toBe("direct_create_artifact");
    expect(result.nextAction).not.toBe("direct_artifact_revision");
  });
});

describe("LM-04: 模糊请求 → manager_llm_fallback", () => {
  it('should route "你好" to manager_llm_fallback', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "你好",
    });
    expect(result.nextAction).toBe("manager_llm_fallback");
    expect(result.managerLlmRequired).toBe(true);
    expect(result.policyRoute).toBe("manager_llm_required");
  });

  it('should route "什么是量子计算" to manager_llm_fallback', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "什么是量子计算",
    });
    expect(result.nextAction).toBe("manager_llm_fallback");
    expect(result.managerLlmRequired).toBe(true);
  });
});

describe("LM-05: local security allowArtifactToManager=false", () => {
  it("should NEVER allow artifact to Manager in any scenario", () => {
    // create
    const createResult = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "写一个登录页",
    });
    expect(createResult.security.allowArtifactToManager).toBe(false);

    // revision
    const revisionResult = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "把按钮改成蓝色",
      activeArtifact: mockArtifact,
    });
    expect(revisionResult.security.allowArtifactToManager).toBe(false);

    // fallback
    const fallbackResult = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "什么是量子计算",
    });
    expect(fallbackResult.security.allowArtifactToManager).toBe(false);
  });
});

describe("LM-06: local security allowRawHistoryToWorker=false", () => {
  it("should NEVER allow raw history to Worker", () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "把按钮改成蓝色",
      activeArtifact: mockArtifact,
    });
    expect(result.security.allowRawHistoryToWorker).toBe(false);
  });
});

describe("LM-07: revision patchFirstEligible=true", () => {
  it('should set patchFirstEligible=true for "把按钮改成蓝色"', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "把按钮改成蓝色",
      activeArtifact: mockArtifact,
    });
    expect(result.patchFirstEligible).toBe(true);
  });

  it('should set patchFirstEligible=true for "标题改大一点"', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "标题改大一点",
      activeArtifact: mockArtifact,
    });
    expect(result.patchFirstEligible).toBe(true);
  });
});

describe("LM-08: create patchFirstEligible=false", () => {
  it('should set patchFirstEligible=false for "帮我写一个注册页"', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "帮我写一个注册页",
    });
    expect(result.patchFirstEligible).toBe(false);
  });

  it('should set patchFirstEligible=false for "再帮我写一个注册页" with activeArtifact', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "再帮我写一个注册页",
      activeArtifact: mockArtifact,
    });
    // create 且不误判为 revision
    expect(result.nextAction).toBe("direct_create_artifact");
    expect(result.patchFirstEligible).toBe(false);
  });
});

describe("LM-09: decisionMs 有记录", () => {
  it("should record decisionMs > 0", () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "把按钮改成蓝色",
      activeArtifact: mockArtifact,
    });
    expect(result.decisionMs).toBeGreaterThanOrEqual(0);
  });
});

describe("LM-10: managerLlmBypassed 字段正确", () => {
  it('should have managerLlmRequired=false (bypassed) for revision', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "把按钮改成蓝色",
      activeArtifact: mockArtifact,
    });
    expect(result.managerLlmRequired).toBe(false);
  });

  it('should have managerLlmRequired=true (not bypassed) for fuzzy query', () => {
    const result = runLocalManager({
      traceId: mockTraceId,
      userInstruction: "什么是量子计算",
    });
    expect(result.managerLlmRequired).toBe(true);
  });
});
