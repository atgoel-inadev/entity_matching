import { SemanticStrategy } from '../semantic.strategy';

/** Creates a deterministic Float32Array of given length with values in [0,1]. */
function makeEmbedding(length: number, seed: number): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = Math.abs(Math.sin(i + seed));
  }
  return arr;
}

describe('SemanticStrategy', () => {
  let strategy: SemanticStrategy;

  beforeEach(() => {
    strategy = new SemanticStrategy();
  });

  it('should have strategyName SEMANTIC', () => {
    expect(strategy.strategyName).toBe('SEMANTIC');
  });

  describe('score()', () => {
    it('returns 1.0 for identical embeddings', () => {
      const embedding = makeEmbedding(768, 42);
      const score = strategy.score('a', 'b', {
        inputEmbedding: embedding,
        candidateEmbedding: embedding,
      });
      expect(score).toBeCloseTo(1.0, 5);
    });

    it('returns 0.0 when context is missing', () => {
      expect(strategy.score('acme', 'acme')).toBe(0.0);
    });

    it('returns 0.0 when inputEmbedding is missing', () => {
      const embedding = makeEmbedding(768, 1);
      expect(strategy.score('a', 'b', { candidateEmbedding: embedding })).toBe(0.0);
    });

    it('returns 0.0 when candidateEmbedding is missing', () => {
      const embedding = makeEmbedding(768, 1);
      expect(strategy.score('a', 'b', { inputEmbedding: embedding })).toBe(0.0);
    });

    it('returns lower score for different embeddings', () => {
      const embA = makeEmbedding(768, 1);
      const embB = makeEmbedding(768, 100);
      const score = strategy.score('a', 'b', {
        inputEmbedding: embA,
        candidateEmbedding: embB,
      });
      expect(score).toBeGreaterThanOrEqual(0.0);
      expect(score).toBeLessThan(1.0);
    });

    it('score is always in [0.0, 1.0]', () => {
      const embA = makeEmbedding(768, 5);
      const embB = makeEmbedding(768, 99);
      const score = strategy.score('x', 'y', {
        inputEmbedding: embA,
        candidateEmbedding: embB,
      });
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
