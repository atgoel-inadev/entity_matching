import { Injectable, Logger } from '@nestjs/common';
import { StrategyRegistry } from '../../strategies/strategy.registry';
import type { Profile, MatchStrategy } from '../../common/models/profile.model';
import type { Entity } from '../../common/models/entity.model';
import type { FieldScore } from '../../common/models/resolution.model';
import type { StrategyContext } from '../../common/ports/match-strategy.port';

/**
 * ScoringEngine applies matching strategies to produce per-field scores.
 *
 * For each provided input field that has a corresponding FieldConfig on the profile,
 * ScoringEngine calls the appropriate strategy's score() method and records the result.
 *
 * Key rules:
 * - Fields not present in the input are skipped (not penalised).
 * - NONE strategy fields are skipped (not scored, not counted in weight sum).
 * - Pre-fetched embeddings are passed as context for SEMANTIC/HYBRID fields.
 */
@Injectable()
export class ScoringEngine {
  private readonly logger = new Logger(ScoringEngine.name);

  constructor(private readonly strategyRegistry: StrategyRegistry) {}

  /**
   * Scores a single candidate entity against the input fields.
   *
   * @param candidate - The candidate entity to score.
   * @param profile - The resolution profile containing field configurations.
   * @param inputFields - The input field values from the resolve request.
   * @param inputEmbeddings - Pre-fetched embeddings for semantic fields.
   * @returns Array of per-field scores. Only includes fields that were evaluated.
   */
  async scoreCandidate(
    candidate: Entity,
    profile: Profile,
    inputFields: Record<string, string>,
    inputEmbeddings: Map<string, Float32Array>,
  ): Promise<FieldScore[]> {
    const fieldScores: FieldScore[] = [];

    for (const fieldConfig of profile.fields) {
      const inputValue = inputFields[fieldConfig.fieldName];

      if (!inputValue?.trim() || fieldConfig.matchStrategy === 'NONE') {
        continue;
      }

      const candidateValue = candidate.fieldValues[fieldConfig.fieldName] ?? '';

      const rawScore = await this.computeFieldScore(
        fieldConfig.matchStrategy,
        inputValue,
        candidateValue,
        fieldConfig.fieldName,
        inputEmbeddings,
        fieldConfig,
        candidate,
      );

      fieldScores.push({
        fieldName: fieldConfig.fieldName,
        strategy: fieldConfig.matchStrategy,
        weight: fieldConfig.weight,
        inputValue,
        candidateValue,
        rawScore,
        normalizedWeight: 0, // Populated by ScoreAggregator
        weightedContribution: 0, // Populated by ScoreAggregator
      });
    }

    return fieldScores;
  }

  private async computeFieldScore(
    strategyName: MatchStrategy,
    inputValue: string,
    candidateValue: string,
    fieldName: string,
    inputEmbeddings: Map<string, Float32Array>,
    fieldConfig: Profile['fields'][number],
    candidate: Entity,
  ): Promise<number> {
    const strategy = this.strategyRegistry.get(strategyName);

    const context: StrategyContext = {
      inputEmbedding: inputEmbeddings.get(fieldName),
      fieldConfig,
      // Use pre-computed ANN similarity if available (optimization for SEMANTIC strategy)
      precomputedSimilarity: candidate._scoringMetadata?.[fieldName],
    };

    const normalizedInput = strategy.normalize(inputValue);
    const normalizedCandidate = strategy.normalize(candidateValue);

    if (strategy.isAsync()) {
      return await (strategy.score(normalizedInput, normalizedCandidate, context) as Promise<number>);
    }

    return strategy.score(normalizedInput, normalizedCandidate, context) as number;
  }
}
