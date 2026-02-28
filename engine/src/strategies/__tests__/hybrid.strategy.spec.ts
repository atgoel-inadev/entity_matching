import { HybridStrategy } from '../hybrid.strategy';
import { FuzzyStrategy } from '../fuzzy.strategy';
import { SemanticStrategy } from '../semantic.strategy';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';

/** Creates a deterministic Float32Array of given length. */
function makeEmbedding(length: number, seed: number): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = Math.abs(Math.sin(i * seed + 1));
  }
  return arr;
}

describe('HybridStrategy', () => {
  let strategy: HybridStrategy;
  let fuzzyStrategy: FuzzyStrategy;
  let semanticStrategy: SemanticStrategy;

  beforeEach(() => {
    fuzzyStrategy = new FuzzyStrategy();
    semanticStrategy = new SemanticStrategy();
    strategy = new HybridStrategy(fuzzyStrategy, semanticStrategy);
  });

  it('should have strategyName HYBRID', () => {
    expect(strategy.strategyName).toBe('HYBRID');
  });

  describe('score()', () => {
    it('falls back to pure fuzzy when no embeddings provided', () => {
      const input = 'acme corp';
      const candidate = 'acme co';

      const hybridScore = strategy.score(input, candidate) as number;
      const fuzzyScore = fuzzyStrategy.score(input, candidate) as number;

      expect(hybridScore).toBeCloseTo(fuzzyScore, 5);
    });

    it('blends semantic and fuzzy with default weights (0.6 semantic + 0.4 fuzzy)', () => {
      const embedding = makeEmbedding(768, 3);
      const input = 'acme corp';
      const candidate = 'acme co';

      const fuzzyScore = fuzzyStrategy.score(input, candidate) as number;
      const semanticScore = semanticStrategy.score(input, candidate, {
        inputEmbedding: embedding,
        candidateEmbedding: embedding, // same embedding = 1.0 cosine
      }) as number;

      const expectedBlend =
        RESOLUTION_CONSTANTS.HYBRID_SEMANTIC_WEIGHT * semanticScore +
        RESOLUTION_CONSTANTS.HYBRID_FUZZY_WEIGHT * fuzzyScore;

      const actualScore = strategy.score(input, candidate, {
        inputEmbedding: embedding,
        candidateEmbedding: embedding,
      }) as number;

      expect(actualScore).toBeCloseTo(expectedBlend, 5);
    });

    it('respects custom semanticWeight from strategyOptions', () => {
      const embedding = makeEmbedding(768, 3);
      const input = 'acme corp';
      const candidate = 'acme co';

      const fuzzyScore = fuzzyStrategy.score(input, candidate) as number;
      const customSemanticWeight = 0.3;

      const actualScore = strategy.score(input, candidate, {
        inputEmbedding: embedding,
        candidateEmbedding: embedding,
        fieldConfig: {
          fieldName: 'name',
          matchStrategy: 'HYBRID',
          weight: 3.0,
          isRequired: false,
          isPrimaryDisplay: true,
          isFastPath: false,
          fieldOrder: 1,
          strategyOptions: { semanticWeight: customSemanticWeight },
        },
      }) as number;

      // semantic score = 1.0 (same embedding), fuzzy score = known value
      const expected = customSemanticWeight * 1.0 + (1 - customSemanticWeight) * fuzzyScore;
      expect(actualScore).toBeCloseTo(expected, 5);
    });

    it('score is always in [0.0, 1.0]', () => {
      const embA = makeEmbedding(768, 7);
      const embB = makeEmbedding(768, 11);
      const score = strategy.score('hello world', 'hi there', {
        inputEmbedding: embA,
        candidateEmbedding: embB,
      }) as number;

      expect(score).toBeGreaterThanOrEqual(0.0);
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  it('requiresEmbedding returns true', () => {
    expect(strategy.requiresEmbedding()).toBe(true);
  });

  it('isAsync returns false', () => {
    expect(strategy.isAsync()).toBe(false);
  });
});
