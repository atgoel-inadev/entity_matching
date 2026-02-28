import { distance } from 'fastest-levenshtein';
import type { IMatchStrategy, StrategyContext } from '../common/ports/match-strategy.port';
import type { MatchStrategy } from '../common/models/profile.model';

/**
 * FUZZY matching strategy using Levenshtein edit distance.
 *
 * Score formula: 1 - (editDistance / max(len_a, len_b))
 * - Score 1.0 = identical strings
 * - Score 0.0 = completely different (or distance > max length)
 *
 * Uses `fastest-levenshtein` (native addon via V8 JIT) for ~10x faster
 * computation vs pure CPython — critical for scoring 50 candidates × N fields.
 *
 * Suitable for: company names, addresses, person names with typos.
 */
export class FuzzyStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'FUZZY';

  /**
   * Computes normalized Levenshtein similarity between two strings.
   * @param input - The incoming field value.
   * @param candidate - The stored field value.
   * @returns Score in [0.0, 1.0].
   */
  score(input: string, candidate: string, _context?: StrategyContext): number {
    const normalizedInput = this.normalize(input);
    const normalizedCandidate = this.normalize(candidate);

    if (normalizedInput.length === 0 && normalizedCandidate.length === 0) {
      return 1.0;
    }

    if (normalizedInput.length === 0 || normalizedCandidate.length === 0) {
      return 0.0;
    }

    const maxLength = Math.max(normalizedInput.length, normalizedCandidate.length);
    const editDistance = distance(normalizedInput, normalizedCandidate);

    return Math.max(0, 1 - editDistance / maxLength);
  }

  /**
   * Normalizes by trimming whitespace and converting to lowercase.
   */
  normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  /** FUZZY strategy does not require pre-fetched embeddings. */
  requiresEmbedding(): boolean {
    return false;
  }

  /** FUZZY strategy's score() is synchronous. */
  isAsync(): boolean {
    return false;
  }
}
