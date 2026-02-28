import type { MatchStrategy } from './profile.model';

/**
 * All possible resolution outcomes. Assigned by MatchClassifier
 * based on score signals and field-level analysis.
 */
export type MatchType =
  | 'EXACT_ALL' // Every evaluated field scored 1.0
  | 'EXACT_FASTPATH' // High-weight EXACT field matched via fast-path SQL
  | 'EXACT' // At least one EXACT field scored 1.0
  | 'SEMANTIC' // Dominant match signal from embedding cosine similarity
  | 'PHONETIC' // Dominant match signal from phonetic algorithm
  | 'FUZZY' // Dominant match signal from edit distance
  | 'HYBRID_HIGH' // EXACT + SEMANTIC both >= 0.9
  | 'HYBRID' // HYBRID strategy field was the dominant signal
  | 'COMPOSITE' // Blended result with no single dominant strategy
  | 'NEW_ENTITY'; // No candidate exceeded the threshold

/**
 * An incoming resolution request — the record to match against stored entities.
 */
export interface ResolveRequest {
  readonly requestId: string;
  readonly profileSlug: string;
  /** Input field values to match: { "name": "Acme Corp", "tax_id": "36-..." } */
  readonly fields: Readonly<Record<string, string>>;
  /** Override the profile's default threshold for this request. */
  readonly threshold?: number;
  /** If true and no match found, insert a new entity and return it. */
  readonly createIfMissing?: boolean;
  /** Maximum number of candidates to evaluate (default: DEFAULT_CANDIDATE_TOP_K). */
  readonly maxResults?: number;
  /** Include debug information (pipeline stage timings, all candidate scores). */
  readonly includeDebug?: boolean;
  /** Propagated to audit log for cross-system correlation. */
  readonly correlationId?: string;
  /** Identifies the calling system for audit traceability. */
  readonly sourceSystem?: string;
}

/**
 * Per-field score breakdown for a single candidate entity.
 */
export interface FieldScore {
  readonly fieldName: string;
  readonly strategy: MatchStrategy;
  readonly weight: number;
  readonly inputValue: string;
  readonly candidateValue: string;
  /** Raw similarity score from the matching strategy (0.0–1.0). */
  readonly rawScore: number;
  /** Weight normalized to the sum of active field weights. */
  readonly normalizedWeight: number;
  /** rawScore × normalizedWeight — contribution to composite score. */
  readonly weightedContribution: number;
}

/**
 * Intermediate scoring result for a single candidate entity.
 * Used within the pipeline before the final ResolveResult is constructed.
 */
export interface CandidateScore {
  readonly entityId: string;
  readonly displayName: string;
  readonly fieldValues: Readonly<Record<string, string>>;
  readonly compositeScore: number;
  readonly fieldScores: ReadonlyArray<FieldScore>;
  readonly matchType: MatchType;
  readonly totalActiveWeight: number;
  readonly fieldsEvaluated: number;
  /** Set to true when this result came from the fast-path checker. */
  readonly isFastPath?: boolean;
}

/** Optional debug information for deep inspection. */
export interface ResolutionDebug {
  readonly candidatesEvaluated: number;
  readonly pipelineStageMs: Record<string, number>;
  readonly topCandidates: ReadonlyArray<{
    entityId: string;
    compositeScore: number;
  }>;
}

/**
 * The final resolution result returned to the caller.
 */
export interface ResolveResult {
  readonly requestId: string;
  readonly entityId?: string;
  readonly displayName?: string;
  /** The entity's ID in the linked external system (e.g., Salesforce). */
  readonly externalId?: string;
  readonly matchScore?: number;
  readonly matchType: MatchType;
  readonly fieldScores: ReadonlyArray<FieldScore>;
  readonly isNewEntity: boolean;
  /** True when the entity was created via the authoritative create flow. */
  readonly isAuthoritative: boolean;
  /** True when this result was served from cache. */
  readonly wasCached: boolean;
  readonly executionMs: number;
  readonly resolvedAt: Date;
  readonly debug?: ResolutionDebug;
}

/**
 * Result of a batch resolution request.
 */
export interface BatchResolveResult {
  readonly totalProcessed: number;
  readonly results: ReadonlyArray<ResolveResult>;
  readonly totalExecutionMs: number;
}
