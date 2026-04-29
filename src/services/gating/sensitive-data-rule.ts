/**
 * Sensitive Data Guard — 信息分发红线硬检测
 *
 * 在数据发给云端模型之前，先扫描是否包含敏感信息。
 * 检测到红线 → 直接 block delegate_to_slow，不走 LLM 判断。
 *
 * 【设计原则】
 * - 极简：只检测真正的敏感数据（密码/密钥/证件）
 * - 不误杀：手机号/邮箱等可识别信息由 Manager Prompt 中的规则处理
 * - 独立于 LLM：正则扫描，不依赖模型输出
 */

export interface SensitiveDataResult {
  detected: boolean;
  type: string;
  label: string;
}

/**
 * 红线敏感数据 pattern（优先级：越精准的放前面）
 *
 * 检测顺序：
 * 1. bank_card — 16位数字最精准，先检测避免被 id_card 的 \d{15} 误捕
 * 2. id_card   — 15/18位身份证
 * 3. api_secret — API Key / Token / 密码
 */
const SENSITIVE_PATTERNS: Array<{
  id: string;
  label: string;
  patterns: RegExp[];
}> = [
  {
    id: "api_secret",
    label: "API 密钥/私钥",
    patterns: [
      /sk[-_][a-zA-Z0-9]{20,}/i, // OpenAI key
      /ghp_[a-zA-Z0-9]{36}/i, // GitHub token
      /AKIA[A-Z0-9]{16}/i, // AWS access key
      /[a-zA-Z0-9_+.-]{20,}==$/m, // generic secret with base64 suffix
      /password\s*[=:]\s*\S+/i,
      /passwd\s*[=:]\s*\S+/i,
      /pwd\s*[=:]\s*\S+/i,
    ],
  },
  {
    id: "bank_card",
    label: "银行卡号",
    patterns: [
      /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,  // 带分隔符
      /(?<!\d)\d{16}(?!\d)/,                                // 纯16位，前后无数字
    ],
  },
  {
    id: "id_card",
    label: "身份证号",
    patterns: [
      /(?<!\d)\d{15}(?!\d)/,              // 15位且前后无数字
      /(?<!\d)\d{17}[\dXx](?!\d)/,       // 18位且前后无数字
    ],
  },
];

/**
 * 扫描输入是否包含红线敏感数据。
 * 返回第一个命中的敏感类型（如果有）。
 */
export function detectSensitiveData(
  input: string
): SensitiveDataResult | null {
  for (const group of SENSITIVE_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(input)) {
        return {
          detected: true,
          type: group.id,
          label: group.label,
        };
      }
    }
  }
  return null;
}
