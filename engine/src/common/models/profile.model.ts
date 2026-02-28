/**
 * Domain models for resolution profiles and field configuration.
 * These interfaces represent the pure business domain — no framework dependencies.
 */

/** All supported field matching strategies. */
export type MatchStrategy =
  | 'EXACT'
  | 'FUZZY'
  | 'SEMANTIC'
  | 'PHONETIC'
  | 'NUMERIC'
  | 'HYBRID'
  | 'NONE';

/**
 * Normalizer options that pre-process field values before matching.
 * Applied consistently to both input and candidate values.
 */
export interface NormalizerOptions {
  readonly lowercase?: boolean;
  readonly stripPunctuation?: boolean;
  readonly digitsOnly?: boolean;
  readonly trimWhitespace?: boolean;
}

/**
 * Configuration for a single field within a resolution profile.
 * Defines how that field is matched and how much it contributes to the composite score.
 */
export interface FieldConfig {
  readonly fieldName: string;
  readonly matchStrategy: MatchStrategy;
  /** Relative importance (0.0–10.0). Higher = more influence on composite score. */
  readonly weight: number;
  readonly isRequired: boolean;
  readonly isPrimaryDisplay: boolean;
  /** Auto-derived: true when strategy is EXACT and weight >= FAST_PATH_MIN_WEIGHT. */
  readonly isFastPath: boolean;
  /** Controls display order in UI and field score output. */
  readonly fieldOrder: number;
  readonly normalizerOptions?: NormalizerOptions;
  /** Strategy-specific parameters (e.g., semantic blend ratios for HYBRID). */
  readonly strategyOptions?: Record<string, unknown>;
}

/**
 * A resolution profile defines which entity type is being matched and
 * how each field is compared. Zero code changes needed for new entity types —
 * just create a new profile.
 */
export interface Profile {
  readonly id: string;
  /** URL-safe identifier used in API paths: e.g., "supplier-dedup". */
  readonly slug: string;
  readonly name: string;
  /** Human-readable entity type: e.g., "Supplier", "Buyer", "Person". */
  readonly entityType: string;
  /** Default composite score threshold for a match (0.0–1.0). */
  readonly defaultThreshold: number;
  readonly fields: ReadonlyArray<FieldConfig>;
  /** Names of EXACT fields with weight >= FAST_PATH_MIN_WEIGHT. Populated on load. */
  readonly fastPathFields: ReadonlyArray<string>;
  /** Names of fields requiring embedding generation (SEMANTIC or HYBRID). */
  readonly semanticFields: ReadonlyArray<string>;
  readonly isActive: boolean;
  /** External system this profile is linked to (e.g., "Salesforce"). */
  readonly sourceSystem?: string;
  /** Field name that maps to the external system's ID. */
  readonly externalIdField?: string;
  /**
   * When false, NEW_ENTITY results route to the external system workflow instead of
   * creating entities directly. Always false for Salesforce-backed profiles.
   */
  readonly allowAuthoritativeCreate: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Total number of entities associated with this profile. */
  readonly entityCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Input for creating a new profile. */
export interface CreateProfileInput {
  readonly slug: string;
  readonly name: string;
  readonly entityType: string;
  readonly defaultThreshold: number;
  readonly fields?: FieldConfig[];
  readonly sourceSystem?: string;
  readonly externalIdField?: string;
  readonly allowAuthoritativeCreate?: boolean;
  readonly metadata?: Record<string, unknown>;
}

/** Input for partially updating an existing profile. */
export interface UpdateProfileInput {
  readonly name?: string;
  readonly defaultThreshold?: number;
  readonly isActive?: boolean;
  readonly allowAuthoritativeCreate?: boolean;
  readonly metadata?: Record<string, unknown>;
}
