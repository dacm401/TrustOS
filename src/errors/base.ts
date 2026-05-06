/**
 * Unified error hierarchy for TrustOS.
 *
 * All domain errors extend AppError with a string code (e.g. "GUARDRAIL_REJECTED").
 * The code is machine-readable, the message is human-readable.
 * Convert to HTTP-like responses via toResponse().
 *
 * Usage:
 *   import { AppError, GuardrailError } from "./base.js";
 *   throw new GuardrailError("GUARDRAIL_REJECTED", "Request rejected by policy");
 */

/** Base class for all TrustOS errors. */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode = 500,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    // Maintains proper stack trace in V8 environments
    Error.captureStackTrace(this, this.constructor);
  }

  toResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.context && { context: this.context }),
      },
    };
  }
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    context?: Record<string, unknown>;
  };
}

/** Validation errors: invalid input, missing fields, schema violations. */
export class ValidationError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 400, context);
  }
}

/** Guardrail/permission errors: policy rejections, security checks. */
export class GuardrailError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 403, context);
  }
}

/** Model/LLM errors: API failures, parse errors, timeout. */
export class ModelError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 502, context);
  }
}

/** Database/repository errors: query failures, constraint violations. */
export class RepositoryError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 500, context);
  }
}

/** Gated Delegation errors: routing logic failures, protocol violations. */
export class DelegationError extends AppError {
  constructor(code: string, message: string, context?: Record<string, unknown>) {
    super(code, message, 500, context);
  }
}

/**
 * Convert an unknown error to a safe AppError.
 * Preserves known subclasses; wraps unknown errors as generic INTERNAL_ERROR.
 */
export function toAppError(err: unknown, defaultMessage = "Internal server error"): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError("INTERNAL_ERROR", err.message || defaultMessage);
  }
  return new AppError("INTERNAL_ERROR", defaultMessage);
}

/**
 * Wrap an async function, catching errors and converting to AppError.
 * Use as: router.get("/path", withErrorHandler(async (ctx) => { ... }));
 */
export async function withErrorHandler<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toAppError(err);
  }
}
