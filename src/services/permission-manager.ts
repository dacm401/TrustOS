/**
 * Sprint 64 — PermissionManager
 *
 * Fast Manager 的守门人模块：
 *   1. 对用户上下文中的字段进行敏感度分类
 *   2. 决定哪些字段可以自动注入 Worker，哪些需要请示主人
 *   3. 向用户发起 Permission Request，等待确认
 *   4. 为 Worker 生成 Scoped Token（代理调用用）
 *   5. 在 Worker prompt 注入前过滤 PII/Credential
 */

import { randomUUID } from "crypto";
import {
  PermissionRequestRepo,
  ScopedTokenRepo,
  type PermissionRequestRecord,
} from "../db/repositories.js";

// ── 数据权限级别 ──────────────────────────────────────────────────────────────

export enum DataPermissionLevel {
  /** 任务运行所必需，自动授权 */
  NECESSARY = "necessary",
  /** 敏感但可授权，需主人确认 */
  IMPORTANT = "important",
  /** 绝对禁止流向 Worker */
  BLOCKED = "blocked",
}

// ── 字段分类规则 ──────────────────────────────────────────────────────────────

export interface FieldClassification {
  level: DataPermissionLevel;
  /** 给主人显示的字段描述 */
  displayName: string;
  /** 脱敏后的预览值（IMPORTANT 级别展示给主人确认用） */
  maskedPreview?: string;
}

/** 正则规则 → 分类 */
const BLOCKED_PATTERNS: RegExp[] = [
  /password|passwd|pwd|secret|api[_-]?key|token|credential|private[_-]?key/i,
  /id[_-]?card|passport|ssn|social[_-]?sec/i,
  /bank[_-]?account|credit[_-]?card|card[_-]?number|cvv/i,
];

const IMPORTANT_PATTERNS: RegExp[] = [
  /phone|mobile|tel/i,
  /email|mail/i,
  /address|addr|location/i,
  /name|fullname|surname|lastname|firstname/i,
  /birth|birthday|age/i,
];

/**
 * 对单个字段 key 做分类
 */
export function classifyField(
  key: string,
  value: unknown
): FieldClassification {
  // BLOCKED
  if (BLOCKED_PATTERNS.some((r) => r.test(key))) {
    return {
      level: DataPermissionLevel.BLOCKED,
      displayName: key,
    };
  }
  // IMPORTANT
  if (IMPORTANT_PATTERNS.some((r) => r.test(key))) {
    const str = String(value ?? "");
    return {
      level: DataPermissionLevel.IMPORTANT,
      displayName: key,
      maskedPreview: maskValue(str),
    };
  }
  // 默认 NECESSARY
  return {
    level: DataPermissionLevel.NECESSARY,
    displayName: key,
  };
}

/** 简单脱敏：保留前 2 位和后 2 位，中间替换为 * */
function maskValue(v: string): string {
  if (v.length <= 4) return "****";
  return v.slice(0, 2) + "*".repeat(Math.min(v.length - 4, 6)) + v.slice(-2);
}

// ── 上下文过滤 ────────────────────────────────────────────────────────────────

export interface FilteredContext {
  /** 可以传给 Worker 的字段 */
  allowed: Record<string, unknown>;
  /** 被自动阻断的字段 key 列表 */
  blocked: string[];
  /** 需要主人确认的字段（已发起 PermissionRequest） */
  pendingApproval: Array<{ key: string; requestId: string }>;
}

/**
 * 过滤 userContext，返回：
 *   - 可直接传给 Worker 的字段
 *   - 被阻断的字段
 *   - 需要等待主人确认的字段（已写入 DB）
 */
export async function filterContextForWorker(params: {
  userContext: Record<string, unknown>;
  taskId: string;
  workerId: string;
  userId: string;
  sessionId: string;
  /** 任务目的描述（用于向主人说明为何需要该字段） */
  taskPurpose: string;
}): Promise<FilteredContext> {
  const { userContext, taskId, workerId, userId, sessionId, taskPurpose } = params;
  const allowed: Record<string, unknown> = {};
  const blocked: string[] = [];
  const pendingApproval: Array<{ key: string; requestId: string }> = [];

  for (const [key, value] of Object.entries(userContext)) {
    const cls = classifyField(key, value);

    if (cls.level === DataPermissionLevel.BLOCKED) {
      blocked.push(key);
      continue;
    }

    if (cls.level === DataPermissionLevel.NECESSARY) {
      allowed[key] = value;
      continue;
    }

    // IMPORTANT → 发起 PermissionRequest
    const reqId = randomUUID();
    await PermissionRequestRepo.create({
      id: reqId,
      task_id: taskId,
      worker_id: workerId,
      user_id: userId,
      session_id: sessionId,
      field_name: cls.displayName,
      field_key: key,
      purpose: taskPurpose,
      value_preview: cls.maskedPreview,
      expires_in: 300,
    });
    pendingApproval.push({ key, requestId: reqId });
  }

  return { allowed, blocked, pendingApproval };
}

// ── Scoped Token 生成 ─────────────────────────────────────────────────────────

/**
 * 为 Worker 生成一个受限访问 Token。
 * Worker 持有此 token 调用受保护 API；Fast 代理验证 scope 后再放行。
 */
export async function issueScopedToken(params: {
  taskId: string;
  workerId: string;
  userId: string;
  scope: string[];
  expiresInSeconds?: number;
}): Promise<string> {
  const { taskId, workerId, userId, scope, expiresInSeconds = 300 } = params;
  const tokenValue = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  await ScopedTokenRepo.create({
    id: randomUUID(),
    token: tokenValue,
    task_id: taskId,
    worker_id: workerId,
    user_id: userId,
    scope,
    expires_at: expiresAt,
  });

  return tokenValue;
}

/**
 * 验证 Worker 提交的 scoped token，检查 scope 是否覆盖请求的字段。
 * 返回 null 表示无效或已过期。
 */
export async function validateScopedToken(
  token: string,
  requiredScope: string
): Promise<{ valid: boolean; workerId?: string; userId?: string }> {
  const record = await ScopedTokenRepo.validate(token);
  if (!record) return { valid: false };
  if (!record.scope.includes(requiredScope) && !record.scope.includes("*")) {
    return { valid: false };
  }
  return { valid: true, workerId: record.worker_id, userId: record.user_id };
}

// ── 授权确认 ─────────────────────────────────────────────────────────────────

export interface PermissionDecision {
  requestId: string;
  approved: boolean;
  approvedScope?: string;
  resolvedBy: string;
}

/**
 * 主人确认/拒绝 PermissionRequest。
 * 如果批准，自动生成 scoped token 并返回。
 */
export async function resolvePermission(decision: PermissionDecision): Promise<{
  scopedToken?: string;
}> {
  if (decision.approved) {
    await PermissionRequestRepo.approve(
      decision.requestId,
      decision.resolvedBy,
      decision.approvedScope
    );
    // Sprint 65: 获取 request 详情并颁发 scoped token
    const req = await PermissionRequestRepo.getById(decision.requestId);
    if (req) {
      const token = await issueScopedToken({
        taskId: req.task_id,
        workerId: req.worker_id,
        userId: req.user_id,
        scope: decision.approvedScope ? [decision.approvedScope] : [req.field_key],
        expiresInSeconds: req.expires_in,
      });
      return { scopedToken: token };
    }
    return {};
  } else {
    await PermissionRequestRepo.deny(decision.requestId, decision.resolvedBy);
    return {};
  }
}

// ── 对话式权限响应解析 ────────────────────────────────────────────────────────

export interface PermissionResponseParsed {
  approved: boolean;
  /** request ID 的前 8 位（用于匹配） */
  requestIdPrefix: string;
}

/**
 * 检测用户消息是否是权限确认/拒绝回复。
 * 格式："允许 abc12345" 或 "拒绝 abc12345"（不区分大小写）
 */
export function parsePermissionResponse(message: string): PermissionResponseParsed | null {
  const approveMatch = message.trim().match(/^(允许|approve|yes|同意)\s+([a-f0-9\-]{8,36})/i);
  if (approveMatch) {
    return { approved: true, requestIdPrefix: approveMatch[2].toLowerCase() };
  }

  const denyMatch = message.trim().match(/^(拒绝|deny|no|不允许|不同意)\s+([a-f0-9\-]{8,36})/i);
  if (denyMatch) {
    return { approved: false, requestIdPrefix: denyMatch[2].toLowerCase() };
  }

  return null;
}

/**
 * 根据用户消息中的 requestIdPrefix 找到对应的 pending request，执行批准/拒绝。
 * 返回给用户的确认文本。
 */
export async function handlePermissionResponseMessage(
  message: string,
  userId: string
): Promise<{ handled: boolean; reply: string }> {
  const parsed = parsePermissionResponse(message);
  if (!parsed) return { handled: false, reply: "" };

  // 找到该用户所有 pending requests
  const pending = await PermissionRequestRepo.getPending(userId);
  const matched = pending.find((r) =>
    r.id.toLowerCase().startsWith(parsed.requestIdPrefix.toLowerCase())
  );

  if (!matched) {
    return {
      handled: true,
      reply: `⚠️ 未找到对应的权限请求（ID 前缀：${parsed.requestIdPrefix}），可能已超时或不存在。`,
    };
  }

  const result = await resolvePermission({
    requestId: matched.id,
    approved: parsed.approved,
    resolvedBy: userId,
    approvedScope: matched.field_key,
  });

  if (parsed.approved) {
    return {
      handled: true,
      reply: `✅ 已授权 **${matched.field_name}** 供 Worker 使用。任务将继续执行。${result.scopedToken ? `（令牌已颁发，有效期 ${matched.expires_in}s）` : ""}`,
    };
  } else {
    return {
      handled: true,
      reply: `🚫 已拒绝授权 **${matched.field_name}**，Worker 将在不使用该信息的情况下继续尝试。`,
    };
  }
}

// ── Worker Prompt 注入 ────────────────────────────────────────────────────────

/**
 * 生成注入 Worker 的上下文 prompt 片段。
 * 只包含 allowed 字段，屏蔽 blocked/pendingApproval 字段名。
 */
export function buildWorkerContextPrompt(
  filtered: FilteredContext,
  taskObjective: string
): string {
  const lines: string[] = [
    `【任务目标】${taskObjective}`,
    "",
    "【可用上下文】",
  ];

  for (const [k, v] of Object.entries(filtered.allowed)) {
    lines.push(`- ${k}: ${String(v)}`);
  }

  if (filtered.blocked.length > 0) {
    lines.push("");
    lines.push(
      `【注意】以下字段已被安全策略屏蔽，无法访问：${filtered.blocked.join(", ")}`
    );
  }

  if (filtered.pendingApproval.length > 0) {
    lines.push("");
    lines.push(
      `【待确认】以下字段正在等待主人授权，暂时不可用：${filtered.pendingApproval
        .map((p) => p.key)
        .join(", ")}`
    );
  }

  return lines.join("\n");
}

// ── 主人确认提示文本 ──────────────────────────────────────────────────────────

/**
 * 生成给主人的授权确认提示。
 * 在 Fast 给主人的回复中插入此内容。
 */
export function buildPermissionRequestPrompt(
  requests: PermissionRequestRecord[]
): string {
  if (requests.length === 0) return "";

  const lines = [
    "【⚠️ 授权确认】Worker 需要访问以下信息来完成任务：",
    "",
  ];

  for (const req of requests) {
    lines.push(
      `• **${req.field_name}**（${req.value_preview ?? "****"}）`,
      `  用途：${req.purpose}`,
      `  请回复"允许 ${req.id.slice(0, 8)}"或"拒绝 ${req.id.slice(0, 8)}"`,
      ""
    );
  }

  lines.push("_授权有效期 5 分钟，过期自动失效。_");
  return lines.join("\n");
}
