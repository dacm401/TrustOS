/**
 * Sprint 56: Artifact Revision Routing — 单元测试
 */
import { describe, it, expect } from "vitest";
import { extractActiveArtifactContext } from "../../../src/services/context/active-artifact.js";
import {
  detectArtifactRevisionIntent,
  applyArtifactRevisionRoutingGuard,
} from "../../../src/services/context/artifact-revision-intent.js";
import type { ActiveArtifactContext } from "../../../src/services/context/active-artifact.js";
import type { ManagerViewMessage } from "../../../src/services/context/manager-view.js";

// ── 测试用 ActiveArtifactContext ────────────────────────────────────────
const SAMPLE_ACTIVE_ARTIFACT: ActiveArtifactContext = {
  taskId: "task_1",
  artifactId: "artifact_1",
  summaryForManager: "生成了 React 登录页，包含用户名输入框、密码输入框、表单校验、loading 状态、提交按钮和 Tailwind 样式。",
};

// =========================================================================
// extractActiveArtifactContext
// =========================================================================
describe("extractActiveArtifactContext", () => {
  it("从 rawHistory 中提取最近一条 worker/artifact 的 context", () => {
    const history = createHistory([
      createMessage("user", "帮我写登录页"),
      createMessage("assistant", "完整 TSX 代码", {
        origin: "worker", contentKind: "artifact",
        taskId: "task_1", artifactId: "artifact_1",
        summaryForManager: "生成了 React 登录页。",
      }),
    ]);

    const result = extractActiveArtifactContext(history);

    expect(result).toBeDefined();
    expect(result!.artifactId).toBe("artifact_1");
    expect(result!.summaryForManager).toBe("生成了 React 登录页。");
  });

  it("从 rawHistory 中提取最近一条 worker/brief 的 context", () => {
    const history = createHistory([
      createMessage("assistant", "简要摘要", {
        origin: "worker", contentKind: "brief",
        taskId: "task_2", artifactId: "artifact_2",
        summaryForManager: "生成了登录页。",
      }),
    ]);

    const result = extractActiveArtifactContext(history);

    expect(result).toBeDefined();
    expect(result!.taskId).toBe("task_2");
    expect(result!.summaryForManager).toBe("生成了登录页。");
  });

  it("空 history 返回 undefined", () => {
    expect(extractActiveArtifactContext([])).toBeUndefined();
  });

  it("没有 worker 消息时返回 undefined", () => {
    const history = createHistory([
      createMessage("user", "你好"),
      createMessage("assistant", "你好！", {
        origin: "manager", contentKind: "chat",
      }),
    ]);

    expect(extractActiveArtifactContext(history)).toBeUndefined();
  });
});

// =========================================================================
// detectArtifactRevisionIntent
// =========================================================================
describe("detectArtifactRevisionIntent", () => {
  describe("无 activeArtifact 时", () => {
    it("永远返回 false", () => {
      expect(detectArtifactRevisionIntent({
        latestUserMessage: "把按钮改成蓝色",
        activeArtifact: undefined,
      })).toBe(false);

      expect(detectArtifactRevisionIntent({
        latestUserMessage: "修改",
        activeArtifact: undefined,
      })).toBe(false);
    });
  });

  describe("中文修改意图", () => {
    const opts = { activeArtifact: SAMPLE_ACTIVE_ARTIFACT };

    it('识别"修改"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "修改一下这个页面", ...opts })).toBe(true);
    });

    it('识别"改成"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "把按钮改成蓝色", ...opts })).toBe(true);
    });

    it('识别"换成"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "换成红色", ...opts })).toBe(true);
    });

    it('识别"调整"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "调整一下布局", ...opts })).toBe(true);
    });

    it('识别"优化"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "优化一下性能", ...opts })).toBe(true);
    });

    it('识别"继续改"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "继续改一下颜色", ...opts })).toBe(true);
    });

    it('识别"基于上面"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "基于上面改一下样式", ...opts })).toBe(true);
    });
  });

  describe("英文修改意图", () => {
    const opts = { activeArtifact: SAMPLE_ACTIVE_ARTIFACT };

    it('识别"change"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "change the button to blue", ...opts })).toBe(true);
    });

    it('识别"modify"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "modify the form layout", ...opts })).toBe(true);
    });

    it('识别"update"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "update the template", ...opts })).toBe(true);
    });

    it('识别"fix"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "fix the validation", ...opts })).toBe(true);
    });

    it('识别"refactor"', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "refactor the component", ...opts })).toBe(true);
    });
  });

  describe("解释型问题不触发", () => {
    const opts = { activeArtifact: SAMPLE_ACTIVE_ARTIFACT };

    it('"解释一下" 不触发', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "解释一下这个页面的结构", ...opts })).toBe(false);
    });

    it('"包含什么" 不触发', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "这个页面包含什么", ...opts })).toBe(false);
    });

    it('"总结" 不触发', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "总结一下代码", ...opts })).toBe(false);
    });

    it('英文解释类不触发', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "explain the structure of this page", ...opts })).toBe(false);
    });
  });

  describe("英文解释类不触发", () => {
    const opts = { activeArtifact: SAMPLE_ACTIVE_ARTIFACT };

    it('"what is" 不触发', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "what is this component", ...opts })).toBe(false);
    });

    it('"describe" 不触发', () => {
      expect(detectArtifactRevisionIntent({ latestUserMessage: "describe the architecture", ...opts })).toBe(false);
    });
  });
});

// =========================================================================
// applyArtifactRevisionRoutingGuard
// =========================================================================
describe("applyArtifactRevisionRoutingGuard", () => {
  it("activeArtifact + 修改意图 → 强制 delegate_to_slow", () => {
    const result = applyArtifactRevisionRoutingGuard({
      originalAction: "direct_answer",
      latestUserMessage: "把按钮改成蓝色",
      activeArtifact: SAMPLE_ACTIVE_ARTIFACT,
    });

    expect(result.finalAction).toBe("delegate_to_slow");
    expect(result.artifactRevisionIntent).toBe(true);
    expect(result.overridden).toBe(true);
  });

  it("activeArtifact + 解释问题 → 不 override", () => {
    const result = applyArtifactRevisionRoutingGuard({
      originalAction: "direct_answer",
      latestUserMessage: "这个页面包含什么",
      activeArtifact: SAMPLE_ACTIVE_ARTIFACT,
    });

    expect(result.finalAction).toBe("direct_answer");
    expect(result.artifactRevisionIntent).toBe(false);
    expect(result.overridden).toBe(false);
  });

  it("无 activeArtifact → 不 override", () => {
    const result = applyArtifactRevisionRoutingGuard({
      originalAction: "direct_answer",
      latestUserMessage: "把按钮改成蓝色",
      activeArtifact: undefined,
    });

    expect(result.finalAction).toBe("direct_answer");
    expect(result.artifactRevisionIntent).toBe(false);
    expect(result.overridden).toBe(false);
  });

  it("原本就是 delegate_to_slow + 修改意图 → 不标记 overridden", () => {
    const result = applyArtifactRevisionRoutingGuard({
      originalAction: "delegate_to_slow",
      latestUserMessage: "把按钮改成蓝色",
      activeArtifact: SAMPLE_ACTIVE_ARTIFACT,
    });

    expect(result.finalAction).toBe("delegate_to_slow");
    expect(result.artifactRevisionIntent).toBe(true);
    expect(result.overridden).toBe(false); // 已经是正确的动作
  });
});

// =========================================================================
// Helpers
// =========================================================================

function createMessage(
  role: "user" | "assistant",
  content: string,
  meta?: ManagerViewMessage["meta"],
): ManagerViewMessage {
  return { role, content, ...(meta ? { meta } : {}) };
}

function createHistory(items: ManagerViewMessage[]): ManagerViewMessage[] {
  return items;
}
