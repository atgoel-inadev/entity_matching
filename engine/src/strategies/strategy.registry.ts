import { Injectable, Logger } from '@nestjs/common';
import type { IMatchStrategy } from '../common/ports/match-strategy.port';
import type { MatchStrategy } from '../common/models/profile.model';

/**
 * StrategyRegistry is a plugin registry for matching strategy implementations.
 *
 * This implements the Registry variant of the Factory pattern.
 * Adding a new matching algorithm requires:
 *   1. Create a class implementing IMatchStrategy.
 *   2. Call registry.register(new MyStrategy()) in StrategiesModule.
 *   3. No modifications to any existing code (Open/Closed Principle).
 *
 * The registry is injectable as a NestJS singleton. All pipeline components
 * that need strategy access depend on this registry, not on concrete classes.
 */
@Injectable()
export class StrategyRegistry {
  private readonly logger = new Logger(StrategyRegistry.name);
  private readonly strategyMap = new Map<MatchStrategy, IMatchStrategy>();

  /**
   * Registers a strategy implementation.
   * Overwrites any previously registered strategy with the same name.
   * @param strategy - The strategy instance to register.
   */
  register(strategy: IMatchStrategy): void {
    this.strategyMap.set(strategy.strategyName, strategy);
    this.logger.debug(`Registered strategy: ${strategy.strategyName}`);
  }

  /**
   * Retrieves a strategy by name.
   * @param name - The MatchStrategy enum value.
   * @returns The registered strategy implementation.
   * @throws Error if no strategy is registered for the given name.
   */
  get(name: MatchStrategy): IMatchStrategy {
    const strategy = this.strategyMap.get(name);

    if (!strategy) {
      throw new Error(
        `No strategy registered for '${name}'. ` +
        `Registered strategies: [${this.getRegisteredNames().join(', ')}]`,
      );
    }

    return strategy;
  }

  /**
   * Returns true if a strategy is registered for the given name.
   * @param name - The strategy name to check.
   */
  has(name: MatchStrategy): boolean {
    return this.strategyMap.has(name);
  }

  /**
   * Returns the names of all currently registered strategies.
   */
  getRegisteredNames(): MatchStrategy[] {
    return Array.from(this.strategyMap.keys());
  }
}
