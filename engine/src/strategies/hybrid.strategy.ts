import type { IMatchStrategy, StrategyContext } from '../common/ports/match-strategy.port';
import type { MatchStrategy } from '../common/models/profile.model';
import { FuzzyStrategy } from './fuzzy.strategy';
import { SemanticStrategy } from './semantic.strategy';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * HYBRID matching strategy.
 *
 * Blends FUZZY (edit-distance) and SEMANTIC (embedding cosine) scores.
 * Default blend: 60% SEMANTIC + 40% FUZZY (configurable via fieldConfig.strategyOptions).
 *
 * Uses composition over inheritance — FuzzyStrategy and SemanticStrategy are
 * injected into the constructor rather than extended.
 *
 * Best for: fields where both character similarity and semantic meaning matter,
 * e.g., abbreviated vs. full company names ("IBM" vs. "International Business Machines").
 */
export class HybridStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'HYBRID';

  private readonly fuzzyStrategy: FuzzyStrategy;
  private readonly semanticStrategy: SemanticStrategy;

  /**
   * @param fuzzyStrategy - Injected fuzzy strategy (composition, not inheritance).
   * @param semanticStrategy - Injected semantic strategy (composition, not inheritance).
   */
  constructor(fuzzyStrategy: FuzzyStrategy, semanticStrategy: SemanticStrategy) {
    this.fuzzyStrategy = fuzzyStrategy;
    this.semanticStrategy = semanticStrategy;
  }

  /**
   * Blends fuzzy and semantic scores using configurable weights.
   * If semantic embeddings are not available, falls back to pure fuzzy score.
   */
  score(input: string, candidate: string, context?: StrategyContext): number {
    const semanticWeight = this.resolveSemanticWeight(context);
    const fuzzyWeight = 1 - semanticWeight;

    const fuzzyScore = this.fuzzyStrategy.score(input, candidate, context) as number;

    const hasEmbeddings =
      context?.inputEmbedding && context?.candidateEmbedding;

    if (!hasEmbeddings) {
      return fuzzyScore;
    }

    const semanticScore = this.semanticStrategy.score(input, candidate, context) as number;

    return semanticWeight * semanticScore + fuzzyWeight * fuzzyScore;
  }

  /**
   * Reads the semantic blend weight from strategyOptions, defaulting to 0.6.
   */
  private resolveSemanticWeight(context?: StrategyContext): number {
    const customWeight = context?.fieldConfig?.strategyOptions?.['semanticWeight'];

    if (typeof customWeight === 'number' && customWeight >= 0 && customWeight <= 1) {
      return customWeight;
    }

    return RESOLUTION_CONSTANTS.HYBRID_SEMANTIC_WEIGHT;
  }

  /** Delegates to FuzzyStrategy's normalization. */
  normalize(value: string): string {
    return this.fuzzyStrategy.normalize(value);
  }

  /**
   * HYBRID requires embeddings for the semantic component.
   * When embeddings are absent, falls back to pure fuzzy.
   */
  requiresEmbedding(): boolean {
    return true;
  }

  /** HYBRID strategy's score() is synchronous. */
  isAsync(): boolean {
    return false;
  }
}
