import { DoubleMetaphone, SoundEx } from 'natural';
import type { IMatchStrategy, StrategyContext } from '../common/ports/match-strategy.port';
import type { MatchStrategy } from '../common/models/profile.model';

/** Scoring tiers for phonetic matching. */
const PHONETIC_SCORES = {
  DOUBLE_METAPHONE_PRIMARY: 1.0,
  SOUNDEX_MATCH: 0.9,
  DOUBLE_METAPHONE_CROSS: 0.7,
  NO_MATCH: 0.0,
} as const;

/**
 * PHONETIC matching strategy.
 *
 * Scoring logic (descending priority):
 *  1.0 — DoubleMetaphone primary codes match (Jon == John)
 *  0.9 — SoundEx codes match (fallback for single-consonant names)
 *  0.7 — DoubleMetaphone primary matches the other's secondary (Smith ≈ Smythe)
 *  0.0 — No phonetic similarity detected
 *
 * Suitable for: first names, last names, person names with spelling variants.
 * Not recommended for company names (use FUZZY or SEMANTIC instead).
 */
export class PhoneticStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'PHONETIC';

  /**
   * Computes phonetic similarity between two strings.
   */
  score(input: string, candidate: string, _context?: StrategyContext): number {
    const normalizedInput = this.normalize(input);
    const normalizedCandidate = this.normalize(candidate);

    if (normalizedInput.length === 0 || normalizedCandidate.length === 0) {
      return 0.0;
    }

    return this.computePhoneticScore(normalizedInput, normalizedCandidate);
  }

  private computePhoneticScore(a: string, b: string): number {
    const [dma1, dma2] = DoubleMetaphone.process(a);
    const [dmb1, dmb2] = DoubleMetaphone.process(b);

    if (dma1 && dmb1 && dma1 === dmb1) {
      return PHONETIC_SCORES.DOUBLE_METAPHONE_PRIMARY;
    }

    if (SoundEx.process(a) === SoundEx.process(b)) {
      return PHONETIC_SCORES.SOUNDEX_MATCH;
    }

    if (
      (dma1 && dmb2 && dma1 === dmb2) ||
      (dma2 && dmb1 && dma2 === dmb1)
    ) {
      return PHONETIC_SCORES.DOUBLE_METAPHONE_CROSS;
    }

    return PHONETIC_SCORES.NO_MATCH;
  }

  /**
   * Trims whitespace and lowercases. DoubleMetaphone handles further normalization.
   */
  normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  /** PHONETIC strategy does not require pre-fetched embeddings. */
  requiresEmbedding(): boolean {
    return false;
  }

  /** PHONETIC strategy's score() is synchronous. */
  isAsync(): boolean {
    return false;
  }
}
