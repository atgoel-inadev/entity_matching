/**
 * Domain error hierarchy for ResolveIQ.
 * Each error maps to a specific HTTP status code in the GlobalExceptionFilter.
 * Using typed errors (instead of string messages) enables:
 *  - Precise HTTP status mapping
 *  - Structured error logging
 *  - Type-safe error handling in tests
 */

/** Base class for all ResolveIQ domain errors. */
export class AppError extends Error {
  /** Machine-readable error code (e.g., "PROFILE_NOT_FOUND"). */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = this.constructor.name;
    // Restore prototype chain (required for extends Error in TS/Node)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a profile slug does not exist or is inactive. Maps to HTTP 404. */
export class ProfileNotFoundError extends AppError {
  constructor(slug: string) {
    super('PROFILE_NOT_FOUND', `Profile '${slug}' not found or inactive`);
  }
}

/** Thrown when an entity ID does not exist or is inactive. Maps to HTTP 404. */
export class EntityNotFoundError extends AppError {
  constructor(entityId: string) {
    super('ENTITY_NOT_FOUND', `Entity '${entityId}' not found or inactive`);
  }
}

/** Thrown when a field name does not exist on a profile. Maps to HTTP 400. */
export class FieldNotFoundError extends AppError {
  constructor(fieldName: string, profileSlug: string) {
    super(
      'FIELD_NOT_FOUND',
      `Field '${fieldName}' not found on profile '${profileSlug}'`,
    );
  }
}

/** Thrown when resolution fails due to an internal pipeline error. Maps to HTTP 422. */
export class ResolutionError extends AppError {
  constructor(message: string) {
    super('RESOLUTION_ERROR', message);
  }
}

/**
 * Thrown when embedding generation fails (Cortex API unavailable, quota, etc.).
 * Maps to HTTP 502 (Bad Gateway — upstream failure).
 */
export class EmbeddingError extends AppError {
  constructor(message: string) {
    super('EMBEDDING_ERROR', message);
  }
}

/**
 * Thrown when Snowflake is unavailable or returns an unexpected error.
 * Maps to HTTP 503 (Service Unavailable).
 */
export class SnowflakeError extends AppError {
  constructor(message: string, readonly originalError?: unknown) {
    super('SNOWFLAKE_ERROR', message);
  }
}

/** Thrown when Redis is unavailable. Maps to HTTP 503. */
export class CacheError extends AppError {
  constructor(message: string, readonly originalError?: unknown) {
    super('CACHE_ERROR', message);
  }
}

/** Thrown when a request exceeds the batch size limit. Maps to HTTP 400. */
export class BatchSizeExceededError extends AppError {
  constructor(received: number, limit: number) {
    super(
      'BATCH_SIZE_EXCEEDED',
      `Batch size ${received} exceeds maximum of ${limit}`,
    );
  }
}
