/**
 * Error message translation utilities
 * Converts technical error messages to user-friendly messages
 */

interface TranslatedError {
  userMessage: string;
  techMessage: string;
  code: string;
  retryable: boolean;
  suggestedAction?: string;
}

const ERROR_MESSAGES: Record<string, TranslatedError> = {
  // Network errors
  'ETIMEDOUT': {
    userMessage: '网络连接超时，请检查网络设置后重试',
    techMessage: 'Connection timed out',
    code: 'NETWORK_TIMEOUT',
    retryable: true,
    suggestedAction: '请检查网络连接或稍后再试',
  },
  'ECONNREFUSED': {
    userMessage: '服务器已断开连接，请刷新页面重试',
    techMessage: 'Connection refused',
    code: 'CONNECTION_REFUSED',
    retryable: true,
    suggestedAction: '请刷新页面或联系技术支持',
  },
  
  // HTTP errors
  '401': {
    userMessage: '登录已过期，请重新登录',
    techMessage: 'Unauthorized access',
    code: 'AUTH_REQUIRED',
    retryable: false,
    suggestedAction: '请重新登录',
  },
  '403': {
    userMessage: '无权访问此资源',
    techMessage: 'Forbidden',
    code: 'FORBIDDEN',
    retryable: false,
  },
  '404': {
    userMessage: '请求的资源不存在',
    techMessage: 'Not found',
    code: 'NOT_FOUND',
    retryable: false,
  },
  '429': {
    userMessage: '请求太频繁，请 30 秒后再试',
    techMessage: 'Rate limit exceeded',
    code: 'RATE_LIMITED',
    retryable: true,
    suggestedAction: '请稍等片刻后重试',
  },
  '500': {
    userMessage: '服务器内部错误，已自动记录日志并通知开发团队',
    techMessage: 'Internal server error',
    code: 'SERVER_ERROR',
    retryable: true,
    suggestedAction: '请稍后重试，如持续出现请联系技术支持',
  },
  '503': {
    userMessage: '服务暂时维护中，请稍后再试',
    techMessage: 'Service temporarily unavailable',
    code: 'SERVICE_UNAVAILABLE',
    retryable: true,
    suggestedAction: '请耐心等待服务恢复',
  },
  '504': {
    userMessage: '请求响应超时，请重试',
    techMessage: 'Gateway timeout',
    code: 'GATEWAY_TIMEOUT',
    retryable: true,
    suggestedAction: '请重试请求',
  },
  
  // LLM errors
  'LLM_TIMEOUT': {
    userMessage: 'AI 思考超时，已尝试切换到更快的模型',
    techMessage: 'LLM request timeout',
    code: 'LLM_TIMEOUT',
    retryable: true,
    suggestedAction: '已自动重试，如仍失败请简化问题',
  },
  'DELEGATION_FAILED': {
    userMessage: '任务执行失败，可以重新提交或查看错误详情',
    techMessage: 'Task delegation failed',
    code: 'DELEGATION_FAILED',
    retryable: true,
    suggestedAction: '查看详细错误信息或重新提交任务',
  },
  'CIRCUIT_OPEN': {
    userMessage: '服务暂时过载，已进入保护模式，请稍后再试',
    techMessage: 'Circuit breaker is open',
    code: 'CIRCUIT_OPEN',
    retryable: true,
    suggestedAction: '请稍等片刻后重试',
  },
  
  // API errors
  'API_KEY_ERROR': {
    userMessage: 'API 密钥配置有误，请检查设置',
    techMessage: 'Invalid or missing API key',
    code: 'API_KEY_ERROR',
    retryable: false,
    suggestedAction: '请在设置中配置正确的 API Key',
  },
  'TOKEN_LIMIT': {
    userMessage: '对话内容过长，请简化或开启新对话',
    techMessage: 'Token limit exceeded',
    code: 'TOKEN_LIMIT',
    retryable: false,
    suggestedAction: '请简化问题或开启新对话',
  },
  
  // Database errors
  'DATABASE_ERROR': {
    userMessage: '数据库连接异常，请稍后重试',
    techMessage: 'Database connection error',
    code: 'DATABASE_ERROR',
    retryable: true,
    suggestedAction: '请稍后重试，如持续出现请联系技术支持',
  },
  
  // Cache errors
  'CACHE_ERROR': {
    userMessage: '缓存服务不可用，已降级处理',
    techMessage: 'Redis cache unavailable',
    code: 'CACHE_ERROR',
    retryable: true,
    suggestedAction: '系统已自动降级，可继续操作',
  },
};

const DEFAULT_ERROR: TranslatedError = {
  userMessage: '发生未知错误，请稍后再试',
  techMessage: 'Unknown error occurred',
  code: 'UNKNOWN_ERROR',
  retryable: false,
};

export function getTranslatedError(error: unknown): TranslatedError {
  if (error instanceof Error) {
    const message = error.message;
    
    // Try exact match first
    if (ERROR_MESSAGES[message]) {
      return { ...ERROR_MESSAGES[message], techMessage: message };
    }
    
    // Pattern matching
    for (const [key, translation] of Object.entries(ERROR_MESSAGES)) {
      if (message.includes(key) || message.toLowerCase().includes(key.toLowerCase())) {
        return { ...translation, techMessage: message };
      }
    }
    
    // Check common patterns
    if (message.includes('timeout')) {
      return { ...ERROR_MESSAGES['LLM_TIMEOUT'], techMessage: message };
    }
    if (message.includes('unauthorized') || message.includes(' authentication')) {
      return { ...ERROR_MESSAGES['401'], techMessage: message };
    }
    if (message.includes('rate limit')) {
      return { ...ERROR_MESSAGES['429'], techMessage: message };
    }
    if (message.includes('fetch') || message.includes('network')) {
      return { ...ERROR_MESSAGES['ETIMEDOUT'], techMessage: message };
    }
  }
  
  return DEFAULT_ERROR;
}

export function getUserFriendlyMessage(error: unknown): string {
  const translated = getTranslatedError(error);
  return translated.userMessage;
}

export function isRetryableError(error: unknown): boolean {
  const translated = getTranslatedError(error);
  return translated.retryable;
}

export function getSuggestedAction(error: unknown): string | undefined {
  const translated = getTranslatedError(error);
  return translated.suggestedAction;
}
