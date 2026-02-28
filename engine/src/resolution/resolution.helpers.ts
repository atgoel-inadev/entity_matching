import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { ResolveRequest, ResolveResult } from '../common/models/resolution.model';
import type { ResolutionAuditEvent } from '../common/models/audit.model';
import type { Profile } from '../common/models/profile.model';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * Builds a deterministic cache key from profileId + input fields + threshold.
 * The key is based on a SHA-256 hash of sorted, lowercased field entries
 * to ensure identical inputs always produce the same cache key.
 *
 * @param profileId - The profile's primary key.
 * @param fields - The input field values.
 * @param threshold - The threshold used for this request.
 * @returns A string cache key prefixed with CACHE_KEY_PREFIX.
 */
export function buildCacheKey(
  profileId: string,
  fields: Record<string, string>,
  threshold: number,
): string {
  const sortedEntries = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k.toLowerCase()}:${v.toLowerCase().trim()}`)
    .join('|');

  const hash = createHash('sha256')
    .update(`${profileId}|${sortedEntries}|${threshold}`)
    .digest('hex')
    .substring(0, 16);

  return `${RESOLUTION_CONSTANTS.CACHE_KEY_PREFIX}:${profileId}:${hash}`;
}

/**
 * Builds a SHA-256 hash of the input fields for audit deduplication.
 * Used in ResolutionAuditEvent.inputHash.
 */
export function buildInputHash(fields: Record<string, string>): string {
  const sortedEntries = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k.toLowerCase()}:${v.toLowerCase().trim()}`)
    .join('|');

  return createHash('sha256').update(sortedEntries).digest('hex');
}

/**
 * Constructs a ResolutionAuditEvent from the resolution inputs and output.
 *
 * @param request - The original resolve request.
 * @param profile - The profile used for resolution.
 * @param result - The resolution result.
 * @param thresholdUsed - The effective threshold used.
 * @returns An immutable audit event ready for persistence.
 */
export function buildAuditEvent(
  request: ResolveRequest,
  profile: Profile,
  result: ResolveResult,
  thresholdUsed: number,
): ResolutionAuditEvent {
  return {
    eventId: uuidv4(),
    requestId: request.requestId,
    correlationId: request.correlationId,
    profileSlug: profile.slug,
    profileId: profile.id,
    sourceSystem: request.sourceSystem,
    inputFields: request.fields,
    inputHash: buildInputHash(request.fields),
    matchedEntityId: result.entityId,
    externalId: result.externalId,
    matchScore: result.matchScore,
    matchType: result.matchType,
    fieldScores: result.fieldScores as ResolutionAuditEvent['fieldScores'],
    isNewEntity: result.isNewEntity,
    isAuthoritative: result.isAuthoritative,
    wasCached: result.wasCached,
    thresholdUsed,
    profileSnapshotTs: profile.updatedAt,
    modelVersion: RESOLUTION_CONSTANTS.EMBEDDING_MODEL_VERSION,
    executionMs: result.executionMs,
    resolvedAt: result.resolvedAt,
  };
}
