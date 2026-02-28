import { ExactStrategy } from '../exact.strategy';

describe('ExactStrategy', () => {
  let strategy: ExactStrategy;

  beforeEach(() => {
    strategy = new ExactStrategy();
  });

  it('should have strategyName EXACT', () => {
    expect(strategy.strategyName).toBe('EXACT');
  });

  describe('score()', () => {
    it('returns 1.0 for identical strings', () => {
      expect(strategy.score('acme corp', 'acme corp')).toBe(1.0);
    });

    it('returns 1.0 for strings differing only by case', () => {
      expect(strategy.score('Acme Corp', 'acme corp')).toBe(1.0);
      expect(strategy.score('ACME', 'acme')).toBe(1.0);
    });

    it('returns 1.0 for strings differing only by surrounding whitespace', () => {
      expect(strategy.score('  acme  ', 'acme')).toBe(1.0);
      expect(strategy.score('acme', '  acme  ')).toBe(1.0);
    });

    it('returns 0.0 for different strings', () => {
      expect(strategy.score('acme corp', 'ibm corp')).toBe(0.0);
    });

    it('returns 0.0 for empty input', () => {
      expect(strategy.score('', 'acme')).toBe(0.0);
      expect(strategy.score('acme', '')).toBe(0.0);
    });

    it('returns 0.0 for both empty strings', () => {
      expect(strategy.score('', '')).toBe(0.0);
    });

    it('handles tax ID comparison correctly', () => {
      expect(strategy.score('36-1234567', '36-1234567')).toBe(1.0);
      expect(strategy.score('36-1234567', '36-9999999')).toBe(0.0);
    });
  });

  describe('normalize()', () => {
    it('trims whitespace', () => {
      expect(strategy.normalize('  acme  ')).toBe('acme');
    });

    it('converts to lowercase', () => {
      expect(strategy.normalize('ACME CORP')).toBe('acme corp');
    });
  });

  it('requiresEmbedding returns false', () => {
    expect(strategy.requiresEmbedding()).toBe(false);
  });

  it('isAsync returns false', () => {
    expect(strategy.isAsync()).toBe(false);
  });
});
