import { Injectable } from '@nestjs/common';
import type { CandidateScore, MatchType } from '../../common/models/resolution.model';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';

/**
 * MatchClassifier assigns a human-readable MatchType to the top candidate.
 *
 * Classification rules (evaluated in priority order):
 *  1. EXACT_FASTPATH — result came from FastPathChecker (flagged by isFastPath)
 *  2. EXACT_ALL      — every evaluated field scored 1.0
 *  3. EXACT          — at least one EXACT field scored 1.0
 *  4. HYBRID_HIGH    — composite >= 0.9 with both EXACT and SEMANTIC signals >= 0.9
 *  5. SEMANTIC       — dominant signal (>= 50% contribution) from a SEMANTIC field
 *  6. PHONETIC       — dominant signal from a PHONETIC field
 *  7. FUZZY          — dominant signal from a FUZZY field
 *  8. HYBRID         — dominant signal from a HYBRID field
 *  9. COMPOSITE      — blended result, no single dominant strategy
 * 10. NEW_ENTITY     — no candidate exceeded the threshold
 */
@Injectable()
export class MatchClassifier {
  /**
   * Classifies the match type for the best candidate score.
   *
   * @param topCandidate - The highest-scoring candidate, or null if none.
   * @param threshold - The minimum composite score required for a match.
   * @returns The assigned MatchType.
   */
  classify(
    topCandidate: CandidateScore | null,
    threshold: number,
  ): MatchType {
    if (!topCandidate || topCandidate.compositeScore < threshold) {
      return 'NEW_ENTITY';
    }

    if (topCandidate.isFastPath) {
      return 'EXACT_FASTPATH';
    }

    const fieldScores = topCandidate.fieldScores;

    if (this.allFieldsExact(fieldScores)) {
      return 'EXACT_ALL';
    }

    if (this.hasExactSignal(fieldScores) && this.hasHighSemanticSignal(fieldScores)) {
      return 'HYBRID_HIGH';
    }

    if (this.hasExactSignal(fieldScores)) {
      return 'EXACT';
    }

    const dominantStrategy = this.getDominantStrategy(fieldScores);

    if (dominantStrategy === 'SEMANTIC') return 'SEMANTIC';
    if (dominantStrategy === 'PHONETIC') return 'PHONETIC';
    if (dominantStrategy === 'FUZZY') return 'FUZZY';
    if (dominantStrategy === 'HYBRID') return 'HYBRID';

    return 'COMPOSITE';
  }

  private allFieldsExact(
    fieldScores: ReadonlyArray<CandidateScore['fieldScores'][number]>,
  ): boolean {
    return (
      fieldScores.length > 0 &&
      fieldScores.every((fs) => fs.rawScore >= RESOLUTION_CONSTANTS.EXACT_SIGNAL_THRESHOLD)
    );
  }

  private hasExactSignal(
    fieldScores: ReadonlyArray<CandidateScore['fieldScores'][number]>,
  ): boolean {
    return fieldScores.some(
      (fs) =>
        fs.strategy === 'EXACT' &&
        fs.rawScore >= RESOLUTION_CONSTANTS.EXACT_SIGNAL_THRESHOLD,
    );
  }

  private hasHighSemanticSignal(
    fieldScores: ReadonlyArray<CandidateScore['fieldScores'][number]>,
  ): boolean {
    return fieldScores.some(
      (fs) =>
        (fs.strategy === 'SEMANTIC' || fs.strategy === 'HYBRID') &&
        fs.rawScore >= RESOLUTION_CONSTANTS.HYBRID_HIGH_THRESHOLD,
    );
  }

  /** Returns the strategy with the highest weighted contribution. */
  private getDominantStrategy(
    fieldScores: ReadonlyArray<CandidateScore['fieldScores'][number]>,
  ): string | null {
    if (fieldScores.length === 0) return null;

    let maxContribution = -1;
    let dominantStrategy: string | null = null;

    for (const fs of fieldScores) {
      if (fs.weightedContribution > maxContribution) {
        maxContribution = fs.weightedContribution;
        dominantStrategy = fs.strategy;
      }
    }

    return dominantStrategy;
  }
}
