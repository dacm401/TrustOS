// Sprint 67 — D3: Authorization E2E Integration Tests
/**
 * D3: Authorization E2E — Sprint 67
 *
 * 覆盖端到端路径：
 *   1. PermissionRequestRepo — create / approve / deny / getPending / getByTask
 *   2. classifyField — BLOCKED / IMPORTANT / NECESSARY 三级分类
 *   3. filterContextForWorker — 分类后分流：allowed / blocked / pendingApproval
 *   4. resolvePermission — 批准/拒绝 + scoped token 颁发
 *   5. handlePermissionResponseMessage — 自然语言权限响应解析
 *   6. buildWorkerContextPrompt — Worker prompt 构建
 *   7. buildPermissionRequestPrompt — 主人确认提示构建
 *   8. ScopedTokenRepo — create / validate
 *
 * Infrastructure: vitest.api.config.ts (独立进程)
 */

import { v4 as uuid } from "uuid";
import { randomUUID } from "crypto";
import {
  classifyField,
  DataPermissionLevel,
  filterContextForWorker,
  resolvePermission,
  handlePermissionResponseMessage,
  buildWorkerContextPrompt,
  buildPermissionRequestPrompt,
} from "../../src/services/permission-manager.js";
import {
  PermissionRequestRepo,
  ScopedTokenRepo,
  type PermissionRequestRecord,
} from "../../src/db/repositories.js";
import { truncateTables } from "../db/harness.js";

const TEST_USER = "d3-test-user";
const TEST_WORKER = "d3-test-worker";
const TEST_SESSION = "d3-session-1";

beforeEach(async () => {
  await truncateTables();
});

// ── classifyField ────────────────────────────────────────────────────────────

describe("classifyField — Three-Level Classification", () => {
  const check = (key: string, value: unknown = "test") =>
    classifyField(key, value);

  // BLOCKED
  it("classifies password-related keys as BLOCKED", () => {
    const keys = ["password", "passwd", "pwd", "secret", "api_key", "apiKey",
                  "token", "credential", "private_key", "PRIVATE-KEY"];
    for (const k of keys) {
      expect(check(k).level).toBe(DataPermissionLevel.BLOCKED);
    }
  });

  it("classifies ID-card/passport/ssn as BLOCKED", () => {
    const keys = ["id_card", "idCard", "passport", "ssn", "social_sec"];
    for (const k of keys) {
      expect(check(k).level).toBe(DataPermissionLevel.BLOCKED);
    }
  });

  it("classifies bank/credit card keys as BLOCKED", () => {
    const keys = ["bank_account", "credit_card", "card_number", "cvv"];
    for (const k of keys) {
      expect(check(k).level).toBe(DataPermissionLevel.BLOCKED);
    }
  });

  // IMPORTANT
  it("classifies contact fields as IMPORTANT", () => {
    const keys = ["phone", "mobile", "tel", "email", "address", "addr",
                  "name", "fullname", "birthday"];
    for (const k of keys) {
      expect(check(k).level).toBe(DataPermissionLevel.IMPORTANT);
    }
  });

  it("IMPORTANT fields include maskedPreview for value", () => {
    const result = check("email", "user@example.com");
    expect(result.level).toBe(DataPermissionLevel.IMPORTANT);
    expect(result.maskedPreview).toBeDefined();
    expect(result.maskedPreview).not.toBe("user@example.com"); // must be masked
  });

  it("short IMPORTANT values mask to '****'", () => {
    const result = check("tel", "123");
    expect(result.maskedPreview).toBe("****");
  });

  // NECESSARY (default)
  it("classifies task-related fields as NECESSARY", () => {
    const keys = ["task_goal", "query", "date_range", "report_type", "language"];
    for (const k of keys) {
      expect(check(k).level).toBe(DataPermissionLevel.NECESSARY);
    }
  });

  it("normalizes key to lowercase for matching", () => {
    const result = check("PhoneNumber", "12345");
    expect(result.level).toBe(DataPermissionLevel.IMPORTANT);
  });
});

// ── PermissionRequestRepo ─────────────────────────────────────────────────────

describe("PermissionRequestRepo — CRUD", () => {
  const makeInput = (overrides: Partial<{
    id: string; task_id: string; field_name: string; field_key: string;
    purpose: string; value_preview: string; status: string;
  }> = {}) => ({
    id: overrides.id ?? randomUUID(),
    task_id: overrides.task_id ?? `d3-task-${uuid()}`,
    worker_id: TEST_WORKER,
    user_id: TEST_USER,
    session_id: TEST_SESSION,
    field_name: overrides.field_name ?? "email",
    field_key: overrides.field_key ?? "user_email",
    purpose: overrides.purpose ?? "发送通知邮件",
    value_preview: overrides.value_preview ?? "us***@example.com",
    status: overrides.status ?? "pending",
  });

  it("create and getById round-trip", async () => {
    const input = makeInput();
    const created = await PermissionRequestRepo.create(input);
    expect(created.id).toBe(input.id);
    expect(created.field_name).toBe("email");
    expect(created.status).toBe("pending");

    const fetched = await PermissionRequestRepo.getById(input.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.field_key).toBe("user_email");
  });

  it("getById returns null for nonexistent", async () => {
    const result = await PermissionRequestRepo.getById("nonexistent");
    expect(result).toBeNull();
  });

  it("approve updates status and sets resolved_by / approved_scope", async () => {
    const { id } = await PermissionRequestRepo.create(makeInput());
    await PermissionRequestRepo.approve(id, TEST_USER, "email:read");

    const record = await PermissionRequestRepo.getById(id);
    expect(record!.status).toBe("approved");
    expect(record!.resolved_by).toBe(TEST_USER);
    expect(record!.approved_scope).toBe("email:read");
  });

  it("deny updates status to denied", async () => {
    const { id } = await PermissionRequestRepo.create(makeInput());
    await PermissionRequestRepo.deny(id, TEST_USER);

    const record = await PermissionRequestRepo.getById(id);
    expect(record!.status).toBe("denied");
    expect(record!.resolved_by).toBe(TEST_USER);
  });

  it("getPending returns only pending requests within 5 minutes", async () => {
    const { id: id1 } = await PermissionRequestRepo.create(makeInput());
    await PermissionRequestRepo.create({ ...makeInput({ id: randomUUID() }), status: "approved" });

    const pending = await PermissionRequestRepo.getPending(TEST_USER);
    expect(pending.some((r) => r.id === id1)).toBe(true);
    expect(pending.every((r) => r.status === "pending")).toBe(true);
  });

  it("getByTask returns all requests for a task", async () => {
    const taskId = `d3-task-${uuid()}`;
    await PermissionRequestRepo.create(makeInput({ task_id: taskId }));
    await PermissionRequestRepo.create(makeInput({ task_id: taskId, field_key: "phone" }));

    const records = await PermissionRequestRepo.getByTask(taskId);
    expect(records.length).toBe(2);
  });
});

// ── filterContextForWorker ───────────────────────────────────────────────────

describe("filterContextForWorker — Context Filtering E2E", () => {
  const USER_CONTEXT = {
    query: "查询我的账户余额",
    target_account: "user@example.com",
    password: "supersecret123",
    user_email: "john@example.com",
    phone_number: "13812345678",
    report_language: "zh-CN",
  };

  it("BLOCKED fields are excluded and recorded in blocked list", async () => {
    const result = await filterContextForWorker({
      userContext: USER_CONTEXT,
      taskId: "task-1",
      workerId: TEST_WORKER,
      userId: TEST_USER,
      sessionId: TEST_SESSION,
      taskPurpose: "查询余额",
    });

    expect(result.blocked).toContain("password");
    expect(result.allowed).not.toHaveProperty("password");
  });

  it("NECESSARY fields are auto-allowed", async () => {
    const result = await filterContextForWorker({
      userContext: USER_CONTEXT,
      taskId: "task-1",
      workerId: TEST_WORKER,
      userId: TEST_USER,
      sessionId: TEST_SESSION,
      taskPurpose: "查询余额",
    });

    expect(result.allowed).toHaveProperty("query");
    expect(result.allowed).toHaveProperty("report_language");
    expect(result.allowed["query"]).toBe("查询我的账户余额");
  });

  it("IMPORTANT fields trigger permission request and are NOT auto-allowed", async () => {
    const result = await filterContextForWorker({
      userContext: USER_CONTEXT,
      taskId: "task-1",
      workerId: TEST_WORKER,
      userId: TEST_USER,
      sessionId: TEST_SESSION,
      taskPurpose: "发送通知",
    });

    expect(result.pendingApproval.length).toBeGreaterThan(0);
    const emailReq = result.pendingApproval.find((p) => p.key === "user_email");
    expect(emailReq).toBeDefined();
    expect(emailReq!.requestId).toBeDefined();

    // IMPORTANT fields should NOT be in allowed
    expect(result.allowed).not.toHaveProperty("user_email");
    expect(result.allowed).not.toHaveProperty("phone_number");
  });

  it("writes PermissionRequest records for IMPORTANT fields", async () => {
    await filterContextForWorker({
      userContext: { email: "test@test.com" },
      taskId: "task-2",
      workerId: TEST_WORKER,
      userId: TEST_USER,
      sessionId: TEST_SESSION,
      taskPurpose: "发送报告",
    });

    const pending = await PermissionRequestRepo.getPending(TEST_USER);
    const emailReq = pending.find((r) => r.field_key === "email");
    expect(emailReq).toBeDefined();
    expect(emailReq!.purpose).toBe("发送报告");
    expect(emailReq!.status).toBe("pending");
  });
});

// ── resolvePermission ────────────────────────────────────────────────────────

describe("resolvePermission — Approval Flow", () => {
  it("approve issues scoped token", async () => {
    const reqId = randomUUID();
    const taskId = `d3-task-${uuid()}`;
    await PermissionRequestRepo.create({
      id: reqId,
      task_id: taskId,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      session_id: TEST_SESSION,
      field_name: "email",
      field_key: "user_email",
      purpose: "发送通知",
      expires_in: 300,
    });

    const result = await resolvePermission({
      requestId: reqId,
      approved: true,
      resolvedBy: TEST_USER,
      approvedScope: "user_email",
    });

    expect(result.scopedToken).toBeDefined();
    expect(result.scopedToken!.length).toBeGreaterThan(10);

    // Token is stored in DB
    const pending = await PermissionRequestRepo.getPending(TEST_USER);
    expect(pending.find((r) => r.id === reqId)).toBeUndefined(); // no longer pending
  });

  it("deny does not issue token", async () => {
    const reqId = randomUUID();
    await PermissionRequestRepo.create({
      id: reqId,
      task_id: `d3-task-${uuid()}`,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      session_id: TEST_SESSION,
      field_name: "email",
      field_key: "user_email",
      purpose: "发送通知",
    });

    const result = await resolvePermission({
      requestId: reqId,
      approved: false,
      resolvedBy: TEST_USER,
    });

    expect(result.scopedToken).toBeUndefined();
  });
});

// ── handlePermissionResponseMessage ─────────────────────────────────────────

describe("handlePermissionResponseMessage — Natural Language Parsing", () => {
  it("parses approve message and resolves permission", async () => {
    const reqId = randomUUID();
    await PermissionRequestRepo.create({
      id: reqId,
      task_id: `d3-task-${uuid()}`,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      session_id: TEST_SESSION,
      field_name: "email",
      field_key: "user_email",
      purpose: "发送通知",
    });

    const result = await handlePermissionResponseMessage(
      `允许 ${reqId.slice(0, 8)}`,
      TEST_USER
    );

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("授权");
    expect(result.reply).toContain("email");
  });

  it("parses deny message", async () => {
    const reqId = randomUUID();
    await PermissionRequestRepo.create({
      id: reqId,
      task_id: `d3-task-${uuid()}`,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      session_id: TEST_SESSION,
      field_name: "phone",
      field_key: "phone_number",
      purpose: "电话联系",
    });

    const result = await handlePermissionResponseMessage(
      `拒绝 ${reqId.slice(0, 8)}`,
      TEST_USER
    );

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("拒绝");
  });

  it("returns handled=false for unrelated messages", async () => {
    const result = await handlePermissionResponseMessage(
      "今天天气怎么样？",
      TEST_USER
    );
    expect(result.handled).toBe(false);
  });

  it("warns when request ID not found", async () => {
    const result = await handlePermissionResponseMessage(
      "允许 abcdef12",
      TEST_USER
    );
    expect(result.handled).toBe(true);
    expect(result.reply).toContain("未找到");
  });

  it("parses English approve keywords", async () => {
    const reqId = randomUUID();
    await PermissionRequestRepo.create({
      id: reqId,
      task_id: `d3-task-${uuid()}`,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      session_id: TEST_SESSION,
      field_name: "email",
      field_key: "user_email",
      purpose: "发送通知",
    });

    const result = await handlePermissionResponseMessage(
      `approve ${reqId.slice(0, 8)}`,
      TEST_USER
    );
    expect(result.handled).toBe(true);
  });
});

// ── buildWorkerContextPrompt ─────────────────────────────────────────────────

describe("buildWorkerContextPrompt — Worker Prompt Generation", () => {
  it("includes allowed fields in objective section", () => {
    const prompt = buildWorkerContextPrompt(
      {
        allowed: { query: "查余额", report_type: "PDF" },
        blocked: [],
        pendingApproval: [],
      },
      "生成账户报表"
    );

    expect(prompt).toContain("生成账户报表");
    expect(prompt).toContain("查余额");
    expect(prompt).toContain("PDF");
  });

  it("mentions blocked fields", () => {
    const prompt = buildWorkerContextPrompt(
      {
        allowed: { query: "查余额" },
        blocked: ["password", "api_key"],
        pendingApproval: [],
      },
      "查余额"
    );

    expect(prompt).toContain("password");
    expect(prompt).toContain("api_key");
    expect(prompt).toContain("屏蔽");
  });

  it("mentions pending approval fields", () => {
    const prompt = buildWorkerContextPrompt(
      {
        allowed: { query: "发送通知" },
        blocked: [],
        pendingApproval: [{ key: "email", requestId: "abc123" }],
      },
      "发送通知"
    );

    expect(prompt).toContain("email");
    expect(prompt).toContain("待确认");
  });
});

// ── buildPermissionRequestPrompt ─────────────────────────────────────────────

describe("buildPermissionRequestPrompt — User Prompt Generation", () => {
  it("generates prompt for pending requests", async () => {
    const reqId = randomUUID();
    await PermissionRequestRepo.create({
      id: reqId,
      task_id: `d3-task-${uuid()}`,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      session_id: TEST_SESSION,
      field_name: "email",
      field_key: "user_email",
      purpose: "发送通知",
      value_preview: "us***@example.com",
    });

    const pending = await PermissionRequestRepo.getPending(TEST_USER);
    const prompt = buildPermissionRequestPrompt(pending);

    expect(prompt).toContain("email");
    expect(prompt).toContain("发送通知");
    expect(prompt).toContain(reqId.slice(0, 8)); // short ID in reply format
    expect(prompt).toContain("允许");
    expect(prompt).toContain("拒绝");
  });

  it("returns empty string when no pending requests", () => {
    const prompt = buildPermissionRequestPrompt([]);
    expect(prompt).toBe("");
  });
});

// ── ScopedTokenRepo ──────────────────────────────────────────────────────────

describe("ScopedTokenRepo — Token Validation", () => {
  it("create and validate round-trip", async () => {
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    await ScopedTokenRepo.create({
      id: randomUUID(),
      token,
      task_id: `d3-task-${uuid()}`,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      scope: ["email", "name"],
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });

    const record = await ScopedTokenRepo.validate(token);
    expect(record).not.toBeNull();
    expect(record!.scope).toContain("email");
    expect(record!.scope).toContain("name");
  });

  it("validate returns null for nonexistent token", async () => {
    const record = await ScopedTokenRepo.validate("nonexistent-token-xyz");
    expect(record).toBeNull();
  });

  it("validate returns null for expired token", async () => {
    const token = randomUUID().replace(/-/g, "");
    await ScopedTokenRepo.create({
      id: randomUUID(),
      token,
      task_id: `d3-task-${uuid()}`,
      worker_id: TEST_WORKER,
      user_id: TEST_USER,
      scope: ["email"],
      expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
    });

    const record = await ScopedTokenRepo.validate(token);
    expect(record).toBeNull();
  });
});
