import { PhoneticStrategy } from '../phonetic.strategy';

describe('PhoneticStrategy', () => {
  let strategy: PhoneticStrategy;

  beforeEach(() => {
    strategy = new PhoneticStrategy();
  });

  it('should have strategyName PHONETIC', () => {
    expect(strategy.strategyName).toBe('PHONETIC');
  });

  describe('score()', () => {
    it('returns 1.0 for names that sound the same (Jon / John)', () => {
      expect(strategy.score('jon', 'john')).toBe(1.0);
    });

    it('returns 1.0 for identical names', () => {
      expect(strategy.score('smith', 'smith')).toBe(1.0);
    });

    it('returns >= 0.9 for SoundEx matches (Hanson / Hansen)', () => {
      const score = strategy.score('hanson', 'hansen');
      expect(score).toBeGreaterThanOrEqual(0.9);
    });

    it('returns >= 0.7 for cross-code match (Smith / Smythe)', () => {
      const score = strategy.score('smith', 'smythe');
      expect(score).toBeGreaterThanOrEqual(0.7);
    });

    it('returns 0.0 for completely phonetically different names', () => {
      // Radically different sounds
      const score = strategy.score('johnson', 'zhang');
      expect(score).toBe(0.0);
    });

    it('returns 0.0 for empty input', () => {
      expect(strategy.score('', 'john')).toBe(0.0);
      expect(strategy.score('john', '')).toBe(0.0);
    });

    it('is case-insensitive', () => {
      expect(strategy.score('John', 'JON')).toBe(strategy.score('john', 'jon'));
    });
  });

  it('requiresEmbedding returns false', () => {
    expect(strategy.requiresEmbedding()).toBe(false);
  });

  it('isAsync returns false', () => {
    expect(strategy.isAsync()).toBe(false);
  });
});
