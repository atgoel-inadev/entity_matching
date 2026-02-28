import type { IMatchStrategy, StrategyContext } from '../common/ports/match-strategy.port';
import type { MatchStrategy } from '../common/models/profile.model';

/**
 * EXACT matching strategy.
 *
 * Scores 1.0 when two values are identical after case-folding and whitespace trimming.
 * Scores 0.0 otherwise. No partial credit.
 *
 * Suitable for: tax IDs, email addresses, country codes, SKUs, external system IDs.
 *
 * This is a pure TypeScript class with no framework dependencies.
 * It is registered into StrategyRegistry by StrategiesModule.
 */
export class ExactStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'EXACT';

  /**
   * Returns 1.0 if both values are equal after normalization, 0.0 otherwise.
   * @param input - The incoming field value from the resolve request.
   * @param candidate - The stored field value from a candidate entity.
   */
  score(input: string, candidate: string, _context?: StrategyContext): number {
    const normalizedInput = this.normalize(input);
    const normalizedCandidate = this.normalize(candidate);

    if (normalizedInput.length === 0 || normalizedCandidate.length === 0) {
      return 0.0;
    }

    return normalizedInput === normalizedCandidate ? 1.0 : 0.0;
  }

  /**
   * Normalizes a value by trimming whitespace and converting to lowercase.
   */
  normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  /** EXACT strategy does not require pre-fetched embeddings. */
  requiresEmbedding(): boolean {
    return false;
  }

  /** EXACT strategy's score() is synchronous. */
  isAsync(): boolean {
    return false;
  }
}
