/**
 * S100P Phase 2 — Routing & Visibility Unit Tests
 *
 * Tests the pure routing functions (no DB, no network):
 *   - Manager Router: 4 route types + edge cases
 *   - Visibility Router: full event-type → visibility matrix
 *
 * Run: npx vitest run --config vitest.s100p.config.ts
 */

import { describe, it, expect } from "vitest";
import { routeMessage } from "../../src/services/manager-routing/manager-router.js";
import { routeVisibility } from "../../src/services/visibility-routing/visibility-router.js";
import type { ActiveSessionSummary } from "../../src/services/manager-routing/manager-routing-types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseInput = {
  user_id: "test-user",
  conversation_id: "test-conv",
};

const noSessions: ActiveSessionSummary[] = [];

const singleSession: ActiveSessionSummary[] = [
  { id: "sess-1", title: "登录页面重构", goal: "Refactor login page", status: "planning" },
];

const multiSessions: ActiveSessionSummary[] = [
  { id: "sess-1", title: "登录页面重构", goal: "Refactor login page", status: "running" },
  { id: "sess-2", title: "数据库迁移", goal: "Migrate database", status: "planning" },
];

// ── Manager Router Tests ──────────────────────────────────────────────────────

describe("Manager Router", () => {

  describe("Rule 5: normal_conversation", () => {
    it("routes plain greeting to normal_conversation", () => {
      const result = routeMessage({
        ...baseInput,
        message: "你好，今天天气怎么样",
        target_session_id: null,
        active_sessions: noSessions,
      });
      expect(result.route_type).toBe("normal_conversation");
      expect(result.created_session).toBeNull();
      expect(result.session_event).toBeNull();
      expect(result.clarification_required).toBe(false);
      expect(result.manager_message_content).toBe("你好，今天天气怎么样");
    });

    it("routes plain question without keywords to normal_conversation", () => {
      const result = routeMessage({
        ...baseInput,
        message: "请介绍一下你的功能",
        target_session_id: null,
        active_sessions: singleSession,
      });
      expect(result.route_type).toBe("normal_conversation");
      expect(result.created_session).toBeNull();
    });

    it("reference keyword with no active sessions falls back to normal_conversation", () => {
      const result = routeMessage({
        ...baseInput,
        message: "那个任务怎么样了",
        target_session_id: null,
        active_sessions: noSessions,
      });
      expect(result.route_type).toBe("normal_conversation");
      expect(result.reason).toContain("no active sessions");
    });
  });

  describe("Rule 2: new_delegated_task", () => {
    it("detects delegation keyword 帮我 and creates new task", () => {
      const result = routeMessage({
        ...baseInput,
        message: "帮我修一下登录页的样式",
        target_session_id: null,
        active_sessions: noSessions,
      });
      expect(result.route_type).toBe("new_delegated_task");
      expect(result.created_session).not.toBeNull();
      expect(result.created_session!.status).toBe("planning");
      expect(result.created_session!.goal).toBe("帮我修一下登录页的样式");
      expect(result.session_event).not.toBeNull();
      expect(result.session_event!.type).toBe("session.created");
      expect(result.clarification_required).toBe(false);
    });

    it("detects delegation keyword 执行 and creates new task", () => {
      const result = routeMessage({
        ...baseInput,
        message: "执行数据库备份",
        target_session_id: null,
        active_sessions: noSessions,
      });
      expect(result.route_type).toBe("new_delegated_task");
      expect(result.created_session!.title).toBe("执行数据库备份");
    });

    it("assesses medium risk for destructive keywords", () => {
      const result = routeMessage({
        ...baseInput,
        message: "帮我删除生产环境的旧数据",
        target_session_id: null,
        active_sessions: noSessions,
      });
      expect(result.route_type).toBe("new_delegated_task");
      expect(result.created_session!.risk_level).toBe("medium");
    });

    it("assesses low risk for non-destructive keywords", () => {
      const result = routeMessage({
        ...baseInput,
        message: "帮我整理一下文档",
        target_session_id: null,
        active_sessions: noSessions,
      });
      expect(result.route_type).toBe("new_delegated_task");
      expect(result.created_session!.risk_level).toBe("low");
    });

    it("generates title from first clause", () => {
      const result = routeMessage({
        ...baseInput,
        message: "帮我生成报告，然后发邮件，最后归档",
        target_session_id: null,
        active_sessions: noSessions,
      });
      expect(result.route_type).toBe("new_delegated_task");
      expect(result.created_session!.title).toBe("帮我生成报告");
    });

    it("delegation keyword takes priority over reference keyword", () => {
      const result = routeMessage({
        ...baseInput,
        message: "帮我做那个任务",
        target_session_id: null,
        active_sessions: singleSession,
      });
      expect(result.route_type).toBe("new_delegated_task");
    });
  });

  describe("Rule 1: update_existing_session (explicit target)", () => {
    it("routes to update when target_session_id matches active session", () => {
      const result = routeMessage({
        ...baseInput,
        message: "把按钮颜色改成蓝色",
        target_session_id: "sess-1",
        active_sessions: singleSession,
      });
      expect(result.route_type).toBe("update_existing_session");
      expect(result.target_session_id).toBe("sess-1");
      expect(result.created_session).toBeNull();
      expect(result.session_event).not.toBeNull();
      expect(result.session_event!.type).toBe("session.updated");
      expect(result.clarification_required).toBe(false);
      expect(result.reason).toContain("Explicit target_session_id");
    });

    it("falls through when target_session_id not in active sessions", () => {
      const result = routeMessage({
        ...baseInput,
        message: "你好呀",
        target_session_id: "nonexistent-session",
        active_sessions: singleSession,
      });
      // Should fall through to normal_conversation (no delegation/reference keywords)
      expect(result.route_type).toBe("normal_conversation");
    });
  });

  describe("Rule 3: update_existing_session (reference match)", () => {
    it("matches unique session by title keyword", () => {
      const result = routeMessage({
        ...baseInput,
        message: "登录页面那个任务，再加个验证码",
        target_session_id: null,
        active_sessions: singleSession,
      });
      expect(result.route_type).toBe("update_existing_session");
      expect(result.target_session_id).toBe("sess-1");
      expect(result.session_event!.type).toBe("session.updated");
      expect(result.reason).toContain("Reference matched");
    });
  });

  describe("Rule 4: ambiguous_session_reference", () => {
    it("returns ambiguous when reference keyword but multiple sessions, no unique match", () => {
      const result = routeMessage({
        ...baseInput,
        message: "那个任务怎么样了",
        target_session_id: null,
        active_sessions: multiSessions,
      });
      expect(result.route_type).toBe("ambiguous_session_reference");
      expect(result.clarification_required).toBe(true);
      expect(result.created_session).toBeNull();
      expect(result.session_event).toBeNull();
      expect(result.manager_message_content).toContain("「登录页面重构」");
      expect(result.manager_message_content).toContain("「数据库迁移」");
    });

    it("does not return ambiguous with single active session + reference (no match)", () => {
      // Single session, reference keyword, but no title match → not ambiguous (only 1 session)
      const result = routeMessage({
        ...baseInput,
        message: "那个任务怎么样了",
        target_session_id: null,
        active_sessions: singleSession,
      });
      // With 1 session, no match → falls through to normal_conversation
      // (the ambiguous check requires active_sessions.length > 1)
      expect(result.route_type).not.toBe("ambiguous_session_reference");
    });
  });
});

// ── Visibility Router Tests ───────────────────────────────────────────────────

describe("Visibility Router", () => {

  describe("Direct event-type mappings", () => {
    const cases: Array<[string, string]> = [
      ["session.created", "session_timeline"],
      ["session.updated", "session_timeline"],
      ["session.started", "session_timeline"],
      ["session.paused", "session_timeline"],
      ["session.resumed", "session_timeline"],
      ["session.cancelled", "session_timeline"],
      ["session.completed", "manager_chat_summary"],
      ["session.failed", "critical_alert"],

      ["contract.generated", "session_timeline"],
      ["artifact.updated", "session_timeline"],

      ["worker.assigned", "session_timeline"],
      ["worker.started", "session_timeline"],
      ["worker.progress", "session_timeline"],
      ["worker.completed", "manager_chat_summary"],
      ["worker.failed", "critical_alert"],
      ["worker.paused", "session_timeline"],
      ["worker.resumed", "session_timeline"],

      ["approval.requested", "approval_required"],
      ["approval.granted", "manager_chat_summary"],
      ["approval.denied", "manager_chat_summary"],
      ["approval.expired", "session_timeline"],

      ["plan.created", "session_timeline"],
      ["plan.updated", "session_timeline"],
      ["plan.executed", "session_timeline"],
      ["plan.failed", "critical_alert"],

      ["decision.made", "session_timeline"],
      ["decision.reviewed", "session_timeline"],
      ["decision.reversed", "session_timeline"],

      ["risk.assessed", "trust_report_only"],
      ["risk.mitigated", "trust_report_only"],
    ];

    for (const [eventType, expectedVisibility] of cases) {
      it(`maps ${eventType} → ${expectedVisibility}`, () => {
        const result = routeVisibility({
          event_type: eventType,
          severity: "info",
        });
        expect(result.visibility).toBe(expectedVisibility);
        expect(result.reason).toBeTruthy();
      });
    }
  });

  describe("action.requested special handling", () => {
    it("routes low-risk action.requested to silent_audit", () => {
      const result = routeVisibility({
        event_type: "action.requested",
        severity: "info",
        risk_level: "low",
      });
      expect(result.visibility).toBe("silent_audit");
      expect(result.reason).toContain("Low-risk");
    });

    it("routes medium-risk action.requested to session_timeline", () => {
      const result = routeVisibility({
        event_type: "action.requested",
        severity: "info",
        risk_level: "medium",
      });
      expect(result.visibility).toBe("session_timeline");
    });

    it("routes high-risk action.requested to session_timeline", () => {
      const result = routeVisibility({
        event_type: "action.requested",
        severity: "warn",
        risk_level: "high",
      });
      expect(result.visibility).toBe("session_timeline");
    });

    it("routes action.requested with no risk_level to session_timeline", () => {
      const result = routeVisibility({
        event_type: "action.requested",
        severity: "info",
        risk_level: null,
      });
      expect(result.visibility).toBe("session_timeline");
    });
  });

  describe("decision.made deny of secret-like action", () => {
    it("routes deny of password action to session_timeline (audit)", () => {
      const result = routeVisibility({
        event_type: "decision.made",
        severity: "info",
        decision: "deny",
        action_type: "read_password",
      });
      expect(result.visibility).toBe("session_timeline");
      expect(result.reason).toContain("secret");
    });

    it("routes deny of api_key action to session_timeline (audit)", () => {
      const result = routeVisibility({
        event_type: "decision.made",
        severity: "info",
        decision: "deny",
        action_type: "access_api_key",
      });
      expect(result.visibility).toBe("session_timeline");
    });

    it("routes deny of credential action to session_timeline (audit)", () => {
      const result = routeVisibility({
        event_type: "decision.made",
        severity: "info",
        decision: "deny",
        action_type: "read_credential",
      });
      expect(result.visibility).toBe("session_timeline");
    });

    it("does NOT special-case deny of non-secret action (uses direct map)", () => {
      const result = routeVisibility({
        event_type: "decision.made",
        severity: "info",
        decision: "deny",
        action_type: "delete_file",
      });
      // decision.made direct map → session_timeline anyway
      expect(result.visibility).toBe("session_timeline");
      expect(result.reason).toContain("Direct mapping");
    });
  });

  describe("Fallback for unknown event types", () => {
    it("routes unknown critical event to critical_alert", () => {
      const result = routeVisibility({
        event_type: "unknown.catastrophe",
        severity: "critical",
      });
      expect(result.visibility).toBe("critical_alert");
    });

    it("routes unknown error event to session_timeline", () => {
      const result = routeVisibility({
        event_type: "unknown.error",
        severity: "error",
      });
      expect(result.visibility).toBe("session_timeline");
    });

    it("routes unknown info event to session_timeline (default)", () => {
      const result = routeVisibility({
        event_type: "unknown.info",
        severity: "info",
      });
      expect(result.visibility).toBe("session_timeline");
    });

    it("routes unknown warn event to session_timeline (default)", () => {
      const result = routeVisibility({
        event_type: "unknown.warn",
        severity: "warn",
      });
      expect(result.visibility).toBe("session_timeline");
    });
  });
});
