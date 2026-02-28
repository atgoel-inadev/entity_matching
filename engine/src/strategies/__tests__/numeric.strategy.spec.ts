import { NumericStrategy } from '../numeric.strategy';

describe('NumericStrategy', () => {
  let strategy: NumericStrategy;

  beforeEach(() => {
    strategy = new NumericStrategy();
  });

  it('should have strategyName NUMERIC', () => {
    expect(strategy.strategyName).toBe('NUMERIC');
  });

  describe('score()', () => {
    it('returns 1.0 for phone numbers with same digits, different formatting', () => {
      expect(strategy.score('(800) 555-1234', '8005551234')).toBe(1.0);
    });

    it('returns 1.0 for EIN with and without dash', () => {
      expect(strategy.score('36-1234567', '361234567')).toBe(1.0);
    });

    it('returns 1.0 for identical digit strings', () => {
      expect(strategy.score('123456', '123456')).toBe(1.0);
    });

    it('returns 0.0 for different digit sequences', () => {
      expect(strategy.score('8005551234', '8005559999')).toBe(0.0);
    });

    it('returns 0.0 when either value has no digits', () => {
      expect(strategy.score('', '8005551234')).toBe(0.0);
      expect(strategy.score('N/A', '8005551234')).toBe(0.0);
    });

    it('handles international phone with country code', () => {
      expect(strategy.score('+1 (800) 555-1234', '18005551234')).toBe(1.0);
    });
  });

  describe('normalize()', () => {
    it('strips all non-digit characters', () => {
      expect(strategy.normalize('(800) 555-1234')).toBe('8005551234');
      expect(strategy.normalize('+1-800-555-1234')).toBe('18005551234');
      expect(strategy.normalize('36-1234567')).toBe('361234567');
    });

    it('returns empty string for non-numeric input', () => {
      expect(strategy.normalize('N/A')).toBe('');
      expect(strategy.normalize('')).toBe('');
    });
  });

  it('requiresEmbedding returns false', () => {
    expect(strategy.requiresEmbedding()).toBe(false);
  });

  it('isAsync returns false', () => {
    expect(strategy.isAsync()).toBe(false);
  });
});
