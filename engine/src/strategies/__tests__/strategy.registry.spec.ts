import { StrategyRegistry } from '../strategy.registry';
import { ExactStrategy } from '../exact.strategy';
import { FuzzyStrategy } from '../fuzzy.strategy';
import { NoneStrategy } from '../none.strategy';

// Minimal mock for Logger to avoid NestJS module setup in unit tests
jest.mock('@nestjs/common', () => ({
  Injectable: () => () => undefined,
  Logger: class {
    debug = jest.fn();
    log = jest.fn();
  },
}));

describe('StrategyRegistry', () => {
  let registry: StrategyRegistry;

  beforeEach(() => {
    registry = new StrategyRegistry();
  });

  it('should register and retrieve a strategy', () => {
    const exact = new ExactStrategy();
    registry.register(exact);
    expect(registry.get('EXACT')).toBe(exact);
  });

  it('should register multiple strategies independently', () => {
    const exact = new ExactStrategy();
    const fuzzy = new FuzzyStrategy();
    registry.register(exact);
    registry.register(fuzzy);

    expect(registry.get('EXACT')).toBe(exact);
    expect(registry.get('FUZZY')).toBe(fuzzy);
  });

  it('should overwrite an existing strategy when re-registered', () => {
    const exact1 = new ExactStrategy();
    const exact2 = new ExactStrategy();
    registry.register(exact1);
    registry.register(exact2);

    expect(registry.get('EXACT')).toBe(exact2);
  });

  it('has() returns true for registered strategy', () => {
    registry.register(new NoneStrategy());
    expect(registry.has('NONE')).toBe(true);
  });

  it('has() returns false for unregistered strategy', () => {
    expect(registry.has('EXACT')).toBe(false);
  });

  it('getRegisteredNames() returns all registered strategy names', () => {
    registry.register(new ExactStrategy());
    registry.register(new FuzzyStrategy());
    registry.register(new NoneStrategy());

    const names = registry.getRegisteredNames();
    expect(names).toContain('EXACT');
    expect(names).toContain('FUZZY');
    expect(names).toContain('NONE');
    expect(names).toHaveLength(3);
  });

  it('get() throws a descriptive error for unregistered strategy', () => {
    registry.register(new ExactStrategy());

    expect(() => registry.get('FUZZY')).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('FUZZY'),
      }),
    );
  });
});
