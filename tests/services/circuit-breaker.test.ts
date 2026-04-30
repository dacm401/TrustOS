import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError, retryWithBackoff } from '../../src/services/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      halfOpenMaxRequests: 2,
    });
  });

  describe('initial state', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should have zero failure count', () => {
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
    });
  });

  describe('execute', () => {
    it('should return result on success', async () => {
      const result = await breaker.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });

    it('should throw on failure and increment failure count', async () => {
      const error = new Error('test error');
      
      await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow('test error');
      
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(1);
    });

    it('should not call errorHandler on success', async () => {
      const handler = vi.fn();
      
      await breaker.execute(() => Promise.resolve('success'), handler);
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should call errorHandler on failure', async () => {
      const error = new Error('test error');
      const handler = vi.fn();
      
      try {
        await breaker.execute(() => Promise.reject(error), handler);
      } catch (e) {
        // Expected to throw
      }
      
      expect(handler).toHaveBeenCalledWith(error);
    });
  });

  describe('circuit opening', () => {
    it('should open after reaching failure threshold', async () => {
      const error = new Error('test error');
      
      // Fail 3 times (the threshold)
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      }
      
      expect(breaker.getState()).toBe('open');
    });

    it('should throw CircuitBreakerError when open', async () => {
      const error = new Error('test error');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      }
      
      // Try to execute - should throw CircuitBreakerError
      await expect(breaker.execute(() => Promise.resolve('success'))).rejects.toThrow(CircuitBreakerError);
    });
  });

  describe('half-open state', () => {
    it('should have correct initial stats', () => {
      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.nextAttempt).toBeNull();
    });

    it('should track failure time when open', async () => {
      const error = new Error('test error');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      }
      
      expect(breaker.getState()).toBe('open');
      const stats = breaker.getStats();
      expect(stats.lastFailureTime).not.toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      const error = new Error('test error');
      
      // Generate some failures
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(error))).rejects.toThrow();
      }
      
      breaker.reset();
      
      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
    });
  });

  describe('forceOpen/forceClose', () => {
    it('should force open the circuit', () => {
      breaker.forceOpen();
      expect(breaker.getState()).toBe('open');
    });

    it('should force close the circuit', () => {
      breaker.forceOpen();
      breaker.forceClose();
      expect(breaker.getState()).toBe('closed');
    });
  });
});

describe('retryWithBackoff', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    
    const result = await retryWithBackoff(fn, { maxRetries: 0 }); // No retries
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure up to max retries', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    
    const result = await retryWithBackoff(fn, { 
      maxRetries: 3,
      initialDelay: 10, // Shorter delay for tests
      maxDelay: 100,
    });
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10000);

  it('should throw after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    
    await expect(
      retryWithBackoff(fn, { 
        maxRetries: 2,
        initialDelay: 10,
        maxDelay: 100,
      })
    ).rejects.toThrow('always fails');
    
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  }, 10000);

  it('should call onRetry callback on each retry', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValue('success');
    
    const onRetry = vi.fn();
    
    await retryWithBackoff(fn, { 
      maxRetries: 3, 
      initialDelay: 10,
      maxDelay: 100,
      onRetry 
    });
    
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  }, 10000);
});
