/**
 * 轻量级意图分类器 - Stream V2
 * 用于快速预判用户意图，减少误路由
 * 目标延迟: <10ms
 */

export type IntentCategory =
  | "greeting"
  | "question"
  | "command"
  | "clarification"
  | "feedback"
  | "chitchat"
  | "complex";

interface IntentResult {
  category: IntentCategory;
  confidence: number;
  suggested_action: "direct_answer" | "delegate_to_slow" | "execute_task" | "ask_clarification";
  reasoning?: string;
}

const GREETING_PATTERNS = [
  /^(hi|hello|hey|你好|您好|早上好|晚上好|hi!|hello!|hey!)/i,
  /^(hi|hello|hey|你好|您好|早上好|晚上好)\s*[,，.。]?$/i,
];

const COMMAND_PATTERNS = [
  /^(帮我|请帮我|能不能帮我|能不能|帮我一下)/,
  /^(给我|给我一个|给我写|给我创建)/,
  /^(生成|创建|制作|写一个|编写)/,
];

const CHITCHAT_PATTERNS = [
  /^(今天天气|你怎么看|你觉得|我想说|随便聊聊)/,
  /^(ok|okay|好|好吧|行|可以)/,
  /^(谢谢|感谢|多谢)/,
  /^(哈哈|哈哈哈|呵呵)/,
];

const FEEDBACK_PATTERNS = [
  /^(不对|不是|错了|有问题|不满意)/,
  /^(继续|还有|补充一下|另外)/,
  /^(明白了|知道了|懂了|了解)/,
];

const CLARIFICATION_PATTERNS = [
  /^\?{1,3}$/,
  /^什么意思/,
  /^(什么|哪个|怎么|如何)\?$/,
];

const COMPLEX_PATTERNS = [
  /(分析|比较|评估|预测|研究)/,
  /(代码|程序|函数|算法|实现)/,
  /(文档|报告|总结|摘要)/,
  /(数据|统计|图表|可视化)/,
];

/**
 * 轻量级意图分类
 * 使用规则匹配，延迟目标 <10ms
 */
export function classifyIntent(message: string): IntentResult {
  const msg = message.trim();
  const lowerMsg = msg.toLowerCase();

  // 1. Greeting - 直接回答
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      return {
        category: "greeting",
        confidence: 0.95,
        suggested_action: "direct_answer",
        reasoning: "Greeting pattern matched",
      };
    }
  }

  // 2. Clarification - 请求澄清
  for (const pattern of CLARIFICATION_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      return {
        category: "clarification",
        confidence: 0.9,
        suggested_action: "ask_clarification",
        reasoning: "Clarification pattern matched",
      };
    }
  }

  // 3. Command - 执行任务
  for (const pattern of COMMAND_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        category: "command",
        confidence: 0.85,
        suggested_action: "execute_task",
        reasoning: "Command pattern matched",
      };
    }
  }

  // 4. Feedback - 反馈
  for (const pattern of FEEDBACK_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      return {
        category: "feedback",
        confidence: 0.8,
        suggested_action: "direct_answer",
        reasoning: "Feedback pattern matched",
      };
    }
  }

  // 5. Chitchat - 闲聊
  for (const pattern of CHITCHAT_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      return {
        category: "chitchat",
        confidence: 0.8,
        suggested_action: "direct_answer",
        reasoning: "Chitchat pattern matched",
      };
    }
  }

  // 6. Complex - 需要委托
  let complexScore = 0;
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(msg)) {
      complexScore += 0.3;
    }
  }

  // 长度加权
  if (msg.length > 100) complexScore += 0.2;
  if (msg.length > 300) complexScore += 0.2;

  if (complexScore >= 0.3) {
    return {
      category: "complex",
      confidence: Math.min(complexScore, 0.95),
      suggested_action: complexScore >= 0.6 ? "delegate_to_slow" : "direct_answer",
      reasoning: `Complex score: ${complexScore.toFixed(2)}`,
    };
  }

  // 7. Default - 简单问题
  return {
    category: "question",
    confidence: 0.7,
    suggested_action: "direct_answer",
    reasoning: "Default question classification",
  };
}

/**
 * 根据意图预分类结果决定是否跳过 LLM 路由
 * 对于高置信度的简单意图，可以直接返回
 */
export function shouldSkipLLMRouting(intent: IntentResult): boolean {
  // Greeting、chitchat、clarification 高置信度时跳过 LLM
  if (intent.category === "greeting" && intent.confidence >= 0.9) return true;
  if (intent.category === "chitchat" && intent.confidence >= 0.85) return true;
  if (intent.category === "clarification" && intent.confidence >= 0.85) return true;

  return false;
}

/**
 * 根据意图生成快速响应
 */
export function generateQuickResponse(
  intent: IntentResult,
  lang: "zh" | "en"
): string | null {
  const responses: Record<IntentCategory, Record<"zh" | "en", string>> = {
    greeting: {
      zh: "你好！有什么我可以帮助你的吗？",
      en: "Hello! How can I help you today?",
    },
    chitchat: {
      zh: "好的，让我们继续吧。",
      en: "Sure, let's continue.",
    },
    clarification: {
      zh: "请问你能更详细地描述一下你的问题吗？",
      en: "Could you describe your question in more detail?",
    },
    question: { zh: "", en: "" },
    command: { zh: "", en: "" },
    feedback: { zh: "", en: "" },
    complex: { zh: "", en: "" },
  };

  const response = responses[intent.category]?.[lang];
  return response || null;
}

// ── S92P-HF1: Deterministic Date/Time Fast Path ────────────────────────────

const DATE_QUERY_PATTERNS_ZH = [
  /今天(是)?几号/,
  /今天(是)?什么日期/,
  /今天日期/,
  /现在几号/,
  /今天星期几/,
  /今天是?周几/,
  /当前日期/,
];

const DATE_QUERY_PATTERNS_EN = [
  /what date is (it )?today/i,
  /what('s| is) today('s)? date/i,
  /what day is (it )?today/i,
  /current date/i,
  /today('s)? date/i,
];

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const EN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Check if the message is a simple current-date query that can be answered
 * deterministically without any LLM call.
 * Returns the answer string, or null if not a date query.
 */
export function tryDateQueryFastPath(message: string): string | null {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Check Chinese patterns
  for (const pattern of DATE_QUERY_PATTERNS_ZH) {
    if (pattern.test(trimmed)) {
      return formatDateResponse("zh");
    }
  }

  // Check English patterns
  for (const pattern of DATE_QUERY_PATTERNS_EN) {
    if (pattern.test(lower)) {
      return formatDateResponse("en");
    }
  }

  return null;
}

function formatDateResponse(lang: "zh" | "en"): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = now.getDay();

  if (lang === "zh") {
    return `今天是${year}年${month}月${day}日，星期${ZH_WEEKDAYS[weekday]}。`;
  }
  return `Today is ${EN_WEEKDAYS[weekday]}, ${EN_MONTHS[now.getMonth()]} ${day}, ${year}.`;
}
