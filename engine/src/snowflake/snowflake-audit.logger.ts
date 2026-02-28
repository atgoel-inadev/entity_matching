import { Injectable, Logger } from '@nestjs/common';
import type { IAuditLogger } from '../common/ports/audit-logger.port';
import type { ResolutionAuditEvent } from '../common/models/audit.model';
import { SnowflakeService } from './snowflake.service';

/**
 * SnowflakeAuditLogger persists resolution audit events to profile_match_log.
 *
 * IMPORTANT: This logger is fire-and-forget. Callers MUST NOT await logResolution().
 * Audit write failures are logged but never re-thrown — they must not block responses.
 */
@Injectable()
export class SnowflakeAuditLogger implements IAuditLogger {
  private readonly logger = new Logger(SnowflakeAuditLogger.name);

  constructor(private readonly snowflakeService: SnowflakeService) {}

  /**
   * Writes a resolution audit event to the append-only profile_match_log table.
   * Never throws — errors are swallowed and logged to prevent blocking the pipeline.
   *
   * @param event - The audit event to persist.
   */
  async logResolution(event: ResolutionAuditEvent): Promise<void> {
    try {
      await this.snowflakeService.executeQuery(
        `INSERT INTO profile_match_log (
          log_id, profile_id, profile_slug, source_system, correlation_id,
          input_hash, request_payload, salesforce_id, matched_entity_id,
          confidence_score, resolution_scenario, field_scores, candidate_count,
          threshold_used, was_cached, execution_ms, model_version,
          profile_snapshot_ts, entities_snapshot_ts, error_code, error_message, created_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, PARSE_JSON(?), ?, ?,
          ?, ?, PARSE_JSON(?), ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )`,
        [
          event.eventId,
          event.profileId,
          event.profileSlug,
          event.sourceSystem ?? null,
          event.correlationId ?? null,
          event.inputHash,
          JSON.stringify(event.requestPayload ?? event.inputFields),
          event.externalId ?? null,
          event.matchedEntityId ?? null,
          event.matchScore ?? null,
          event.matchType,
          JSON.stringify(event.fieldScores),
          event.candidateCount ?? 0,
          event.thresholdUsed,
          event.wasCached,
          event.executionMs,
          event.modelVersion ?? 'e5-base-v2',
          event.profileSnapshotTs?.toISOString() ?? null,
          event.entitiesSnapshotTs?.toISOString() ?? null,
          event.errorCode ?? null,
          event.errorMessage ?? null,
          event.resolvedAt.toISOString(),
        ],
      );
    } catch (error) {
      // Audit failures must never surface to the caller
      this.logger.error(
        `Failed to write audit event ${event.eventId}`,
        error,
      );
    }
  }
}
