import { describe, it, expect } from "vitest";
import { buildContextPackage, contextPackageToLedgerExtract } from "../../src/services/context/context-package-builder.js";
import type { BuildContextPackageInput } from "../../src/services/context/context-package-builder.js";

const makeInput = (overrides: Partial<BuildContextPackageInput> = {}): BuildContextPackageInput => ({
  traceId: "test-trace-001",
  policyRoute: "direct_create_artifact",
  userInstruction: "帮我写一个注册页",
  taskKind: "create",
  ...overrides,
});

describe("context-package-builder", () => {
  describe("CP-01: create package 不包含 artifactContent", () => {
    it("create package 的 targetArtifact 为 undefined", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_create_artifact",
        taskKind: "create",
      }));
      expect(cp.kind).toBe("artifact_create");
      expect(cp.targetArtifact).toBeUndefined();
      expect(cp.securityScope.sendArtifactToWorker).toBe(false);
    });
  });

  describe("CP-02: create package 即使 activeArtifact 存在，也不发送 artifact", () => {
    it("create 任务忽略 activeArtifact", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_create_artifact",
        taskKind: "create",
        activeArtifact: {
          artifactId: "art-001",
          taskId: "task-001",
          summaryForManager: "已生成登录页",
        },
      }));
      expect(cp.kind).toBe("artifact_create");
      expect(cp.targetArtifact).toBeUndefined();
      expect(cp.securityScope.sendArtifactToWorker).toBe(false);
    });
  });

  describe("CP-03: revision package 包含 targetArtifact", () => {
    it("revision 包有 targetArtifact", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_artifact_revision",
        taskKind: "revision",
        activeArtifact: {
          artifactId: "art-001",
          taskId: "task-001",
          summaryForManager: "已生成登录页，包含用户名和密码输入框",
          revisionOfArtifactId: "art-000",
          revisionOfTaskId: "task-000",
        },
        artifactContentBytes: 120,
        artifactContentMode: "full",
      }));
      expect(cp.kind).toBe("artifact_revision");
      expect(cp.targetArtifact).toBeDefined();
      expect(cp.targetArtifact!.artifactId).toBe("art-001");
      expect(cp.targetArtifact!.source).toBe("archive");
      expect(cp.targetArtifact!.contentMode).toBe("full");
      expect(cp.targetArtifact!.contentBytes).toBe(120);
      expect(cp.targetArtifact!.summaryForManager).toBe("已生成登录页，包含用户名和密码输入框");
    });
  });

  describe("CP-04: revision package sendArtifactToWorker=true", () => {
    it("有 artifact contentBytes 时 sendArtifactToWorker=true", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_artifact_revision",
        taskKind: "revision",
        activeArtifact: { artifactId: "art-001", summaryForManager: "登录页" },
        artifactContentBytes: 500,
        artifactContentMode: "full",
      }));
      expect(cp.securityScope.sendArtifactToWorker).toBe(true);
    });
  });

  describe("CP-05: revision package sendArtifactToManager=false", () => {
    it("artifact 绝不发给 Manager", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_artifact_revision",
        taskKind: "revision",
        activeArtifact: { artifactId: "art-001", summaryForManager: "登录页" },
        artifactContentBytes: 500,
      }));
      expect(cp.securityScope.sendArtifactToManager).toBe(false);
    });
  });

  describe("CP-06: revision package deniedContext.rawHistory=true", () => {
    it("rawHistory 永远被拒绝", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_artifact_revision",
        taskKind: "revision",
        activeArtifact: { artifactId: "art-001", summaryForManager: "登录页" },
      }));
      expect(cp.deniedContext.rawHistory).toBe(true);
      expect(cp.deniedContext.rawMemory).toBe(true);
      expect(cp.deniedContext.managerInternalReasoning).toBe(true);
    });
  });

  describe("CP-07: manager_delegation package 不包含 rawMemory/rawHistory", () => {
    it("delegation 包拒绝 rawHistory 和 rawMemory", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "manager_llm_required",
        taskKind: "manager_delegation",
        userInstruction: "请帮我分析量子计算的发展现状",
      }));
      expect(cp.kind).toBe("manager_delegation");
      expect(cp.securityScope.sendRawHistoryToWorker).toBe(false);
      expect(cp.securityScope.sendMemoryToWorker).toBe(false);
      expect(cp.deniedContext.rawHistory).toBe(true);
      expect(cp.deniedContext.rawMemory).toBe(true);
    });
  });

  describe("CP-08: metrics.artifactContentBytes 正确", () => {
    it("revision 包反映正确的 artifact 大小", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_artifact_revision",
        taskKind: "revision",
        activeArtifact: { artifactId: "art-001", summaryForManager: "登录页" },
        artifactContentBytes: 1024,
        artifactContentMode: "full",
      }));
      expect(cp.metrics.artifactContentBytes).toBe(1024);
      expect(cp.metrics.inputBytes).toBeGreaterThan(0);
      expect(cp.metrics.estimatedInputTokens).toBeGreaterThan(0);
    });

    it("create 包 contentBytes 为 0", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_create_artifact",
        taskKind: "create",
      }));
      expect(cp.metrics.artifactContentBytes).toBe(0);
    });
  });

  describe("contextPackageToLedgerExtract", () => {
    it("正确提取 ledger 摘要字段", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_artifact_revision",
        taskKind: "revision",
        activeArtifact: { artifactId: "art-001", summaryForManager: "登录页" },
        artifactContentBytes: 200,
        artifactContentMode: "full",
      }));
      const extract = contextPackageToLedgerExtract(cp);
      expect(extract.kind).toBe("artifact_revision");
      expect(extract.policyRoute).toBe("direct_artifact_revision");
      expect(extract.artifactContentBytes).toBe(200);
      expect(extract.contentMode).toBe("full");
      expect(extract.sendArtifactToManager).toBe(false);
    });
  });

  describe("kind 解析边界", () => {
    it("direct_artifact_revision → kind=artifact_revision", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_artifact_revision",
        taskKind: "revision",
        activeArtifact: { artifactId: "art-001", summaryForManager: "s" },
      }));
      expect(cp.kind).toBe("artifact_revision");
    });

    it("direct_create_artifact → kind=artifact_create", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "direct_create_artifact",
        taskKind: "create",
      }));
      expect(cp.kind).toBe("artifact_create");
    });

    it("manager_llm_required → kind=manager_delegation", () => {
      const cp = buildContextPackage(makeInput({
        policyRoute: "manager_llm_required",
        taskKind: "manager_delegation",
      }));
      expect(cp.kind).toBe("manager_delegation");
    });
  });
});
