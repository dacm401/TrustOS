import { describe, it, expect } from 'vitest';
import { translateError, TranslatedError } from '../../src/services/error-translator.js';

describe('translateError', () => {
  describe('network errors', () => {
    it('should translate ETIMEDOUT', () => {
      const error = new Error('ETIMEDOUT');
      const result = translateError(error);
      
      expect(result.code).toBe('NETWORK_TIMEOUT');
      expect(result.userMessage).toContain('网络连接超时');
      expect(result.retryable).toBe(true);
    });

    it('should translate ECONNREFUSED', () => {
      const error = new Error('ECONNREFUSED');
      const result = translateError(error);
      
      expect(result.code).toBe('CONNECTION_REFUSED');
      expect(result.userMessage).toContain('服务器已断开');
      expect(result.retryable).toBe(true);
    });
  });

  describe('HTTP errors', () => {
    it('should translate 401 error', () => {
      const error = new Error('401 Unauthorized');
      const result = translateError(error);
      
      expect(result.code).toBe('AUTH_REQUIRED');
      expect(result.userMessage).toContain('登录已过期');
      expect(result.retryable).toBe(false);
    });

    it('should translate 429 rate limit', () => {
      const error = new Error('429 Too Many Requests');
      const result = translateError(error);
      
      expect(result.code).toBe('RATE_LIMITED');
      expect(result.userMessage).toContain('请求太频繁');
      expect(result.retryable).toBe(true);
    });

    it('should translate 500 server error', () => {
      const error = new Error('500 Internal Server Error');
      const result = translateError(error);
      
      expect(result.code).toBe('SERVER_ERROR');
      expect(result.userMessage).toContain('服务器内部错误');
      expect(result.retryable).toBe(true);
    });
  });

  describe('LLM errors', () => {
    it('should translate LLM timeout', () => {
      const error = new Error('LLM_TIMEOUT: request timeout');
      const result = translateError(error);
      
      expect(result.code).toBe('LLM_TIMEOUT');
      expect(result.userMessage).toContain('AI 思考超时');
      expect(result.retryable).toBe(true);
    });

    it('should translate circuit breaker open', () => {
      const error = new Error('Circuit breaker is open');
      const result = translateError(error);
      
      expect(result.code).toBe('CIRCUIT_OPEN');
      expect(result.userMessage).toContain('服务暂时过载');
      expect(result.retryable).toBe(true);
    });
  });

  describe('API errors', () => {
    it('should translate API key error', () => {
      const error = new Error('API Key is missing');
      const result = translateError(error);
      
      expect(result.code).toBe('API_KEY_ERROR');
      expect(result.userMessage).toContain('API 密钥');
      expect(result.retryable).toBe(false);
    });

    it('should translate token limit error', () => {
      const error = new Error('Token limit exceeded');
      const result = translateError(error);
      
      expect(result.code).toBe('TOKEN_LIMIT');
      expect(result.userMessage).toContain('对话内容过长');
      expect(result.retryable).toBe(false);
    });
  });

  describe('unknown errors', () => {
    it('should return default error for unknown errors', () => {
      const error = new Error('Some random error');
      const result = translateError(error);
      
      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.userMessage).toContain('发生未知错误');
      expect(result.retryable).toBe(false);
    });

    it('should handle non-Error objects', () => {
      const error = 'string error';
      const result = translateError(error);
      
      expect(result.code).toBe('UNKNOWN_ERROR');
    });

    it('should handle null/undefined', () => {
      const result1 = translateError(null);
      const result2 = translateError(undefined);
      
      expect(result1.code).toBe('UNKNOWN_ERROR');
      expect(result2.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('error pattern matching', () => {
    it('should match timeout pattern in error message', () => {
      const error = new Error('timeout error occurred');
      const result = translateError(error);
      
      // timeout 关键词会匹配到 LLM_TIMEOUT
      expect(result.retryable).toBe(true);
    });

    it('should match unauthorized in error message', () => {
      const error = new Error('authentication failed: unauthorized');
      const result = translateError(error);
      
      expect(result.code).toBe('AUTH_REQUIRED');
    });

    it('should match rate limit in error message', () => {
      const error = new Error('rate limit exceeded');
      const result = translateError(error);
      
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('should match network/fetch in error message', () => {
      const error = new Error('fetch failed: network error');
      const result = translateError(error);
      
      expect(result.code).toBe('NETWORK_TIMEOUT');
    });
  });
});
