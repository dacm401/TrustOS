export interface TranslatedError {
  userMessage: string;
  techMessage: string;
  code: string;
  retryable: boolean;
  suggestedAction?: string;
}

const ERROR_PATTERNS: Array<{
  pattern: RegExp | string;
  translation: TranslatedError;
}> = [
  {
    pattern: 'ETIMEDOUT',
    translation: {
      userMessage: '网络连接超时，请检查网络设置后重试',
      techMessage: 'Connection timed out',
      code: 'NETWORK_TIMEOUT',
      retryable: true,
      suggestedAction: '请检查网络连接或稍后再试',
    },
  },
  {
    pattern: 'ECONNREFUSED',
    translation: {
      userMessage: '服务器已断开连接，请刷新页面重试',
      techMessage: 'Connection refused',
      code: 'CONNECTION_REFUSED',
      retryable: true,
      suggestedAction: '请刷新页面或联系技术支持',
    },
  },
  {
    pattern: /401|Unauthorized|unauthorized/i,
    translation: {
      userMessage: '登录已过期，请重新登录',
      techMessage: 'Unauthorized access',
      code: 'AUTH_REQUIRED',
      retryable: false,
      suggestedAction: '请重新登录',
    },
  },
  {
    pattern: /429|Too Many Requests|rate limit/i,
    translation: {
      userMessage: '请求太频繁，请 30 秒后再试',
      techMessage: 'Rate limit exceeded',
      code: 'RATE_LIMITED',
      retryable: true,
      suggestedAction: '请稍等片刻后重试',
    },
  },
  {
    pattern: /500|Internal Server Error/i,
    translation: {
      userMessage: '服务器内部错误，已自动记录日志并通知开发团队',
      techMessage: 'Internal server error',
      code: 'SERVER_ERROR',
      retryable: true,
      suggestedAction: '请稍后重试，如持续出现请联系技术支持',
    },
  },
  {
    pattern: /LLM_TIMEOUT|timeout.*model|model.*timeout/i,
    translation: {
      userMessage: 'AI 思考超时，已尝试切换到更快的模型',
      techMessage: 'LLM request timeout',
      code: 'LLM_TIMEOUT',
      retryable: true,
      suggestedAction: '已自动重试，如仍失败请简化问题',
    },
  },
  {
    pattern: /CircuitBreaker|circuit.*open|open.*circuit/i,
    translation: {
      userMessage: '服务暂时过载，已进入保护模式，请稍后再试',
      techMessage: 'Circuit breaker is open',
      code: 'CIRCUIT_OPEN',
      retryable: true,
      suggestedAction: '请稍等片刻后重试',
    },
  },
  {
    pattern: /API Key|api_key|SILICONFLOW/i,
    translation: {
      userMessage: 'API 密钥配置有误，请检查设置',
      techMessage: 'Invalid or missing API key',
      code: 'API_KEY_ERROR',
      retryable: false,
      suggestedAction: '请在设置中配置正确的 API Key',
    },
  },
  {
    pattern: /Token.*exceed|exceed.*token|context.*length/i,
    translation: {
      userMessage: '对话内容过长，请简化或开启新对话',
      techMessage: 'Token limit exceeded',
      code: 'TOKEN_LIMIT',
      retryable: false,
      suggestedAction: '请简化问题或开启新对话',
    },
  },
  {
    pattern: /database|postgres|connection.*pool/i,
    translation: {
      userMessage: '数据库连接异常，请稍后重试',
      techMessage: 'Database connection error',
      code: 'DATABASE_ERROR',
      retryable: true,
      suggestedAction: '请稍后重试，如持续出现请联系技术支持',
    },
  },
  {
    pattern: /redis|cache/i,
    translation: {
      userMessage: '缓存服务不可用，已降级处理',
      techMessage: 'Redis cache unavailable',
      code: 'CACHE_ERROR',
      retryable: true,
      suggestedAction: '系统已自动降级，可继续操作',
    },
  },
];

const DEFAULT_ERROR: TranslatedError = {
  userMessage: '发生未知错误，请稍后再试',
  techMessage: 'Unknown error occurred',
  code: 'UNKNOWN_ERROR',
  retryable: false,
};

export function translateError(error: unknown): TranslatedError {
  if (error instanceof Error) {
    const errorMessage = error.message;
    const errorName = error.name;
    const fullText = `${errorName}: ${errorMessage}`;

    // Try to match against known patterns
    for (const { pattern, translation } of ERROR_PATTERNS) {
      if (pattern instanceof RegExp) {
        if (pattern.test(errorMessage) || pattern.test(fullText)) {
          return { ...translation, techMessage: errorMessage };
        }
      } else if (
        errorMessage.includes(pattern) ||
        fullText.includes(pattern)
      ) {
        return { ...translation, techMessage: errorMessage };
      }
    }

    // Check common patterns without reference comparison
    if (errorMessage.includes('timeout')) {
      return { ...ERROR_PATTERNS[4].translation, techMessage: errorMessage };
    }
    if (errorMessage.includes('unauthorized') || errorMessage.includes(' authentication')) {
      return { ...ERROR_PATTERNS[2].translation, techMessage: errorMessage };
    }
    if (errorMessage.includes('rate limit')) {
      return { ...ERROR_PATTERNS[3].translation, techMessage: errorMessage };
    }
    if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
      return { ...ERROR_PATTERNS[0].translation, techMessage: errorMessage };
    }
  }

  return DEFAULT_ERROR;
}
