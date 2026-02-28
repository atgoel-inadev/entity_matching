import type { IMatchStrategy, StrategyContext } from '../common/ports/match-strategy.port';
import type { MatchStrategy } from '../common/models/profile.model';

/**
 * NUMERIC matching strategy.
 *
 * Strips all non-digit characters from both values and compares the digit sequences.
 * Score: 1.0 if digit sequences are identical, 0.0 otherwise.
 *
 * Examples where this scores 1.0:
 *   "(800) 555-1234" == "8005551234"
 *   "+1-800-555-1234" == "18005551234"
 *   "36-1234567" == "361234567" (EIN/tax ID)
 *
 * Suitable for: phone numbers, EINs, SSNs, ZIP codes, account numbers.
 */
export class NumericStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'NUMERIC';

  /**
   * Returns 1.0 if digit sequences are equal, 0.0 otherwise.
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
   * Strips all characters except digits (0-9).
   */
  normalize(value: string): string {
    return value.replace(/\D/g, '');
  }

  /** NUMERIC strategy does not require pre-fetched embeddings. */
  requiresEmbedding(): boolean {
    return false;
  }

  /** NUMERIC strategy's score() is synchronous. */
  isAsync(): boolean {
    return false;
  }
}
