import type { IMatchStrategy, StrategyContext } from '../common/ports/match-strategy.port';
import type { MatchStrategy } from '../common/models/profile.model';

/**
 * NONE matching strategy.
 *
 * Always returns a score of 0.0. Used for fields that should be stored
 * as part of the entity record but should NOT contribute to the match score.
 *
 * Example: a "notes" or "description" field that provides context in the UI
 * but should not influence entity resolution.
 *
 * When ScoringEngine encounters a NONE field, it is excluded from the
 * score aggregation entirely (weight not added to denominator).
 */
export class NoneStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'NONE';

  /**
   * Always returns 0.0. NONE fields are not scored.
   */
  score(_input: string, _candidate: string, _context?: StrategyContext): number {
    return 0.0;
  }

  /**
   * No normalization needed for NONE fields.
   */
  normalize(value: string): string {
    return value;
  }

  /** NONE strategy does not require embeddings. */
  requiresEmbedding(): boolean {
    return false;
  }

  /** NONE strategy's score() is synchronous. */
  isAsync(): boolean {
    return false;
  }
}
