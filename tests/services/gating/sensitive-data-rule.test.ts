import { describe, it, expect } from "vitest";
import { detectSensitiveData } from "../../../src/services/gating/sensitive-data-rule.js";

describe("SensitiveDataGuard", () => {
  describe("detectSensitiveData", () => {
    // ── 红线数据（应被检测）───────────────────────────────────────────────

    it("检测 OpenAI API Key 格式", () => {
      const result = detectSensitiveData("我的 API key 是 sk-abc123def456ghi789jkl012mno345pqr678");
      expect(result).not.toBeNull();
      expect(result!.detected).toBe(true);
      expect(result!.type).toBe("api_secret");
    });

    it("检测 GitHub Token 格式", () => {
      const result = detectSensitiveData("ghp_abcdefghijklmnopqrstuvwxyz1234567890AB");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("api_secret");
    });

    it("检测 AWS Access Key 格式", () => {
      const result = detectSensitiveData("AKIAIOSFODNN7EXAMPLE");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("api_secret");
    });

    it("检测 password= 格式", () => {
      const result = detectSensitiveData("连接服务器，password=MyStr0ng!Pass");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("api_secret");
    });

    it("检测 passwd: 格式", () => {
      const result = detectSensitiveData("服务器 passwd: qwerty123");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("api_secret");
    });

    it("检测 pwd: 格式", () => {
      const result = detectSensitiveData("帮我登录，pwd: letmein");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("api_secret");
    });

    it("检测 18 位身份证号", () => {
      const result = detectSensitiveData("我的身份证号是 110101199003078911");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("id_card");
      expect(result!.label).toBe("身份证号");
    });

    it("检测 15 位身份证号", () => {
      const result = detectSensitiveData("证件：110101900307891");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("id_card");
    });

    it("检测银行卡号（4-4-4-4 格式）", () => {
      const result = detectSensitiveData("卡号 6228 8200 1234 5678");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("bank_card");
      expect(result!.label).toBe("银行卡号");
    });

    it("检测 16 位银行卡号", () => {
      const result = detectSensitiveData("卡号是6222021234567890，请确认");
      expect(result).not.toBeNull();
      expect(result!.type).toBe("bank_card");
    });

    // ── 误报场景（不应被检测）───────────────────────────────────────────

    it("普通查询不触发", () => {
      const result = detectSensitiveData("帮我写一段 Python 代码来计算斐波那契数列");
      expect(result).toBeNull();
    });

    it("包含 'password' 关键词但不是密码格式不触发", () => {
      // "password" 单独出现且没有 =: 跟随不算
      const result = detectSensitiveData("我忘记了我的密码是多少");
      expect(result).toBeNull();
    });

    it("普通数字序列不触发（不在银行卡格式内）", () => {
      const result = detectSensitiveData("订单编号：123456789");
      expect(result).toBeNull();
    });

    it("手机号不触发（不在敏感数据范围内）", () => {
      const result = detectSensitiveData("我的手机号是 13812345678，请联系我");
      expect(result).toBeNull();
    });

    it("邮箱不触发（不在敏感数据范围内）", () => {
      const result = detectSensitiveData("请发邮件到 test@example.com");
      expect(result).toBeNull();
    });
  });
});
