import { Injectable } from '@nestjs/common';
import type { Profile } from '../../common/models/profile.model';
import type { FieldScore, CandidateScore } from '../../common/models/resolution.model';
import type { Entity } from '../../common/models/entity.model';

/**
 * ScoreAggregator computes the composite score for a candidate entity.
 *
 * Composite score formula:
 *   compositeScore = SUM(rawScore_i × weight_i) / SUM(weight_i for provided fields)
 *
 * Key design: only fields present in the input count toward the denominator.
 * This ensures partial input still produces meaningful, normalised scores.
 * Example: a 3-field profile where only 2 fields are provided still normalises to [0, 1].
 */
@Injectable()
export class ScoreAggregator {
  /**
   * Aggregates per-field scores into a composite score for a candidate entity.
   * Also populates normalizedWeight and weightedContribution on each FieldScore.
   *
   * @param candidate - The candidate entity being scored.
   * @param rawFieldScores - Per-field scores from ScoringEngine.
   * @param _profile - Profile context (reserved for future weighting adjustments).
   * @returns A complete CandidateScore with composite score and annotated field scores.
   */
  aggregate(
    candidate: Entity,
    rawFieldScores: FieldScore[],
    _profile: Profile,
  ): CandidateScore {
    if (rawFieldScores.length === 0) {
      return this.buildZeroScore(candidate);
    }

    const totalActiveWeight = rawFieldScores.reduce(
      (sum, fs) => sum + fs.weight,
      0,
    );

    if (totalActiveWeight === 0) {
      return this.buildZeroScore(candidate);
    }

    const annotatedScores = rawFieldScores.map((fs) => {
      const normalizedWeight = fs.weight / totalActiveWeight;
      return {
        ...fs,
        normalizedWeight,
        weightedContribution: fs.rawScore * normalizedWeight,
      };
    });

    const compositeScore = annotatedScores.reduce(
      (sum, fs) => sum + fs.weightedContribution,
      0,
    );

    return {
      entityId: candidate.entityId,
      displayName: candidate.displayName,
      fieldValues: candidate.fieldValues,
      compositeScore: Math.min(1.0, Math.max(0.0, compositeScore)),
      fieldScores: annotatedScores,
      matchType: 'COMPOSITE', // Overwritten by MatchClassifier
      totalActiveWeight,
      fieldsEvaluated: rawFieldScores.length,
    };
  }

  private buildZeroScore(candidate: Entity): CandidateScore {
    return {
      entityId: candidate.entityId,
      displayName: candidate.displayName,
      fieldValues: candidate.fieldValues,
      compositeScore: 0.0,
      fieldScores: [],
      matchType: 'NEW_ENTITY',
      totalActiveWeight: 0,
      fieldsEvaluated: 0,
    };
  }
}
