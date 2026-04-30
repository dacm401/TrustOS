/**
 * Sanitizer — 单元测试
 */

import { describe, it, expect } from "vitest";
import { Sanitizer, BUILTIN_REDACTORS, defaultSanitizer } from "../../src/trust/sanitizer.js";

describe("BUILTIN_REDACTORS", () => {
  describe("email", () => {
    it("正常邮箱脱敏", () => {
      expect(BUILTIN_REDACTORS.email("laura.zhang@startup.io")).toBe("l**********@startup.io");
      expect(BUILTIN_REDACTORS.email("user@example.com")).toBe("u***@example.com");
    });
    it("非字符串返回原值", () => {
      expect(BUILTIN_REDACTORS.email(123)).toBe(123);
      expect(BUILTIN_REDACTORS.email(null)).toBe(null);
    });
  });

  describe("phone", () => {
    it("手机号脱敏，保留后4位", () => {
      expect(BUILTIN_REDACTORS.phone("13812345678")).toBe("*******5678");
      expect(BUILTIN_REDACTORS.phone("+86 13912345678")).toBe("+86 *******5678");
    });
  });

  describe("name", () => {
    it("中文姓名脱敏", () => {
      expect(BUILTIN_REDACTORS.name("张三")).toBe("张*");
      expect(BUILTIN_REDACTORS.name("李四五六")).toBe("李***");
      expect(BUILTIN_REDACTORS.name("张")).toBe("张*");
    });
    it("英文姓名脱敏，保留首字母", () => {
      expect(BUILTIN_REDACTORS.name("John Doe")).toBe("J*** D**");
    });
  });

  describe("mask", () => {
    it("通用遮罩，保留首字符", () => {
      expect(BUILTIN_REDACTORS.mask("secret123")).toBe("s********");
      expect(BUILTIN_REDACTORS.mask(999)).toBe("9**");
    });
  });

  describe("money", () => {
    it("数量级泛化", () => {
      expect(BUILTIN_REDACTORS.money("1234567")).toBe("百万级");
      expect(BUILTIN_REDACTORS.money(12345)).toBe("万级");
      expect(BUILTIN_REDACTORS.money(999)).toBe("个位级");
      expect(BUILTIN_REDACTORS.money("invalid")).toBe("invalid");
    });
  });
});

describe("Sanitizer.sanitize()", () => {
  const sanitizer = new Sanitizer();

  it("无 transforms 时返回原数据", () => {
    expect(sanitizer.sanitize({ a: 1 }, [])).toEqual({ a: 1 });
    expect(sanitizer.sanitize("hello", [])).toBe("hello");
  });

  describe("redact", () => {
    it("删除顶层字段", () => {
      const result = sanitizer.sanitize({ name: "张三", age: 30 }, [
        { type: "redact", path: ["name"] },
      ]);
      expect(result).toEqual({ name: "[已删除]", age: 30 });
    });

    it("删除嵌套字段", () => {
      const result = sanitizer.sanitize({ user: { name: "张三", age: 30 } }, [
        { type: "redact", path: ["user", "name"] },
      ]);
      expect(result).toEqual({ user: { name: "[已删除]", age: 30 } });
    });

    it("删除数组元素中的字段", () => {
      const result = sanitizer.sanitize({ items: [{ a: 1 }, { a: 2 }] }, [
        { type: "redact", path: ["items", "0", "a"] },
      ]);
      expect(result).toEqual({ items: [{ a: "[已删除]" }, { a: 2 }] });
    });

    it("原始对象不变", () => {
      const original = { name: "张三" };
      sanitizer.sanitize(original, [{ type: "redact", path: ["name"] }]);
      expect(original.name).toBe("张三");
    });
  });

  describe("mask", () => {
    it("默认 * 遮罩，保留首字符", () => {
      const result = sanitizer.sanitize({ secret: "abc123" }, [
        { type: "mask", path: ["secret"] },
      ]);
      expect(result).toEqual({ secret: "a*****" });
    });

    it("自定义遮罩字符", () => {
      const result = sanitizer.sanitize({ secret: "abc123" }, [
        { type: "mask", path: ["secret"], maskChar: "#" },
      ]);
      expect(result).toEqual({ secret: "a#####" });
    });

    it("嵌套遮罩", () => {
      const result = sanitizer.sanitize({ deep: { key: "value" } }, [
        { type: "mask", path: ["deep", "key"] },
      ]);
      expect(result).toEqual({ deep: { key: "v****" } });
    });
  });

  describe("generalize", () => {
    it("日期泛化为年", () => {
      const result = sanitizer.sanitize({ date: "2024-03-15" }, [
        { type: "generalize", path: ["date"] },
      ]);
      expect(result).toEqual({ date: "2024年" });
    });

    it("未知值泛化为标记", () => {
      const result = sanitizer.sanitize({ field: "some text" }, [
        { type: "generalize", path: ["field"] },
      ]);
      expect(result).toEqual({ field: "[已泛化]" });
    });
  });

  describe("replace", () => {
    it("替换为指定值", () => {
      const result = sanitizer.sanitize({ name: "张三" }, [
        { type: "replace", path: ["name"], with: "[已遮罩]" },
      ]);
      expect(result).toEqual({ name: "[已遮罩]" });
    });

    it("替换为 null", () => {
      const result = sanitizer.sanitize({ name: "张三" }, [
        { type: "replace", path: ["name"], with: null },
      ]);
      expect(result).toEqual({ name: null });
    });
  });

  describe("组合多个 transform", () => {
    it("按顺序执行多个 transform", () => {
      const result = sanitizer.sanitize(
        { email: "test@example.com", phone: "13812345678", name: "张三" },
        [
          { type: "replace", path: ["email"], with: BUILTIN_REDACTORS.email("test@example.com") },
          { type: "replace", path: ["phone"], with: BUILTIN_REDACTORS.phone("13812345678") },
          { type: "redact", path: ["name"] },
        ]
      );
      expect(result).toEqual({
        email: "t***@example.com",
        phone: "*******5678",
        name: "[已删除]",
      });
    });
  });
});

describe("Sanitizer.detectPII()", () => {
  const sanitizer = new Sanitizer();

  it("检测 email 字段", () => {
    const transforms = sanitizer.detectPII({ userEmail: "a@b.com" });
    expect(transforms).toHaveLength(1);
    expect(transforms[0].type).toBe("replace");
  });

  it("检测 phone 字段", () => {
    const transforms = sanitizer.detectPII({ phone: "13812345678" });
    expect(transforms).toHaveLength(1);
    expect(transforms[0].type).toBe("replace");
  });

  it("检测 password 字段", () => {
    const transforms = sanitizer.detectPII({ apiKey: "secret123" });
    expect(transforms).toHaveLength(1);
    expect((transforms[0] as any).with).toBe("[已遮罩]");
  });

  it("无 PII 时返回空数组", () => {
    const transforms = sanitizer.detectPII({ id: "123", status: "active" });
    expect(transforms).toHaveLength(0);
  });

  it("嵌套对象递归检测", () => {
    const transforms = sanitizer.detectPII({ user: { email: "a@b.com" } });
    expect(transforms).toHaveLength(1);
    expect((transforms[0] as any).path).toEqual(["user", "email"]);
  });
});

describe("Sanitizer.register()", () => {
  it("可注册自定义 redactor", () => {
    const sanitizer = new Sanitizer();
    sanitizer.register("custom_upper", (v) => typeof v === "string" ? v.toUpperCase() : v);

    const result = sanitizer.sanitize({ field: "hello" }, [
      { type: "replace", path: ["field"], with: sanitizer["redactors"].get("custom_upper")!("hello") },
    ]);
    expect(result).toEqual({ field: "HELLO" });
  });
});

describe("defaultSanitizer", () => {
  it("单例可用", () => {
    expect(defaultSanitizer.sanitize({ name: "张三" }, [{ type: "redact", path: ["name"] }]))
      .toEqual({ name: "[已删除]" });
  });
});