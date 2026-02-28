import type { ResolutionAuditEvent } from '../models/audit.model';

/**
 * Port interface for writing resolution audit events.
 * The adapter (SnowflakeAuditLogger) writes to profile_match_log.
 *
 * Implementations must be fire-and-forget safe — errors must be logged
 * but never re-thrown to the caller. Audit logging must never block
 * the resolution response.
 */
export interface IAuditLogger {
  /**
   * Writes a resolution audit event asynchronously.
   * Callers must NOT await this in the hot path — use void or fire-and-forget.
   * @param event - The immutable audit record to persist.
   */
  logResolution(event: ResolutionAuditEvent): Promise<void>;
}
