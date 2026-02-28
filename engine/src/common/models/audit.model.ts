import type { MatchType, FieldScore } from './resolution.model';

/**
 * Immutable audit record written to profile_match_log for every resolution.
 * Provides full traceability: what was asked, what was matched, and why.
 * This record must be preserved unchanged — do not modify fields post-creation.
 */
export interface ResolutionAuditEvent {
  readonly eventId: string;
  readonly requestId: string;
  /** Cross-system correlation identifier (e.g., Salesforce flow run ID). */
  readonly correlationId?: string;
  readonly profileSlug: string;
  readonly profileId: string;
  readonly sourceSystem?: string;
  /** The raw input fields provided in the resolve request. */
  readonly inputFields: Readonly<Record<string, string>>;
  /** Full request payload (for enhanced tracing). */
  readonly requestPayload?: Readonly<Record<string, unknown>>;
  /** SHA-256 hash of sorted, lowercased input fields for deduplication. */
  readonly inputHash: string;
  readonly matchedEntityId?: string;
  readonly externalId?: string;
  readonly matchScore?: number;
  readonly matchType: MatchType;
  readonly fieldScores: ReadonlyArray<FieldScore>;
  readonly isNewEntity: boolean;
  readonly isAuthoritative: boolean;
  /** Number of candidates evaluated during resolution. */
  readonly candidateCount?: number;
  readonly wasCached: boolean;
  readonly thresholdUsed: number;
  /** Embedding model version used (e.g., "e5-base-v2"). */
  readonly modelVersion: string;
  /** Snapshot timestamp of when the profile config was loaded. */
  readonly profileSnapshotTs: Date;
  /** Snapshot timestamp of last entity sync at resolution time. */
  readonly entitiesSnapshotTs?: Date;
  readonly executionMs: number;
  readonly resolvedAt: Date;
  /** Set only when resolution failed with a handled error. */
  readonly errorCode?: string;
  readonly errorMessage?: string;
}
