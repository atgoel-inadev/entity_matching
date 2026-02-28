import { FuzzyStrategy } from '../fuzzy.strategy';

describe('FuzzyStrategy', () => {
  let strategy: FuzzyStrategy;

  beforeEach(() => {
    strategy = new FuzzyStrategy();
  });

  it('should have strategyName FUZZY', () => {
    expect(strategy.strategyName).toBe('FUZZY');
  });

  describe('score()', () => {
    it('returns 1.0 for identical strings', () => {
      expect(strategy.score('acme corp', 'acme corp')).toBe(1.0);
    });

    it('returns 1.0 for identical strings after normalization', () => {
      expect(strategy.score('Acme Corp', 'acme corp')).toBe(1.0);
    });

    it('returns 0.0 for completely different strings', () => {
      const score = strategy.score('abc', 'xyz');
      expect(score).toBe(0.0);
    });

    it('returns high score for one-character difference', () => {
      // "jon" vs "john" — distance 1, max length 4 → 1 - 1/4 = 0.75
      const score = strategy.score('jon', 'john');
      expect(score).toBeCloseTo(0.75, 2);
    });

    it('returns high score for company name with typo', () => {
      // "Acme Corp" vs "Acme Crp" — distance 1, max 9 → 1 - 1/9 ≈ 0.89
      const score = strategy.score('Acme Corp', 'Acme Crp');
      expect(score).toBeGreaterThan(0.85);
    });

    it('returns moderate score for abbreviated vs full name', () => {
      const score = strategy.score('IBM', 'International Business Machines');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.5);
    });

    it('returns 1.0 for both empty strings', () => {
      expect(strategy.score('', '')).toBe(1.0);
    });

    it('returns 0.0 when one string is empty', () => {
      expect(strategy.score('', 'acme')).toBe(0.0);
      expect(strategy.score('acme', '')).toBe(0.0);
    });

    it('score is always in [0.0, 1.0]', () => {
      const pairs = [
        ['hello', 'world'],
        ['a', 'abcdefghij'],
        ['abc', 'abc'],
        ['', 'test'],
      ];

      for (const [a, b] of pairs) {
        const score = strategy.score(a, b) as number;
        expect(score).toBeGreaterThanOrEqual(0.0);
        expect(score).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('normalize()', () => {
    it('lowercases and trims', () => {
      expect(strategy.normalize('  ACME  ')).toBe('acme');
    });
  });

  it('requiresEmbedding returns false', () => {
    expect(strategy.requiresEmbedding()).toBe(false);
  });

  it('isAsync returns false', () => {
    expect(strategy.isAsync()).toBe(false);
  });
});
