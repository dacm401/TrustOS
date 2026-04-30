/**
 * 上下文压缩服务 - Stream V2
 * 智能摘要 + 向量检索，保持 Context < 80%
 */

export interface CompressionOptions {
  /** 最大 token 数（默认 4000，约 16000 字符） */
  maxTokens?: number;
  /** 摘要压缩比（默认 0.3，保留 30%） */
  compressionRatio?: number;
  /** 保留的关键信息类型 */
  preserveTypes?: ("code" | "data" | "decision" | "fact" | "question")[];
}

interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface CompressionResult {
  compressed: ConversationMessage[];
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  summary?: string;
}

/**
 * 估算文本的 token 数（粗略估算，中文约 2 字符/token，英文约 4 字符/token）
 */
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 2) + Math.ceil(englishChars / 4);
}

/**
 * 智能压缩对话历史
 */
export function compressConversationHistory(
  messages: ConversationMessage[],
  options: CompressionOptions = {}
): CompressionResult {
  const {
    maxTokens = 4000,
    compressionRatio = 0.3,
    preserveTypes = ["code", "data", "decision", "fact"],
  } = options;

  // 计算原始 token 数
  const originalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  // 如果已经在限制内，直接返回
  if (originalTokens <= maxTokens) {
    return {
      compressed: messages,
      originalTokens,
      compressedTokens: originalTokens,
      compressionRatio: 1,
    };
  }

  // 分类消息，保留重要信息
  const categorized: Record<string, ConversationMessage[]> = {
    code: [],
    data: [],
    decision: [],
    fact: [],
    question: [],
    other: [],
  };

  for (const msg of messages) {
    const content = msg.content;

    if (/```[\s\S]*?```/.test(content) || /`[^`]+`/.test(content)) {
      categorized.code.push(msg);
    } else if (/\d+(\.\d+)?%|\d{4,}|^\s*[-*]\s*.+\n.+\n.+/m.test(content)) {
      categorized.data.push(msg);
    } else if (/决定|decision|路由|routing|选择|choice|结论|conclusion/i.test(content)) {
      categorized.decision.push(msg);
    } else if (/事实|fact|记住|remember|关键|important|用户信息|user info/i.test(content)) {
      categorized.fact.push(msg);
    } else if (/^\?|[?？]$|什么|how|why|when|where|who/i.test(content)) {
      categorized.question.push(msg);
    } else {
      categorized.other.push(msg);
    }
  }

  // 选择要保留的消息
  const preserved: ConversationMessage[] = [];
  const targetTokens = Math.floor(maxTokens * compressionRatio);
  let currentTokens = 0;

  // 优先保留重要类型
  for (const type of preserveTypes) {
    if (currentTokens >= targetTokens) break;
    for (const msg of categorized[type]) {
      if (currentTokens >= targetTokens) break;
      const tokens = estimateTokens(msg.content);
      if (tokens <= maxTokens * 0.2) {
        // 单条消息不超过 20% 的限制
        preserved.push(msg);
        currentTokens += tokens;
      }
    }
  }

  // 如果还有空间，保留问题
  if (currentTokens < targetTokens) {
    for (const msg of categorized.question) {
      if (currentTokens >= targetTokens) break;
      const tokens = estimateTokens(msg.content);
      if (tokens <= maxTokens * 0.15) {
        preserved.push(msg);
        currentTokens += tokens;
      }
    }
  }

  // 如果还有空间，保留其他消息（最新的优先）
  if (currentTokens < targetTokens) {
    const reversedOther = [...categorized.other].reverse();
    for (const msg of reversedOther) {
      if (currentTokens >= targetTokens) break;
      const tokens = estimateTokens(msg.content);
      if (tokens <= maxTokens * 0.1) {
        preserved.push(msg);
        currentTokens += tokens;
      }
    }
  }

  // 按原始顺序排序
  preserved.sort((a, b) => messages.indexOf(a) - messages.indexOf(b));

  // 生成摘要
  const summary = generateSummary(messages, preserved, originalTokens, currentTokens);

  // 如果保留的消息太少，添加一个摘要消息
  if (preserved.length < 3 && messages.length > 3) {
    const summaryMsg: ConversationMessage = {
      role: "system",
      content: `[上下文已压缩] 原始 ${messages.length} 条消息，${originalTokens} tokens → 保留 ${preserved.length} 条关键消息，约 ${currentTokens} tokens。\n\n${summary}`,
    };
    preserved.unshift(summaryMsg);
    currentTokens += estimateTokens(summaryMsg.content);
  }

  return {
    compressed: preserved,
    originalTokens,
    compressedTokens: currentTokens,
    compressionRatio: currentTokens / originalTokens,
    summary,
  };
}

/**
 * 生成压缩摘要
 */
function generateSummary(
  original: ConversationMessage[],
  preserved: ConversationMessage[],
  originalTokens: number,
  compressedTokens: number
): string {
  const preservedIndices = preserved.map((p) => original.indexOf(p));
  const firstIdx = Math.min(...preservedIndices);
  const lastIdx = Math.max(...preservedIndices);

  const userMessages = original.filter((m) => m.role === "user").length;
  const assistantMessages = original.filter((m) => m.role === "assistant").length;

  return `对话历史摘要（${original.length} 条消息 → ${preserved.length} 条）:
- 用户消息: ${userMessages} 条
- 助手消息: ${assistantMessages} 条
- 保留范围: 第 ${firstIdx + 1} - ${lastIdx + 1} 条消息
- 压缩比: ${((1 - compressedTokens / originalTokens) * 100).toFixed(0)}%`;
}

/**
 * 提取对话中的关键信息
 */
export function extractKeyInformation(
  messages: ConversationMessage[]
): {
  decisions: string[];
  facts: string[];
  pendingQuestions: string[];
} {
  const decisions: string[] = [];
  const facts: string[] = [];
  const pendingQuestions: string[] = [];

  for (const msg of messages) {
    const content = msg.content;

    // 提取决定
    if (/决定|decision|选择|choice|路由|routing/i.test(content) && msg.role === "assistant") {
      const match = content.match(/[^.。!！?？]{10,50}[.。!！?？]/);
      if (match) decisions.push(match[0].trim());
    }

    // 提取事实
    if (/(记住|important|关键|用户信息|fact|remember|note)/i.test(content)) {
      facts.push(content.substring(0, 100));
    }

    // 提取未回答的问题
    if (msg.role === "user" && /[?？]$/.test(content) && !content.includes("谢谢")) {
      const hasAnswered = messages.slice(messages.indexOf(msg) + 1).some(
        (m) => m.role === "assistant" && !/不知道|no idea|不确定/i.test(m.content)
      );
      if (!hasAnswered) {
        pendingQuestions.push(content);
      }
    }
  }

  return {
    decisions: decisions.slice(0, 5),
    facts: facts.slice(0, 5),
    pendingQuestions: pendingQuestions.slice(0, 3),
  };
}

/**
 * 创建压缩后的提示上下文
 */
export function createCompressedContext(
  messages: ConversationMessage[],
  options: CompressionOptions = {}
): {
  context: ConversationMessage[];
  info: {
    originalCount: number;
    compressedCount: number;
    compressionPercent: number;
  };
} {
  const result = compressConversationHistory(messages, options);

  return {
    context: result.compressed,
    info: {
      originalCount: messages.length,
      compressedCount: result.compressed.length,
      compressionPercent: Math.round((1 - result.compressionRatio) * 100),
    },
  };
}
