import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { StrategyRegistry } from './strategy.registry';
import { ExactStrategy } from './exact.strategy';
import { FuzzyStrategy } from './fuzzy.strategy';
import { PhoneticStrategy } from './phonetic.strategy';
import { NumericStrategy } from './numeric.strategy';
import { SemanticStrategy } from './semantic.strategy';
import { HybridStrategy } from './hybrid.strategy';
import { NoneStrategy } from './none.strategy';

/**
 * StrategiesModule wires all matching algorithm implementations into the registry.
 *
 * The module implements OnModuleInit to register all strategies at startup.
 * Adding a new strategy: create the class, add it to registrations() below.
 *
 * Exports StrategyRegistry so ResolutionModule's ScoringEngine can resolve
 * strategies by name at runtime.
 */
@Module({
  providers: [StrategyRegistry],
  exports: [StrategyRegistry],
})
export class StrategiesModule implements OnModuleInit {
  private readonly logger = new Logger(StrategiesModule.name);

  constructor(private readonly registry: StrategyRegistry) {}

  /** Registers all strategies when the module initializes. */
  onModuleInit(): void {
    const fuzzyStrategy = new FuzzyStrategy();
    const semanticStrategy = new SemanticStrategy();

    const strategies = [
      new ExactStrategy(),
      fuzzyStrategy,
      new PhoneticStrategy(),
      new NumericStrategy(),
      semanticStrategy,
      new HybridStrategy(fuzzyStrategy, semanticStrategy),
      new NoneStrategy(),
    ];

    for (const strategy of strategies) {
      this.registry.register(strategy);
    }

    this.logger.log(
      `Registered ${strategies.length} strategies: [${this.registry.getRegisteredNames().join(', ')}]`,
    );
  }
}
