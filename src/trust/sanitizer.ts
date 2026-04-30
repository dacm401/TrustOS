/**
 * Sanitization Engine — T3-3
 *
 * 对敏感数据进行脱敏处理（Policy 返回 transform 决策后执行）。
 * 原则：
 * - 原始数据不变（纯函数，返回新对象）
 * - 只处理 Policy 明确要求的转换，不多做
 * - 支持嵌套对象和数组
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

import type { DataTransform } from "./policy-engine.js";

// ── 内建 Redactor ──────────────────────────────────────────────────────────────

/** Redactor 函数签名：输入原始值，返回脱敏后值 */
export type Redactor = (value: unknown) => unknown;

/** 内建 redactor 注册表 */
export const BUILTIN_REDACTORS: Record<string, Redactor> = {
  // 邮箱：laura.zhang@startup.io → la***@***.io
  email: (v: unknown) => {
    if (typeof v !== "string") return v;
    // 保留前1-2字符 + *** + 完整域名
    const atIdx = v.indexOf("@");
    if (atIdx < 0) return v;
    const local = v.slice(0, atIdx);
    const domain = v.slice(atIdx + 1);
    const masked = local[0] + "*".repeat(Math.max(0, local.length - 1));
    return `${masked}@${domain}`;
  },

  // 手机号：13812345678 → ******5678
  phone: (v: unknown) => {
    if (typeof v !== "string") return v;
    return v.replace(/\d(?=\d{4})/g, "*");
  },

  // 姓名：中文两字 → 张*，中文三字+ → 张*某，张**；英文 → J*** D***
  name: (v: unknown) => {
    if (typeof v !== "string") return v;
    if (/[\u4e00-\u9fff]/.test(v)) {
      // 中文
      if (v.length <= 2) return v[0] + "*";
      return v[0] + "*".repeat(v.length - 1);
    }
    // 英文：每个单词保留首字母 + *填充到原长度
    const parts = v.trim().split(/\s+/);
    return parts.map((p) => p[0] + "*".repeat(Math.max(0, p.length - 1))).join(" ");
  },

  // 遮罩：自定义字符（默认 *）
  mask: (v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") return v;
    const str = String(v);
    if (str.length <= 2) return "*".repeat(str.length);
    return str[0] + "*".repeat(str.length - 1);
  },

  // 日期泛化：2024-03-15 → 2024年（保留年）
  date: (v: unknown) => {
    if (typeof v !== "string") return v;
    const match = v.match(/^(\d{4})(-\d{2}-\d{2})?(T\d{2}:\d{2}:\d{2})?/);
    if (match) return `${match[1]}年`;
    return v;
  },

  // 金钱泛化：保留数量级
  money: (v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") return v;
    const num = typeof v === "string" ? parseFloat(v.replace(/[,$]/g, "")) : v;
    if (isNaN(num)) return v;
    if (num >= 1_000_000) return "百万级";
    if (num >= 10_000) return "万级";
    if (num >= 1_000) return "千级";
    return "个位级";
  },

  // 余额/金额遮罩：保留后4位
  account: (v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") return v;
    const str = String(v);
    if (str.length <= 4) return "*".repeat(str.length);
    return "*".repeat(str.length - 4) + str.slice(-4);
  },

  // 通用遮罩：保留首尾各1位
  generic: (v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") return v;
    const str = String(v);
    if (str.length <= 2) return "*".repeat(str.length);
    if (str.length <= 4) return str[0] + "*".repeat(str.length - 1);
    return str.slice(0, 2) + "*".repeat(Math.max(0, str.length - 4)) + str.slice(-2);
  },
};

// ── Sanitizer ────────────────────────────────────────────────────────────────

export class Sanitizer {
  private redactors: Map<string, Redactor>;

  constructor(redactors?: Record<string, Redactor>) {
    this.redactors = new Map(Object.entries(redactors ?? BUILTIN_REDACTORS));
  }

  /** 注册自定义 redactor */
  register(name: string, redactor: Redactor): void {
    this.redactors.set(name, redactor);
  }

  /**
   * 对数据进行脱敏处理
   * @param data 原始数据（不会被修改）
   * @param transforms 需要的转换规则列表
   * @returns 脱敏后的数据
   */
  sanitize(data: unknown, transforms: DataTransform[]): unknown {
    if (!transforms || transforms.length === 0) return data;
    let result = data;
    for (const transform of transforms) {
      result = this.applyTransform(result, transform);
    }
    return result;
  }

  private applyTransform(data: unknown, transform: DataTransform): unknown {
    switch (transform.type) {
      case "redact":
        return this.redactAtPath(data, transform.path);

      case "mask": {
        const maskChar = transform.maskChar ?? "*";
        return this.maskAtPath(data, transform.path, maskChar);
      }

      case "generalize":
        return this.generalizeAtPath(data, transform.path);

      case "replace":
        return this.setAtPath(data, transform.path, transform.with);

      default:
        return data;
    }
  }

  // ── 路径操作 ────────────────────────────────────────────────────────────────

  /**
   * 在嵌套对象/数组的指定路径上执行 redaction（全字段删除）
   */
  private redactAtPath(data: unknown, path: string[]): unknown {
    if (path.length === 0) return "[已删除]";
    const [head, ...rest] = path;
    if (this.isContainer(data)) {
      const result = Array.isArray(data) ? [...data] : { ...data as Record<string, unknown> };
      result[head as number | string] = this.redactAtPath(result[head as number | string], rest);
      return result;
    }
    return data;
  }

  /**
   * 在指定路径上执行遮罩
   */
  private maskAtPath(data: unknown, path: string[], maskChar: string): unknown {
    if (path.length === 0) {
      if (typeof data !== "string" && typeof data !== "number") return "[已遮罩]";
      const str = String(data);
      // 统一使用与 BUILTIN_REDACTORS.mask 相同的遮罩逻辑：保留首字符
      const redacted = maskChar === "*"
        ? (str.length <= 2 ? maskChar.repeat(str.length) : str[0] + maskChar.repeat(str.length - 1))
        : str[0] + maskChar.repeat(str.length - 1);
      return redacted;
    }
    const [head, ...rest] = path;
    if (!this.isContainer(data)) return data;
    const result = Array.isArray(data) ? [...data] : { ...data as Record<string, unknown> };
    result[head as number | string] = this.maskAtPath(result[head as number | string], rest, maskChar);
    return result;
  }

  /**
   * 在指定路径上执行泛化
   */
  private generalizeAtPath(data: unknown, path: string[]): unknown {
    if (path.length === 0) {
      return this.generalizeValue(data);
    }
    const [head, ...rest] = path;
    if (!this.isContainer(data)) return data;
    const result = Array.isArray(data) ? [...data] : { ...data as Record<string, unknown> };
    result[head as number | string] = this.generalizeAtPath(result[head as number | string], rest);
    return result;
  }

  /**
   * 在指定路径上设置替换值
   */
  private setAtPath(data: unknown, path: string[], value: unknown): unknown {
    if (path.length === 0) return value;
    const [head, ...rest] = path;
    if (!this.isContainer(data)) return data;
    const result = Array.isArray(data) ? [...data] : { ...data as Record<string, unknown> };
    result[head as number | string] = this.setAtPath(result[head as number | string], rest, value);
    return result;
  }

  // ── 工具函数 ────────────────────────────────────────────────────────────────

  private isContainer(data: unknown): data is Record<string, unknown> | unknown[] {
    return typeof data === "object" && data !== null;
  }

  /** 单值泛化 */
  private generalizeValue(value: unknown): unknown {
    if (typeof value === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.replace(/^(\d{4})-\d{2}-\d{2}.*/, "$1年"); // 日期
      }
      if (/@/.test(value) && /^\S+@\S+\.\S+$/.test(value)) {
        return "[邮箱]"; // 邮箱
      }
      if (/^\+?[\d\s\-()]+$/.test(value) && value.replace(/\D/g, "").length >= 7) {
        return "[电话]"; // 电话
      }
      if (/^\d+$/.test(value)) {
        const n = parseInt(value, 10);
        if (n >= 1_000_000) return "百万级";
        if (n >= 10_000) return "万级";
        if (n >= 1_000) return "千级";
        return "个位级";
      }
    }
    return "[已泛化]";
  }

  /**
   * 自动扫描对象中的 PII 字段并生成 transform 列表
   * 启发式扫描，用于全自动脱敏场景
   */
  detectPII(obj: Record<string, unknown>): DataTransform[] {
    const transforms: DataTransform[] = [];
    this.scanPII(obj, [], transforms);
    return transforms;
  }

  private scanPII(obj: unknown, path: string[], transforms: DataTransform[]): void {
    if (!this.isContainer(obj)) return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => this.scanPII(item, [...path, String(i)], transforms));
      return;
    }
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      const newPath = [...path, key];

      if (/email/.test(lower) && typeof value === "string") {
        transforms.push({ type: "replace", path: newPath, with: BUILTIN_REDACTORS.email(value) });
      } else if (/phone|mobile|tel/.test(lower) && typeof value === "string") {
        transforms.push({ type: "replace", path: newPath, with: BUILTIN_REDACTORS.phone(value) });
      } else if (/password|passwd|secret|token|apikey|api_key/.test(lower)) {
        transforms.push({ type: "replace", path: newPath, with: "[已遮罩]" });
      } else if (/address/.test(lower) && typeof value === "string") {
        transforms.push({ type: "generalize", path: newPath });
      } else {
        this.scanPII(value, newPath, transforms);
      }
    }
  }
}

/** 默认全局 sanitizer 实例 */
export const defaultSanitizer = new Sanitizer();