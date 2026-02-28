/**
 * Resolution engine constants.
 * All numeric and string literals used in the pipeline are defined here.
 * Never use inline magic numbers — import from this file.
 */
export const RESOLUTION_CONSTANTS = {
  /** EXACT fields with weight >= this value trigger fast-path SQL lookup. */
  FAST_PATH_MIN_WEIGHT: 3.0,

  /** Default maximum number of ANN candidates to retrieve from Snowflake. */
  DEFAULT_CANDIDATE_TOP_K: 50,

  /** Maximum candidates for non-semantic profiles (no ANN available). */
  DEFAULT_NON_SEMANTIC_CANDIDATE_LIMIT: 200,

  /** Minimum cosine similarity for ANN candidate retrieval. */
  DEFAULT_SEMANTIC_MIN_SIMILARITY: 0.4,

  /** Default composite score threshold for a match. */
  DEFAULT_THRESHOLD: 0.65,

  /** Maximum entities in a single batch resolve request. */
  MAX_BATCH_SIZE: 50,

  /** Maximum entities in a single bulk-load request. */
  MAX_BULK_LOAD_SIZE: 1000,

  /** Embedding model used by Snowflake Cortex. */
  EMBEDDING_MODEL_VERSION: 'e5-base-v2',

  /** Embedding vector dimensions (e5-base-v2). */
  EMBEDDING_DIMENSIONS: 768,

  /** Redis/LRU cache key prefix for resolution results. */
  CACHE_KEY_PREFIX: 'riq:resolve',

  /** Redis/LRU cache key prefix for profile configurations. */
  PROFILE_CACHE_KEY_PREFIX: 'riq:profile',

  /** Default cache TTL for resolution results (seconds). */
  DEFAULT_CACHE_TTL_SECONDS: 3600,

  /** Default cache TTL for profile configurations (seconds). */
  PROFILE_CACHE_TTL_SECONDS: 60,

  /** Score at which a field is considered a perfect (EXACT) match. */
  PERFECT_SCORE: 1.0,

  /** Minimum score for a field to be considered a significant EXACT signal. */
  EXACT_SIGNAL_THRESHOLD: 0.99,

  /** Score threshold for HYBRID_HIGH classification. */
  HYBRID_HIGH_THRESHOLD: 0.9,

  /** Blend ratio for HYBRID strategy (semantic weight). */
  HYBRID_SEMANTIC_WEIGHT: 0.6,

  /** Blend ratio for HYBRID strategy (fuzzy weight). */
  HYBRID_FUZZY_WEIGHT: 0.4,
} as const;
