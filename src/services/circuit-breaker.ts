export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  halfOpenMaxRequests?: number;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private nextAttempt: number | null = null;
  private halfOpenRequests = 0;

  constructor(private config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 2,
      timeout: config.timeout ?? 30000,
      halfOpenMaxRequests: config.halfOpenMaxRequests ?? 3,
    };
  }

  async execute<T>(
    fn: () => Promise<T>,
    errorHandler?: (error: Error) => void | Promise<void>
  ): Promise<T> {
    if (!this.canExecute()) {
      const retryAfter = this.nextAttempt ? Math.ceil((this.nextAttempt - Date.now()) / 1000) : undefined;
      throw new CircuitBreakerError(
        `Circuit breaker is ${this.state}`,
        this.state,
        retryAfter
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onFailure(error);
      
      if (errorHandler) {
        await errorHandler(error);
      }
      
      throw err;
    }
  }

  private canExecute(): boolean {
      if (this.state === 'closed') {
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= (this.config.failureThreshold ?? 5)) {
        this.state = 'open';
        console.warn(
          `🔴 Circuit Breaker OPENED after ${this.failureCount} failures`,
          'Last error details logged separately'
        );
      }
      }

    if (this.state === 'open') {
      if (this.lastFailureTime === null) {
        return true;
      }

      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.timeout!) {
        // Transition to half-open
        this.state = 'half-open';
        this.halfOpenRequests = 0;
        return true;
      }

      this.nextAttempt = this.lastFailureTime + (this.config.timeout ?? 30000);
      return false;
    }

    // half-open
    const maxRequests = this.config.halfOpenMaxRequests ?? 3;
    return this.halfOpenRequests < maxRequests;
  }

  private onSuccess(): void {
    this.successCount++;

    if (this.state === 'half-open') {
      this.halfOpenRequests++;
      
      if (this.successCount >= this.config.successThreshold!) {
        // Close the circuit
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenRequests = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;
      }
    } else if (this.state === 'closed') {
      // Reset failure count on consecutive successes
      if (this.failureCount > 0) {
        this.failureCount = Math.max(0, this.failureCount - 1);
      }
    }
  }

  private onFailure(error: Error): void {
    this.failureCount++;

    if (this.state === 'half-open') {
      // Immediately open on any failure in half-open state
      this.state = 'open';
      this.lastFailureTime = Date.now();
      this.successCount = 0;
      this.halfOpenRequests = 0;
    } else if (this.state === 'closed') {
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.config.failureThreshold!) {
        this.state = 'open';
        console.warn(
          `🔴 Circuit Breaker OPENED after ${this.failureCount} failures`,
          error.message
        );
      }
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number | null;
    nextAttempt: number | null;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
    this.halfOpenRequests = 0;
  }

  forceOpen(): void {
    this.state = 'open';
    this.lastFailureTime = Date.now();
    this.successCount = 0;
    this.halfOpenRequests = 0;
  }

  forceClose(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
    this.halfOpenRequests = 0;
  }
}

// Retry with exponential backoff
export interface RetryConfig {
  maxRetries: number;
  initialDelay?: number;
  maxDelay?: number;
  multiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 8000,
  multiplier: 2,
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === retryConfig.maxRetries) {
        break;
      }

      const delay = Math.min(
        retryConfig.initialDelay! * Math.pow(retryConfig.multiplier!, attempt),
        retryConfig.maxDelay!
      );

      console.warn(
        `⚠️  Retry attempt ${attempt + 1}/${retryConfig.maxRetries} after ${delay}ms`,
        lastError.message
      );

      if (retryConfig.onRetry) {
        retryConfig.onRetry(attempt + 1, lastError);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Pre-configured circuit breakers for different services
export const circuitBreakers = {
  llm: new CircuitBreaker({
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000, // 30 seconds
    halfOpenMaxRequests: 2,
  }),
  
  database: new CircuitBreaker({
    failureThreshold: 3,
    successThreshold: 1,
    timeout: 10000, // 10 seconds
    halfOpenMaxRequests: 1,
  }),
  
  redis: new CircuitBreaker({
    failureThreshold: 3,
    successThreshold: 1,
    timeout: 5000, // 5 seconds
    halfOpenMaxRequests: 1,
  }),
};
