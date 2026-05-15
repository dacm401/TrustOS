import { describe, it, expect } from "vitest";
import {
  buildWorkerContextPackage,
  toContextPackageRevisionSource,
  WORKER_CONTEXT_BOUNDARY,
} from "../../src/services/context/context-package.js";
import type { CommandPayload } from "../../src/types/delegation.js";

const makeCommand = (overrides: Partial<CommandPayload> = {}): CommandPayload => ({
  command_type: "delegate_analysis",
  task_type: "analysis",
  task_brief: "分析量子计算的发展现状",
  goal: "请深入分析量子计算的技术突破、商业化进程和投资机会",
  constraints: ["客观分析", "引用最新数据"],
  input_materials: [],
  required_output: { format: "structured_analysis" },
  worker_hint: "slow_analyst",
  priority: "normal",
  ...overrides,
});

describe("context-package", () => {
  describe("WORKER_CONTEXT_BOUNDARY", () => {
    it("mustInclude 包含 command 和 message", () => {
      expect(WORKER_CONTEXT_BOUNDARY.mustInclude).toContain("command");
      expect(WORKER_CONTEXT_BOUNDARY.mustInclude).toContain("message");
    });

    it("forbidden 包含 rawHistory 和 userApiKey", () => {
      expect(WORKER_CONTEXT_BOUNDARY.forbidden).toContain("rawHistory");
      expect(WORKER_CONTEXT_BOUNDARY.forbidden).toContain("userApiKey");
    });
  });

  describe("buildWorkerContextPackage", () => {
    describe("full_delegation 模式", () => {
      it("生成完整的 context package", () => {
        const cmd = makeCommand();
        const result = buildWorkerContextPackage({
          command: cmd,
          message: "请分析量子计算",
          language: "zh",
          mode: "full_delegation",
        });

        expect(result.schema_version).toBe("context_package_v0");
        expect(result.mode).toBe("full_delegation");
        expect(result.command).toBe(cmd);
        expect(result.userMessage).toBe("请分析量子计算");
        expect(result.language).toBe("zh");
        expect(result.isRevisionTask).toBe(false);
        expect(result.hasArchivedArtifact).toBe(false);
        expect(result.archivedArtifact).toBeUndefined();
      });

      it("full_delegation + activeArtifact 时标记为 revision 任务", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "请修改一下",
          language: "zh",
          mode: "full_delegation",
          activeArtifactContext: {
            taskId: "task-001",
            artifactId: "art-001",
            summaryForManager: "已生成量子计算分析报告",
          },
        });

        expect(result.isRevisionTask).toBe(true);
        expect(result.revisionLineage?.artifactId).toBe("art-001");
      });
    });

    describe("bypass_revision 模式", () => {
      it("自动注入 revision userMessage 前缀", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "把标题改一下",
          language: "zh",
          mode: "bypass_revision",
          activeArtifactContext: {
            artifactId: "art-001",
            taskId: "task-001",
            summaryForManager: "已生成量子计算分析报告",
          },
        });

        expect(result.userMessage).toContain("[Artifact Revision Task]");
        expect(result.userMessage).toContain("art-001");
        expect(result.userMessage).toContain("已生成量子计算分析报告");
        expect(result.userMessage).toContain("把标题改一下");
        expect(result.isRevisionTask).toBe(true);
        expect(result.hasArchivedArtifact).toBe(false); // V0: archivedArtifact 未传入
      });

      it("英文模式下使用英文前缀", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "change the title",
          language: "en",
          mode: "bypass_revision",
          activeArtifactContext: {
            artifactId: "art-001",
            taskId: "task-001",
            summaryForManager: "Quantum computing analysis report",
          },
        });

        expect(result.userMessage).toContain("[Artifact Revision Task]");
        expect(result.userMessage).toContain("change the title");
      });
    });

    describe("bypass_create 模式", () => {
      it("直接透传 userMessage，不加前缀", () => {
        const msg = "创建一个番茄钟网页";
        const result = buildWorkerContextPackage({
          command: makeCommand({ task_type: "creative" }),
          message: msg,
          language: "zh",
          mode: "bypass_create",
        });

        expect(result.userMessage).toBe(msg);
        expect(result.isRevisionTask).toBe(false);
        expect(result.hasArchivedArtifact).toBe(false);
      });
    });

    describe("archived artifact", () => {
      it("传入 archive source 时 hasArchivedArtifact=true", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "修改代码",
          language: "zh",
          mode: "bypass_revision",
          activeArtifactContext: {
            artifactId: "art-001",
            taskId: "task-001",
            summaryForManager: "React 组件",
          },
          archivedArtifactSource: {
            type: "archive",
            content: "<div>原始 HTML</div>",
            contentType: "html",
            summaryForManager: "React 组件",
          },
        });

        expect(result.hasArchivedArtifact).toBe(true);
        expect(result.archivedArtifact?.content).toBe("<div>原始 HTML</div>");
        expect(result.archivedArtifact?.contentType).toBe("html");
        expect(result.boundary.artifactContentFetchedFrom).toBe("archive");
      });

      it("传入 unavailable source 时 hasArchivedArtifact=false", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "修改",
          language: "zh",
          mode: "bypass_revision",
          archivedArtifactSource: { type: "unavailable" },
        });

        expect(result.hasArchivedArtifact).toBe(false);
        expect(result.archivedArtifact).toBeUndefined();
      });

      it("不传 archivedArtifactSource 时 hasArchivedArtifact=false", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "分析",
          language: "zh",
          mode: "full_delegation",
        });

        expect(result.hasArchivedArtifact).toBe(false);
        expect(result.archivedArtifact).toBeUndefined();
      });
    });

    describe("metrics", () => {
      it("正确计算各字段长度", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand({
            goal: "分析量子计算的长目标".repeat(10),
            task_brief: "量子计算简报",
            constraints: ["约束1", "约束2", "约束3"],
          }),
          message: "请分析",
          language: "zh",
          mode: "full_delegation",
          confirmedFacts: ["事实1", "事实2"],
          evidenceContent: ["证据1"],
          memorySummary: "记忆摘要内容",
          archivedArtifactSource: {
            type: "archive",
            content: "archived artifact content here",
            contentType: "tsx",
            summaryForManager: "摘要",
          },
        });

        expect(result.metrics.commandGoalLen).toBe("分析量子计算的长目标".repeat(10).length);
        expect(result.metrics.commandBriefLen).toBe("量子计算简报".length);
        expect(result.metrics.commandConstraintsCount).toBe(3);
        expect(result.metrics.archivedArtifactChars).toBe("archived artifact content here".length);
        expect(result.metrics.confirmedFactsCount).toBe(2);
        expect(result.metrics.evidenceContentCount).toBe(1);
        expect(result.metrics.memorySummaryLen).toBe("记忆摘要内容".length);
        expect(result.metrics.totalContextChars).toBeGreaterThan(0);
      });
    });

    describe("boundary 不变量", () => {
      it("V0 boundary 强制 false", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "分析",
          language: "zh",
          mode: "full_delegation",
        });

        expect(result.boundary.rawHistoryIncluded).toBe(false);
        expect(result.boundary.managerMemoryIncluded).toBe(false);
        expect(result.boundary.userApiKeyIncluded).toBe(false);
        expect(result.boundary.artifactContentFetchedFrom).toBe("none");
      });
    });

    describe("revisionLineage", () => {
      it("activeArtifact 有 lineage 信息时填充", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand(),
          message: "revision v2",
          language: "zh",
          mode: "bypass_revision",
          activeArtifactContext: {
            artifactId: "art-v2",
            taskId: "task-v2",
            summaryForManager: "v2 summary",
            revisionOfArtifactId: "art-v1",
            revisionOfTaskId: "task-v1",
          },
        });

        expect(result.revisionLineage?.artifactId).toBe("art-v2");
        expect(result.revisionLineage?.parentArtifactId).toBe("art-v1");
        expect(result.revisionLineage?.parentTaskId).toBe("task-v1");
      });
    });

    describe("taskTypeLabel", () => {
      it("根据 command.task_type 返回中文标签", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand({ task_type: "code" }),
          message: "写代码",
          language: "zh",
          mode: "full_delegation",
        });
        expect(result.taskTypeLabel).toBe("代码任务");
      });

      it("未知 task_type 返回通用标签", () => {
        const result = buildWorkerContextPackage({
          command: makeCommand({ task_type: "unknown_type" }),
          message: "做什么",
          language: "zh",
          mode: "full_delegation",
        });
        expect(result.taskTypeLabel).toBe("通用任务");
      });
    });
  });

  describe("toContextPackageRevisionSource", () => {
    it("undefined → none", () => {
      const result = toContextPackageRevisionSource(undefined);
      expect(result.type).toBe("none");
    });

    it("archive source with content → archive", () => {
      const result = toContextPackageRevisionSource({
        source: "archive",
        content: "<div>test</div>",
        contentType: "html",
        summaryForManager: "HTML 组件",
        artifactId: "art-001",
        taskId: "task-001",
      });
      expect(result.type).toBe("archive");
      expect((result as any).content).toBe("<div>test</div>");
      expect((result as any).contentType).toBe("html");
    });

    it("archive source without content → none", () => {
      const result = toContextPackageRevisionSource({
        source: "archive",
        content: "",
        summaryForManager: "",
      });
      expect(result.type).toBe("none");
    });

    it("unavailable → unavailable", () => {
      const result = toContextPackageRevisionSource({
        source: "unavailable",
        content: "",
      });
      expect(result.type).toBe("unavailable");
    });

    it("无 content 的 archive → none（不是 unavailable）", () => {
      // 边界情况：source=archive 但 content 为空
      const result = toContextPackageRevisionSource({
        source: "archive",
        content: "",
        summaryForManager: "有摘要但无内容",
      });
      expect(result.type).toBe("none");
    });
  });
});
