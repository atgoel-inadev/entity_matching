import type { MatchStrategy, FieldConfig } from '../models/profile.model';

/**
 * Context passed to a strategy's score() method.
 * Pre-fetched embeddings avoid redundant Snowflake calls during candidate scoring.
 */
export interface StrategyContext {
  /** Pre-fetched embedding for the input value (SemanticStrategy only). */
  readonly inputEmbedding?: Float32Array;
  /** Pre-fetched embedding for the candidate value (SemanticStrategy only). */
  readonly candidateEmbedding?: Float32Array;
  /** Pre-computed similarity from ANN search (SemanticStrategy optimization). */
  readonly precomputedSimilarity?: number;
  /** The full field configuration for strategy-specific options. */
  readonly fieldConfig?: FieldConfig;
}

/**
 * Port interface for all matching strategy implementations.
 *
 * All strategies must be stateless and pure (no side effects, no I/O).
 * Strategy implementations must NOT import NestJS decorators — they are
 * plain TypeScript classes registered via StrategyRegistry.
 */
export interface IMatchStrategy {
  /** Identifies which MatchStrategy enum value this class handles. */
  readonly strategyName: MatchStrategy;

  /**
   * Computes a similarity score between two field values.
   * @param input - The incoming value from the resolve request.
   * @param candidate - The stored value from a candidate entity.
   * @param context - Optional pre-fetched embeddings and field config.
   * @returns A score in the range [0.0, 1.0]. 1.0 = perfect match.
   */
  score(
    input: string,
    candidate: string,
    context?: StrategyContext,
  ): number | Promise<number>;

  /**
   * Normalizes a raw field value before scoring.
   * Applied consistently to both input and candidate values.
   * @param value - The raw string to normalize.
   * @returns The normalized string.
   */
  normalize(value: string): string;

  /**
   * Returns true if this strategy requires pre-fetched embeddings in context.
   * Used by EmbeddingFetcher to decide which fields need Cortex API calls.
   */
  requiresEmbedding(): boolean;

  /**
   * Returns true if this strategy's score() method returns a Promise.
   * Used by ScoringEngine to determine whether to await the result.
   */
  isAsync(): boolean;
}
