# ResolveIQ v2 — Project Standards & Guardrails

> This file is the **authoritative coding standard** for the ResolveIQ v2 project.
> All code written for this project must conform to these rules.
> Claude Code reads this file automatically at the start of every session.

---

## 1. Project Context

**ResolveIQ** is a configuration-driven entity resolution engine. See full design in:
- [`ARCHITECTURE_PROPOSAL_NODEJS.md`](ARCHITECTURE_PROPOSAL_NODEJS.md) — v2 system design
- [`CTO_Proposal_ResolveIQ.md`](CTO_Proposal_ResolveIQ.md) — business context and v1 design

**v2 Stack:**
- Backend: **NestJS** (TypeScript) — not raw Fastify, not Express
- Frontend: React 19 + Vite + Material-UI (existing, in `ui/`)
- Database: Snowflake (entity + embedding storage, Cortex AI for embeddings only)
- Cache: Redis (L1) + in-process LRU (L0)
- Testing: Jest (unit), Supertest (integration), Pact (contract)

**What Snowflake does in v2:** embedding generation (`EMBED_TEXT_768`) and vector storage only.
All matching logic (EXACT, FUZZY, PHONETIC, NUMERIC, SEMANTIC cosine, scoring) lives in Node.js.

---

## 2. Non-Negotiable Rules

These rules apply to every file, every PR, every code generation:

```
✗ NO file may exceed 600 lines of code
✗ NO function may exceed 40 lines
✗ NO class may have more than 10 public methods
✗ NO `any` type in TypeScript — use `unknown` with type guards if truly needed
✗ NO raw SQL strings in business logic — SQL goes in repository classes only
✗ NO business logic in controllers — controllers only validate, delegate, respond
✗ NO business logic in stored procedures — Snowflake is a data layer only
✗ NO circular dependencies between modules
✗ NO console.log — use the injected Logger service
✗ NO catch-and-ignore — every caught error must be logged and handled or re-thrown
✗ NO magic numbers or magic strings — use named constants or enums
✗ NO undocumented public methods — every public method needs a TSDoc block
✗ NO test file touching real Snowflake or Redis — use mocks/fakes
```

---

## 3. Framework: NestJS

### 3.1 Module Structure

Every feature domain is a **NestJS Module**. Modules are the unit of cohesion.

```
engine/src/
├── app.module.ts                      # Root — imports all feature modules
├── main.ts                            # Bootstrap only (no logic)
│
├── profiles/                          # ProfilesModule
│   ├── profiles.module.ts
│   ├── profiles.controller.ts         # HTTP routing only
│   ├── profiles.service.ts            # Business logic
│   ├── profiles.repository.ts         # Data access interface impl
│   ├── dto/
│   │   ├── create-profile.dto.ts
│   │   ├── update-profile.dto.ts
│   │   └── profile-response.dto.ts
│   └── __tests__/
│       ├── profiles.controller.spec.ts
│       └── profiles.service.spec.ts
│
├── resolution/                        # ResolutionModule
│   ├── resolution.module.ts
│   ├── resolution.controller.ts
│   ├── resolution.service.ts          # Orchestrates the resolution pipeline
│   ├── pipeline/                      # Pure pipeline stages
│   │   ├── fast-path.checker.ts
│   │   ├── candidate.retriever.ts
│   │   ├── embedding.fetcher.ts
│   │   ├── scoring.engine.ts
│   │   ├── score.aggregator.ts
│   │   ├── match.classifier.ts
│   │   └── batch.processor.ts
│   ├── dto/
│   │   ├── resolve-request.dto.ts
│   │   ├── resolve-result.dto.ts
│   │   └── batch-resolve.dto.ts
│   └── __tests__/
│
├── entities/                          # EntitiesModule
│   ├── entities.module.ts
│   ├── entities.controller.ts
│   ├── entities.service.ts
│   ├── entities.repository.ts
│   └── dto/
│
├── strategies/                        # StrategiesModule — pure matching logic
│   ├── strategies.module.ts
│   ├── strategy.registry.ts
│   ├── interfaces/
│   │   └── match-strategy.interface.ts
│   ├── impl/
│   │   ├── exact.strategy.ts
│   │   ├── fuzzy.strategy.ts
│   │   ├── phonetic.strategy.ts
│   │   ├── numeric.strategy.ts
│   │   ├── semantic.strategy.ts
│   │   ├── hybrid.strategy.ts
│   │   └── none.strategy.ts
│   └── __tests__/                     # All strategies unit-tested, zero I/O
│
├── snowflake/                         # SnowflakeModule — infrastructure adapter
│   ├── snowflake.module.ts
│   ├── snowflake.service.ts           # Connection pool management
│   ├── snowflake-entity.repository.ts # Implements IEntityRepository
│   └── snowflake-embedding.provider.ts # Implements IEmbeddingProvider
│
├── cache/                             # CacheModule
│   ├── cache.module.ts
│   ├── layered-cache.service.ts       # L0 → L1 chain
│   ├── redis-cache.service.ts
│   └── lru-cache.service.ts
│
├── audit/                             # AuditModule
│   ├── audit.module.ts
│   └── audit.service.ts              # Fire-and-forget, async
│
└── common/                            # Shared across modules
    ├── interfaces/                    # Port definitions (the contracts)
    │   ├── profile-repository.interface.ts
    │   ├── entity-repository.interface.ts
    │   ├── embedding-provider.interface.ts
    │   ├── cache-provider.interface.ts
    │   └── audit-logger.interface.ts
    ├── models/                        # Domain models (plain TS interfaces)
    │   ├── profile.model.ts
    │   ├── entity.model.ts
    │   ├── field-config.model.ts
    │   ├── resolve-result.model.ts
    │   ├── match-score.model.ts
    │   └── audit-event.model.ts
    ├── constants/
    │   ├── injection-tokens.ts        # DI token constants (INJECTION_TOKENS)
    │   └── match-strategy.enum.ts
    ├── decorators/
    │   └── correlation-id.decorator.ts
    ├── filters/
    │   └── global-exception.filter.ts
    ├── interceptors/
    │   ├── logging.interceptor.ts
    │   └── timing.interceptor.ts
    └── guards/
        └── api-key.guard.ts
```

### 3.2 NestJS Conventions

```typescript
// Module: group related providers, export what others need
@Module({
  imports: [SnowflakeModule, CacheModule],
  controllers: [ProfilesController],
  providers: [
    ProfilesService,
    {
      provide: INJECTION_TOKENS.PROFILE_REPOSITORY,
      useClass: SnowflakeProfileRepository,  // swap without touching consumers
    },
  ],
  exports: [ProfilesService],
})
export class ProfilesModule {}

// Controller: routing + input validation ONLY, no business logic
@Controller('profiles')
@UseGuards(ApiKeyGuard)
@UseInterceptors(LoggingInterceptor, TimingInterceptor)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new resolution profile' })
  @ApiResponse({ status: 201, type: ProfileResponseDto })
  @HttpCode(HttpStatus.CREATED)
  async createProfile(
    @Body() dto: CreateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.profilesService.create(dto);
  }
}

// Service: business logic, depends on interfaces not implementations
@Injectable()
export class ProfilesService {
  constructor(
    @Inject(INJECTION_TOKENS.PROFILE_REPOSITORY)
    private readonly profileRepo: IProfileRepository,
    private readonly logger: Logger,
  ) {}
}
```

---

## 4. SOLID Principles — Applied to ResolveIQ

### S — Single Responsibility Principle

> One class, one reason to change.

```
ProfilesController  → ONLY handles HTTP routing for profiles
ProfilesService     → ONLY contains profile business rules
SnowflakeRepository → ONLY handles Snowflake I/O for entities
FuzzyStrategy       → ONLY computes Levenshtein similarity score
ScoringAggregator   → ONLY computes weighted composite score
MatchClassifier     → ONLY assigns MatchType from score signals
```

**Violation to avoid:**
```typescript
// ✗ WRONG: service doing I/O, business logic, and logging together
class ProfilesService {
  createProfile(dto: CreateProfileDto) {
    const sql = `INSERT INTO profiles ...`;  // ← direct SQL in service
    const result = this.db.execute(sql);     // ← I/O in service
    console.log('created', result);          // ← logging in service
    return result;
  }
}
```

### O — Open/Closed Principle

> Open for extension, closed for modification.

The `StrategyRegistry` enables adding strategies without modifying existing code:

```typescript
// ✓ Add JaroWinkler: create 1 file, register 1 line — nothing else changes
@Injectable()
export class JaroWinklerStrategy implements IMatchStrategy {
  readonly strategyName = 'JARO_WINKLER' as MatchStrategy;
  score(a: string, b: string): number { /* ... */ }
}
// In strategies.module.ts:
registry.register(new JaroWinklerStrategy());
```

### L — Liskov Substitution Principle

> Implementations must be substitutable for their interfaces.

Every adapter (Snowflake, Postgres, in-memory) that implements `IEntityRepository`
must behave identically from the consumer's perspective:

```typescript
// The ResolutionService doesn't know or care whether this is Snowflake or Postgres
constructor(
  @Inject(INJECTION_TOKENS.ENTITY_REPOSITORY)
  private readonly entityRepo: IEntityRepository,  // ← interface only
) {}
```

### I — Interface Segregation Principle

> No interface should force implementation of methods it does not use.

```typescript
// ✗ WRONG: fat interface
interface IDataStore {
  findEntity(): Promise<Entity>;
  generateEmbedding(): Promise<Float32Array>;
  cacheResult(): Promise<void>;
  logAudit(): Promise<void>;
}

// ✓ CORRECT: focused interfaces
interface IEntityRepository   { findById(); upsert(); list(); ... }
interface IEmbeddingProvider  { generateEmbedding(); getModelVersion(); }
interface ICacheProvider      { get(); set(); delete(); flush(); }
interface IAuditLogger        { logResolution(event: AuditEvent); }
```

### D — Dependency Inversion Principle

> Depend on abstractions, not concretions.

```typescript
// ✓ CORRECT: ResolutionService depends on IEntityRepository, not SnowflakeEntityRepository
@Injectable()
export class ResolutionService {
  constructor(
    @Inject(INJECTION_TOKENS.ENTITY_REPOSITORY)
    private readonly entityRepo: IEntityRepository,   // ← abstraction
    @Inject(INJECTION_TOKENS.EMBEDDING_PROVIDER)
    private readonly embedProvider: IEmbeddingProvider, // ← abstraction
    @Inject(INJECTION_TOKENS.CACHE_PROVIDER)
    private readonly cache: ICacheProvider,             // ← abstraction
  ) {}
}
```

Injection tokens prevent string-based magic:

```typescript
// common/constants/injection-tokens.ts
export const INJECTION_TOKENS = {
  PROFILE_REPOSITORY: Symbol('IProfileRepository'),
  ENTITY_REPOSITORY:  Symbol('IEntityRepository'),
  EMBEDDING_PROVIDER: Symbol('IEmbeddingProvider'),
  CACHE_PROVIDER:     Symbol('ICacheProvider'),
  AUDIT_LOGGER:       Symbol('IAuditLogger'),
} as const;
```

---

## 5. Design Patterns in Use

### Strategy Pattern — Matching Algorithms

```typescript
// Every matching algorithm implements the same interface
export interface IMatchStrategy {
  readonly strategyName: MatchStrategy;
  score(input: string, candidate: string, context?: StrategyContext): number | Promise<number>;
  normalize(value: string): string;
  requiresEmbedding(): boolean;
}

// Registry is the plug-in system
@Injectable()
export class StrategyRegistry {
  private readonly strategies = new Map<MatchStrategy, IMatchStrategy>();

  /** Register a new matching strategy. Can be called after module init. */
  register(strategy: IMatchStrategy): void {
    this.strategies.set(strategy.strategyName, strategy);
  }

  /** Retrieve a strategy by name. Throws if not registered. */
  get(name: MatchStrategy): IMatchStrategy {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new Error(`No strategy registered for '${name}'. Register it in StrategiesModule.`);
    }
    return strategy;
  }
}
```

### Repository Pattern — Data Access Abstraction

```typescript
// The interface (in common/interfaces/)
export interface IEntityRepository {
  findById(entityId: string): Promise<Entity | null>;
  findByExactField(profileId: string, fieldName: string, value: string): Promise<Entity | null>;
  getCandidatesByEmbedding(
    profileId: string,
    fieldName: string,
    embedding: Float32Array,
    topK: number,
    minSimilarity: number,
  ): Promise<Array<{ entity: Entity; similarity: number }>>;
  upsert(entity: Partial<Entity> & { profileId: string }): Promise<Entity>;
  softDelete(entityId: string): Promise<void>;
  bulkInsert(profileId: string, entities: Partial<Entity>[]): Promise<Entity[]>;
  listByProfile(profileId: string, page: number, pageSize: number): Promise<PaginatedResult<Entity>>;
}

// The Snowflake implementation (in snowflake/)
@Injectable()
export class SnowflakeEntityRepository implements IEntityRepository {
  // all SQL lives here — nowhere else
}
```

### Pipeline Pattern — Resolution Stages

The resolution pipeline is a series of named stages, each with a single concern:

```typescript
@Injectable()
export class ResolutionService {
  async getMatchingEntity(request: GetMatchingEntityRequest): Promise<MatchingEntityResult> {
    // Step 0: alias check — always wins over all other pipeline stages
    const alias      = await this.aliasChecker.check(request.profileSlug, request.fields);
    if (alias)         return alias;  // EXACT_MATCH (score=1.0) from alias table

    const profile    = await this.profileService.getBySlug(request.profileSlug);
    const cached     = await this.cacheOrchestrator.get(request, profile);
    if (cached)        return cached;

    const fastPath   = await this.fastPathChecker.check(profile, request.fields);
    if (fastPath)      return this.finalize(fastPath, { wasCached: false });

    const embedding  = await this.embeddingFetcher.fetch(profile, request.fields);
    const candidates = await this.candidateRetriever.get(profile, request.fields, embedding);
    const scores     = await this.scoringEngine.scoreAll(candidates, profile, request.fields, embedding);
    const best       = this.scoreAggregator.aggregate(scores);
    // Classify into one of 4 scenarios (EXACT_MATCH / HIGH_CONFIDENCE / LOW_CONFIDENCE / NO_MATCH)
    const result     = this.matchClassifier.classify(best, profile, request);

    await this.cacheOrchestrator.set(request, profile, result);
    this.auditService.log(request, profile, result);  // fire-and-forget
    return result;
  }
}
```

### Adapter Pattern — Infrastructure Providers

```typescript
// Snowflake is an adapter for the IEmbeddingProvider port
@Injectable()
export class SnowflakeCortexEmbeddingProvider implements IEmbeddingProvider {
  /** Generate a 768-dimensional embedding via Snowflake Cortex EMBED_TEXT_768. */
  async generateEmbedding(text: string): Promise<Float32Array> { /* ... */ }
  getModelVersion(): string { return 'e5-base-v2'; }
  getDimensions(): number { return 768; }
}
```

### Observer Pattern — Audit Logging

Audit logging is fire-and-forget. It never blocks a resolution response:

```typescript
@Injectable()
export class AuditService {
  /**
   * Log a resolution event. Non-blocking — errors are swallowed with a warning log.
   * Never await this from the resolution pipeline.
   */
  log(event: AuditEvent): void {
    this.doLog(event).catch((err) =>
      this.logger.warn('Audit log failed (non-fatal)', { eventId: event.eventId, err }),
    );
  }

  private async doLog(event: AuditEvent): Promise<void> { /* ... */ }
}
```

### Factory Pattern — Strategy & Provider Creation

Use factories when object creation requires conditional logic or configuration.
The `StrategyRegistry` module uses a factory approach for strategy wiring:

```typescript
// strategies/strategies.factory.ts
@Injectable()
export class StrategyFactory {
  /**
   * Create and register all built-in strategies.
   * Called once at module initialization — consumers never `new` a strategy directly.
   */
  createAll(embeddingProvider: IEmbeddingProvider): IMatchStrategy[] {
    return [
      new ExactStrategy(),
      new FuzzyStrategy(),
      new PhoneticStrategy(),
      new NumericStrategy(),
      new SemanticStrategy(embeddingProvider),
      new HybridStrategy(new FuzzyStrategy(), new SemanticStrategy(embeddingProvider)),
      new NoneStrategy(),
    ];
  }
}
```

### Command Pattern — Resolution Pipeline Actions

Model destructive or reversible actions as command objects:

```typescript
// resolution/commands/create-entity.command.ts
export interface CreateEntityCommand {
  readonly profileId: string;
  readonly fields: Record<string, string>;
  readonly correlationId?: string;
  readonly sourceSystem?: string;
}

// Processed by EntityService — encapsulates all create logic in one object
async handleCreateEntity(command: CreateEntityCommand): Promise<Entity> { ... }
```

### Facade Pattern — Complex Subsystem Simplification

The `ResolutionService` is a facade that hides the pipeline complexity from the controller:

```typescript
// Controller only knows about ResolutionService — not FastPathChecker, CandidateRetriever, etc.
@Controller('profiles')
export class ResolutionController {
  constructor(private readonly resolutionService: ResolutionService) {}

  @Post(':slug/resolve')
  resolve(@Param('slug') slug: string, @Body() dto: ResolveRequestDto) {
    return this.resolutionService.resolve({ ...dto, profileSlug: slug });
    // ↑ Facade: hides 8 pipeline stages behind one method call
  }
}
```

---

## 6. Clean Code Standards

### 6.1 Naming

| Element | Convention | Example |
|---|---|---|
| File | `kebab-case.type.ts` | `fuzzy.strategy.ts`, `profile-response.dto.ts` |
| Class | `PascalCase` | `FuzzyStrategy`, `SnowflakeEntityRepository` |
| Interface | `IPascalCase` | `IMatchStrategy`, `IEntityRepository` |
| Enum | `PascalCase` values | `MatchStrategy.EXACT`, `MatchType.NEW_ENTITY` |
| Method | `camelCase`, verb-first | `scoreCandidate()`, `buildCacheKey()`, `findByExactField()` |
| Private field | `camelCase` | `this.strategies`, `this.logger` |
| Constants | `UPPER_SNAKE_CASE` | `FAST_PATH_MIN_WEIGHT`, `DEFAULT_TOP_K` |
| Boolean | `is/has/can/should` prefix | `isActive`, `hasEmbedding`, `shouldCreateIfMissing` |
| Async method | verb-first (no `async` suffix) | `generateEmbedding()`, not `generateEmbeddingAsync()` |

### 6.2 Function Design

```typescript
// ✓ One function, one job, named after what it does (not how)
private normalizeForExactMatch(value: string): string {
  return value.trim().toLowerCase();
}

// ✓ Early returns — avoid deep nesting
async findByExactField(profileId: string, fieldName: string, value: string): Promise<Entity | null> {
  if (!value?.trim()) return null;
  if (!profileId)     return null;

  const row = await this.snowflake.queryOne(QUERIES.EXACT_FIELD_LOOKUP, [profileId, fieldName, value]);
  return row ? this.mapRowToEntity(row) : null;
}

// ✗ WRONG: nested conditionals, no early return
async findByExactField(profileId, fieldName, value) {
  if (value && value.trim()) {
    if (profileId) {
      const row = await this.snowflake.queryOne(...);
      if (row) {
        return this.mapRowToEntity(row);
      } else {
        return null;
      }
    }
  }
  return null;
}
```

### 6.3 Function Length Limit: 40 Lines

If a function exceeds 40 lines, extract a private helper with a descriptive name:

```typescript
// ✓ Main function reads like a policy, helpers do the work
async scoreAll(candidates: Entity[], profile: Profile, fields: Record<string, string>): Promise<CandidateScore[]> {
  const activeFields  = this.resolveActiveFields(profile.fields, fields);
  const totalWeight   = this.computeTotalWeight(activeFields);

  return Promise.all(
    candidates.map((candidate) => this.scoreOneCandidate(candidate, activeFields, totalWeight, fields)),
  );
}

private resolveActiveFields(profileFields: FieldConfig[], inputFields: Record<string, string>): FieldConfig[] {
  return profileFields.filter(
    (f) => f.matchStrategy !== MatchStrategy.NONE && inputFields[f.fieldName] != null,
  );
}
```

### 6.4 Composition Over Inheritance

> Prefer composing behaviour through interfaces and injection over extending base classes.

```typescript
// ✗ WRONG: inheritance chain creates tight coupling
class BaseStrategy { score() {} }
class FuzzyStrategy extends BaseStrategy { score() {} }
class HybridStrategy extends FuzzyStrategy { score() {} }  // ← fragile hierarchy

// ✓ CORRECT: compose strategies via injection
class HybridStrategy implements IMatchStrategy {
  constructor(
    private readonly fuzzy: FuzzyStrategy,    // ← composed, not inherited
    private readonly semantic: SemanticStrategy,
  ) {}

  score(a: string, b: string, ctx?: StrategyContext): number {
    return this.fuzzy.score(a, b) * 0.4 + this.semantic.score(a, b, ctx) * 0.6;
  }
}
```

### 6.5 Four-Layer Architecture

Every feature module must respect these four layers. **Never skip a layer. Never mix concerns.**

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: Controller (HTTP)                                   │
│  - Route matching, request parsing, response shaping          │
│  - No business logic, no DB calls, no conditional logic       │
│  - @Controller, @Get, @Post, @Body, @Param                    │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: Service (Application/Business)                      │
│  - Orchestrates domain logic and workflow                     │
│  - Calls repositories via IRepository interfaces             │
│  - Emits domain events, manages transactions                  │
├──────────────────────────────────────────────────────────────┤
│  Layer 3: Domain (Pure Logic)                                 │
│  - Pure TypeScript — zero NestJS/Snowflake/Redis imports     │
│  - Strategies, aggregators, classifiers                       │
│  - Fully unit-testable with no infrastructure setup          │
├──────────────────────────────────────────────────────────────┤
│  Layer 4: Infrastructure (Adapters)                           │
│  - Snowflake, Redis, external APIs                            │
│  - Implements IRepository, IEmbeddingProvider, ICacheProvider │
│  - All SQL and I/O lives here — nowhere else                  │
└──────────────────────────────────────────────────────────────┘
```

### 6.6 No Magic Values

```typescript
// ✓ Named constants
export const RESOLUTION_CONSTANTS = {
  FAST_PATH_MIN_WEIGHT:     3.0,
  SEMANTIC_MIN_SIMILARITY:  0.4,
  DEFAULT_CANDIDATE_TOP_K:  50,
  DEFAULT_THRESHOLD:        0.65,
  CACHE_TTL_SECONDS:        3600,
  MAX_BATCH_SIZE:           50,
  MAX_BULK_LOAD_SIZE:       1000,
  EMBEDDING_DIMENSIONS:     768,
} as const;

// ✗ WRONG
if (field.weight >= 3.0 && candidates.length > 50) { ... }
```

---

## 7. TypeScript Standards

### 7.1 Strict Mode — Always On

```json
// tsconfig.json — non-negotiable
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 7.2 Type Usage Rules

```typescript
// ✓ Explicit return types on all public methods
async resolve(request: ResolveRequest): Promise<ResolveResult> { ... }

// ✓ Use `unknown` with type guard, never `any`
function parseSnowflakeRow(raw: unknown): Entity {
  if (!isEntityRow(raw)) throw new TypeError('Invalid entity row shape');
  return mapEntityRow(raw);
}

// ✓ Readonly for immutable data
interface FieldConfig {
  readonly fieldName: string;
  readonly matchStrategy: MatchStrategy;
  readonly weight: number;
}

// ✓ Discriminated unions for result types
type ResolutionOutcome =
  | { status: 'matched'; entity: Entity; score: number }
  | { status: 'new_entity'; tempId: string }
  | { status: 'error'; code: string; message: string };

// ✗ WRONG
const result: any = await snowflake.query(...);
```

### 7.3 DTOs vs Domain Models

- **DTO** (Data Transfer Object): validates API input/output — uses `class-validator` decorators
- **Domain Model**: internal business objects — plain TypeScript interfaces, no decorators

```typescript
// DTO: lives in dto/ folder, has validation decorators
export class CreateProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @ApiProperty({ example: 'Supplier Dedup' })
  readonly name: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  @ApiPropertyOptional({ default: 0.7 })
  readonly defaultThreshold?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldConfigDto)
  readonly fields: FieldConfigDto[];
}

// Domain Model: lives in common/models/, plain interface
export interface Profile {
  readonly id: string;
  readonly slug: string;
  readonly defaultThreshold: number;
  readonly fields: FieldConfig[];
  readonly fastPathFields: string[];   // derived
  readonly semanticFields: string[];  // derived
}
```

---

## 8. Documentation Standards (TSDoc)

Every **public** method, class, and interface must have a TSDoc block. Private helpers need a comment if the logic is non-obvious.

### Required Tags

```typescript
/**
 * Compute the weighted composite score for a single entity candidate.
 *
 * The composite score is the normalized weighted average across all active fields.
 * Fields not present in the input are excluded from both numerator and denominator,
 * preserving score meaningfulness for partial inputs.
 *
 * @param fieldScores - Individual field scores for this candidate
 * @param totalActiveWeight - Sum of weights for fields present in the input
 * @returns Composite score in [0, 1]
 *
 * @example
 * // name(score=0.9, weight=5) + tax_id(score=1.0, weight=3) → 0.9375
 * aggregator.computeComposite([
 *   { score: 0.9, weight: 5 },
 *   { score: 1.0, weight: 3 },
 * ], 8);
 */
computeComposite(fieldScores: WeightedFieldScore[], totalActiveWeight: number): number {
  const numerator = fieldScores.reduce((sum, fs) => sum + fs.score * fs.weight, 0);
  return numerator / totalActiveWeight;
}
```

### Controller Endpoint Documentation (OpenAPI)

Every endpoint must have full OpenAPI decorators:

```typescript
@Post(':slug/resolve')
@ApiOperation({
  summary: 'Resolve a single entity against a profile',
  description: 'Matches input fields against entities using configured strategies. '
    + 'Returns the best match above threshold, or NEW_ENTITY if none found.',
})
@ApiParam({ name: 'slug', description: 'Profile URL slug', example: 'supplier-dedup' })
@ApiBody({ type: ResolveRequestDto })
@ApiResponse({ status: 200, description: 'Match result', type: ResolveResultDto })
@ApiResponse({ status: 404, description: 'Profile not found' })
@ApiResponse({ status: 400, description: 'Invalid request body' })
async resolve(
  @Param('slug') slug: string,
  @Body() dto: ResolveRequestDto,
): Promise<ResolveResultDto> {
  return this.resolutionService.resolve({ ...dto, profileSlug: slug });
}
```

---

## 9. Testing Standards

### 9.1 Test Structure: The Three Layers

```
Unit Tests      → every strategy, aggregator, classifier, service
                  Zero I/O — all deps mocked
                  Run in <1s total

Integration     → every controller route via Supertest
                  Snowflake and Redis mocked via @nestjs/testing
                  Run in <30s total

Contract Tests  → API contracts between frontend and backend
                  Using Pact (consumer-driven contract testing)
                  Run in <60s total
```

### 9.2 Unit Test Structure

```typescript
// strategies/__tests__/fuzzy.strategy.spec.ts
describe('FuzzyStrategy', () => {
  let strategy: FuzzyStrategy;

  beforeEach(() => {
    strategy = new FuzzyStrategy();  // No NestJS testing module needed — pure class
  });

  describe('score()', () => {
    it('returns 1.0 for identical strings', () => {
      expect(strategy.score('acme corp', 'acme corp')).toBe(1.0);
    });

    it('is case-insensitive', () => {
      expect(strategy.score('ACME Corp', 'acme corp')).toBe(1.0);
    });

    it('returns 0.0 for completely different strings', () => {
      expect(strategy.score('xyz', 'abc')).toBe(0.0);
    });

    it('returns partial score for one edit distance', () => {
      const score = strategy.score('acme', 'acm');   // 1 edit / max(4,3) = 0.75
      expect(score).toBeCloseTo(0.75, 2);
    });

    it('returns 0 when either value is empty', () => {
      expect(strategy.score('', 'acme')).toBe(0);
      expect(strategy.score('acme', '')).toBe(0);
    });
  });

  describe('normalize()', () => {
    it('trims whitespace and lowercases', () => {
      expect(strategy.normalize('  ACME Corp  ')).toBe('acme corp');
    });
  });
});
```

### 9.3 Service Unit Test with Mocks

```typescript
// resolution/__tests__/resolution.service.spec.ts
describe('ResolutionService', () => {
  let service: ResolutionService;
  let entityRepo: jest.Mocked<IEntityRepository>;
  let embeddingProvider: jest.Mocked<IEmbeddingProvider>;
  let cache: jest.Mocked<ICacheProvider>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ResolutionService,
        FastPathChecker,
        ScoringEngine,
        ScoreAggregator,
        MatchClassifier,
        { provide: INJECTION_TOKENS.ENTITY_REPOSITORY,  useValue: createMock<IEntityRepository>() },
        { provide: INJECTION_TOKENS.EMBEDDING_PROVIDER, useValue: createMock<IEmbeddingProvider>() },
        { provide: INJECTION_TOKENS.CACHE_PROVIDER,     useValue: createMock<ICacheProvider>() },
        { provide: INJECTION_TOKENS.AUDIT_LOGGER,       useValue: createMock<IAuditLogger>() },
      ],
    }).compile();

    service          = module.get(ResolutionService);
    entityRepo       = module.get(INJECTION_TOKENS.ENTITY_REPOSITORY);
    embeddingProvider = module.get(INJECTION_TOKENS.EMBEDDING_PROVIDER);
    cache            = module.get(INJECTION_TOKENS.CACHE_PROVIDER);
  });

  it('returns cached result when cache hits', async () => {
    const cached = buildMockResolveResult({ wasCached: true });
    cache.get.mockResolvedValue(cached);

    const result = await service.resolve(buildMockResolveRequest());

    expect(result.wasCached).toBe(true);
    expect(entityRepo.findByExactField).not.toHaveBeenCalled();
    expect(embeddingProvider.generateEmbedding).not.toHaveBeenCalled();
  });

  it('returns EXACT_FASTPATH when high-weight EXACT field matches', async () => {
    cache.get.mockResolvedValue(null);
    entityRepo.findByExactField.mockResolvedValue(buildMockEntity({ entityId: 'ENT-001' }));

    const result = await service.resolve(
      buildMockResolveRequest({ fields: { tax_id: '36-1234567' } }),
    );

    expect(result.matchType).toBe(MatchType.EXACT_FASTPATH);
    expect(result.matchScore).toBe(1.0);
    expect(embeddingProvider.generateEmbedding).not.toHaveBeenCalled();
  });
});
```

### 9.4 Integration Test (Controller via Supertest)

```typescript
// profiles/__tests__/profiles.controller.spec.ts
describe('ProfilesController (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ProfilesModule],
    })
      .overrideProvider(INJECTION_TOKENS.PROFILE_REPOSITORY)
      .useValue(createMock<IProfileRepository>())
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(() => app.close());

  describe('POST /profiles', () => {
    it('returns 201 with created profile', async () => {
      const dto: CreateProfileDto = {
        name: 'Supplier Dedup',
        entityType: 'Supplier',
        defaultThreshold: 0.7,
        fields: [
          { fieldName: 'name',   matchStrategy: 'SEMANTIC', weight: 5.0 },
          { fieldName: 'tax_id', matchStrategy: 'EXACT',    weight: 3.0 },
        ],
      };

      const res = await request(app.getHttpServer()).post('/profiles').send(dto);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ slug: 'supplier-dedup', name: 'Supplier Dedup' });
    });

    it('returns 400 when weight is out of range', async () => {
      const res = await request(app.getHttpServer())
        .post('/profiles')
        .send({ name: 'X', fields: [{ weight: 15 }] });   // weight > 10 = invalid

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('weight');
    });
  });
});
```

### 9.5 Contract Testing (Pact — Consumer-Driven)

The React frontend (`ui/`) is the **consumer**. The NestJS API is the **provider**.
Contract tests ensure the frontend's expectations of the API are always met.

**Consumer side (ui/src/__tests__/pact/):**
```typescript
// ui/src/__tests__/pact/resolve.pact.spec.ts
describe('Pact — /profiles/:slug/resolve', () => {
  const provider = new PactV3({
    consumer: 'resolveiq-ui',
    provider: 'resolveiq-api',
  });

  it('returns resolve result for a matched entity', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'supplier-dedup profile exists with ACME entity' }],
        uponReceiving: 'a resolve request for supplier-dedup',
        withRequest: {
          method: 'POST',
          path:   '/profiles/supplier-dedup/resolve',
          body:   { fields: { name: 'Acme Corp', tax_id: '36-1234567' }, threshold: 0.7 },
        },
        willRespondWith: {
          status: 200,
          body: MatchersV3.like({
            entityId:    MatchersV3.uuid(),
            displayName: MatchersV3.string('ACME Corporation'),
            matchScore:  MatchersV3.decimal(0.91),
            matchType:   MatchersV3.string('EXACT'),
            fieldScores: MatchersV3.eachLike({
              fieldName: MatchersV3.string('tax_id'),
              rawScore:  MatchersV3.decimal(1.0),
            }),
            isNewEntity: false,
            wasCached:   false,
            executionMs: MatchersV3.integer(82),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const result = await resolveEntity(mockServer.url, 'supplier-dedup', {
          fields: { name: 'Acme Corp', tax_id: '36-1234567' },
          threshold: 0.7,
        });
        expect(result.matchType).toBe('EXACT');
      });
  });
});
```

**Provider verification (NestJS side):**
```typescript
// engine/src/__tests__/pact/provider.pact.spec.ts
describe('Pact Provider Verification', () => {
  it('verifies pacts from the UI consumer', async () => {
    const verifier = new Verifier({
      providerBaseUrl: 'http://localhost:3001',
      pactUrls: ['./pacts/resolveiq-ui-resolveiq-api.json'],
      stateHandlers: {
        'supplier-dedup profile exists with ACME entity': async () => {
          // seed test data into the running NestJS test instance
        },
      },
    });
    await verifier.verifyProvider();
  });
});
```

### 9.6 Test File Rules

```
✓ One spec file per source file (profiles.service.ts → profiles.service.spec.ts)
✓ Test file lives in __tests__/ adjacent to its source
✓ Describe blocks mirror class name, nested describe mirrors method name
✓ Every it() statement is a single assertion scenario
✓ Use fixtures/builders for test data — never inline large objects in test assertions
✓ All mocks reset in beforeEach, not afterEach
✗ No real Snowflake or Redis connections in any test
✗ No shared mutable state between tests
✗ No skipped tests in CI (xit, xdescribe, test.skip)
```

---

## 10. Error Handling Standards

### 10.1 Error Classes

Define domain-specific errors — never throw raw `Error` or Snowflake SDK errors:

```typescript
// common/errors/
export class ProfileNotFoundError extends Error {
  constructor(slug: string) {
    super(`Profile '${slug}' not found or inactive`);
    this.name = 'ProfileNotFoundError';
  }
}

export class EntityResolutionError extends Error {
  constructor(
    public readonly profileId: string,
    public readonly cause: unknown,
  ) {
    super(`Resolution failed for profile '${profileId}'`);
    this.name = 'EntityResolutionError';
  }
}
```

### 10.2 Global Exception Filter

Map domain errors to HTTP responses in ONE place — not scattered across controllers:

```typescript
// common/filters/global-exception.filter.ts
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx  = host.switchToHttp();
    const res  = ctx.getResponse<Response>();
    const req  = ctx.getRequest<Request>();

    const { status, body } = this.mapException(exception, req);

    this.logger.error('Unhandled exception', { exception, path: req.url });
    res.status(status).json(body);
  }

  private mapException(exception: unknown, req: Request): { status: number; body: ErrorResponseDto } {
    if (exception instanceof ProfileNotFoundError)    return { status: 404, body: this.format(exception) };
    if (exception instanceof ValidationError)         return { status: 400, body: this.format(exception) };
    if (exception instanceof HttpException)           return { status: exception.getStatus(), body: this.format(exception) };
    return { status: 500, body: { message: 'Internal server error', path: req.url } };
  }
}
```

---

## 11. API Design Standards

### 11.1 REST Conventions

```
# Profile management
GET    /profiles                                → 200 with paginated array
POST   /profiles                                → 201 with created Profile
GET    /profiles/:slug                          → 200 or 404
PUT    /profiles/:slug                          → 200 with updated Profile
DELETE /profiles/:slug                          → 204 no content

# Entity resolution — primary API (returns salesforceId)
POST   /profiles/:slug/getMatchingEntity        → 200 with MatchingEntityResult
POST   /profiles/:slug/getMatchingEntity/batch  → 200 with BatchMatchingEntityResult

# Entity aliases — created during Manual Review
POST   /profiles/:slug/aliases                  → 201 with EntityAlias
GET    /profiles/:slug/aliases                  → 200 with paginated array
DELETE /profiles/:slug/aliases/:aliasId         → 204 soft-delete

# Entity management
GET    /profiles/:slug/entities                 → 200 with paginated array (salesforceId in each)
POST   /profiles/:slug/entities/bulk            → 201 with BulkLoadResult
PUT    /profiles/:slug/entities/:id             → 200 with updated Entity
DELETE /profiles/:slug/entities/:id             → 204

# Sync management
GET    /sync/status                             → 200 with last sync run info
POST   /sync/trigger                            → 202 Accepted (admin only)

# Observability
GET    /health                                  → 200 with { status, snowflake, redis, lastSyncAt }
GET    /stats                                   → 200 with scenario breakdown, cache hit rate
```

### 11.2 Response Shape Consistency

```typescript
// ✓ Consistent paginated response
interface PaginatedResult<T> {
  data:       T[];
  total:      number;
  page:       number;
  pageSize:   number;
  totalPages: number;
}

// ✓ Consistent error response
interface ErrorResponseDto {
  statusCode: number;
  message:    string | string[];
  error?:     string;
  path:       string;
  timestamp:  string;
}
```

### 11.3 Validation (class-validator on all DTOs)

```typescript
export class GetMatchingEntityDto {
  @IsObject()
  @IsNotEmpty()
  @ApiProperty({ example: { buyer_name: 'Acme Corp', tax_id: '36-1234567' } })
  readonly fields: Record<string, string>;

  @IsString()
  @IsIn(['Salesforce', 'Gen3', 'AdminUI'])
  @ApiProperty({ example: 'Gen3', description: 'Caller identity — required for audit trail' })
  readonly sourceSystem: 'Salesforce' | 'Gen3' | 'AdminUI';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({ description: 'Transaction or case ID from calling system for traceability' })
  readonly correlationId?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ default: false, description: 'Include full candidate list in response' })
  readonly includeDebug?: boolean;
  // NOTE: No threshold override and no createIfMissing —
  //       threshold is 0.95 per profile config; engine never creates entities.
}
```

---

## 12. Frontend Contract Standards

### 12.1 API Client Layer (in `ui/src/api/`)

The frontend must never call `fetch` or `axios` directly in components. All HTTP goes through typed API client functions:

```typescript
// ui/src/api/resolve.ts
import { apiClient } from './client';
import type { ResolveRequest, ResolveResult } from '../types/resolution';

/**
 * Resolve an entity against a profile.
 * @throws {ApiError} when the API returns a non-2xx response
 */
export async function resolveEntity(
  profileSlug: string,
  request: ResolveRequest,
): Promise<ResolveResult> {
  const { data } = await apiClient.post<ResolveResult>(
    `/profiles/${profileSlug}/resolve`,
    request,
  );
  return data;
}
```

### 12.2 Shared Types

Types shared between frontend and backend live in a shared types package:

```
engine/src/common/models/     ← source of truth (TypeScript interfaces)
ui/src/types/                 ← mirrored types (manually kept in sync, or generated from OpenAPI)
```

Generate frontend types from the NestJS OpenAPI spec:
```bash
# Generate frontend types from running API
npx openapi-typescript http://localhost:3001/api-json -o ui/src/types/api.generated.ts
```

---

## 13. Dependency Management (npm)

### Required Backend Packages
```json
{
  "dependencies": {
    "@nestjs/common": "^10.x",
    "@nestjs/core": "^10.x",
    "@nestjs/platform-fastify": "^10.x",
    "@nestjs/swagger": "^7.x",
    "class-validator": "^0.14.x",
    "class-transformer": "^0.5.x",
    "fastest-levenshtein": "^1.0.x",
    "natural": "^6.x",
    "snowflake-sdk": "^1.14.x",
    "ioredis": "^5.x",
    "lru-cache": "^10.x",
    "pino": "^9.x"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.x",
    "@pact-foundation/pact": "^12.x",
    "supertest": "^7.x",
    "jest": "^29.x",
    "@types/jest": "^29.x",
    "@typescript-eslint/eslint-plugin": "^7.x",
    "prettier": "^3.x"
  }
}
```

### Rules
- Pin major versions — no `*` or `latest`
- No transitive dependency imports — only import from top-level package
- Audit monthly: `npm audit`

---

## 14. Proactive Development Workflow (Contract-First, Backend-First)

This section defines **how** to develop features — not just what the code must look like.
Following this workflow prevents integration failures and eliminates rework cycles.

### 14.1 Development Order — Always Follow This Sequence

```
1. DEFINE  → Write the API contract (DTOs + OpenAPI docs) BEFORE any implementation
2. PLAN    → Create docs/features/<feature-name>.md with contract, DB changes, test commands
3. BACKEND → Implement and test the backend endpoint independently (curl/PowerShell)
4. CLIENT  → Regenerate frontend API types from the running OpenAPI spec
5. FRONTEND → Implement the UI only after backend is verified working
6. TEST    → Unit → Integration → Contract → E2E in that order
```

**Never jump to frontend before backend is curl-verified.**

### 14.2 Contract-First: Define DTOs Before Code

Before writing any service or controller logic for a new endpoint:

1. Define the **request DTO** with all validation rules
2. Define the **response DTO** with exact field types
3. Define all **error cases** (400, 404, 409, 500 and what triggers each)
4. Write example payloads in the `@ApiProperty` decorator

```typescript
// ✓ Contract defined FIRST — before service, before repository, before SQL
export class CreateProfileDto {
  @IsString() @MinLength(2) @MaxLength(100)
  @ApiProperty({ example: 'Supplier Dedup', description: 'Human-readable profile name' })
  readonly name: string;

  @IsString() @IsIn(VALID_ENTITY_TYPES)
  @ApiProperty({ example: 'Supplier', enum: VALID_ENTITY_TYPES })
  readonly entityType: string;

  @IsNumber() @Min(0) @Max(1)
  @ApiPropertyOptional({ default: 0.7, description: 'Default match threshold (0–1)' })
  readonly defaultThreshold?: number = 0.7;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => FieldConfigDto)
  @ApiProperty({ type: [FieldConfigDto] })
  readonly fields: FieldConfigDto[];
}
// ← Only AFTER this is complete: write ProfilesService.create()
```

### 14.3 Feature Planning Document

For any feature that adds/modifies an endpoint or schema, create a plan document first:

```
docs/features/<feature-name>.md
```

Minimum content:
- **What**: one sentence
- **API contract**: endpoint, request DTO, response DTO, error cases
- **DB changes**: which Snowflake tables are affected
- **Testing commands**: exact curl/PowerShell commands to verify
- **Rollback plan**: how to undo if issues arise

This 15-minute investment prevents 2+ hours of rework.

### 14.4 Backend Validation Before Frontend (MANDATORY)

**CRITICAL: Never touch frontend code until the backend endpoint is curl-verified.**

Required workflow for every new endpoint:

```
1. Implement backend endpoint
2. Build: npm run build (or docker compose build engine)
3. Start: npm run start:dev
4. Test with curl or PowerShell — fix all issues here
5. Verify database state in Snowflake (SELECT to confirm data written correctly)
6. ONLY then: implement frontend
```

**PowerShell testing templates (Windows development):**

```powershell
# GET endpoint test
$baseUrl = "http://localhost:8001"
Invoke-RestMethod -Uri "$baseUrl/profiles" -Method Get | ConvertTo-Json -Depth 5

# POST endpoint test
$body = @{
  name             = "Supplier Dedup"
  entityType       = "Supplier"
  defaultThreshold = 0.7
  fields           = @(
    @{ fieldName = "name";   matchStrategy = "SEMANTIC"; weight = 5.0 }
    @{ fieldName = "tax_id"; matchStrategy = "EXACT";    weight = 3.0 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "$baseUrl/profiles" -Method Post `
  -Body $body -ContentType "application/json"

# Resolve endpoint test
$resolveBody = @{
  fields          = @{ name = "Acme Corp"; tax_id = "36-1234567" }
  threshold       = 0.7
  createIfMissing = $false
} | ConvertTo-Json

Invoke-RestMethod -Uri "$baseUrl/profiles/supplier-dedup/resolve" `
  -Method Post -Body $resolveBody -ContentType "application/json"
```

Save these as `scripts/test-<domain>-apis.ps1` for reuse. They become the living smoke-test suite.

### 14.5 Frontend API Client Generation (MANDATORY after backend changes)

After **any** backend API change (new endpoint, renamed method, changed DTO), regenerate
the frontend types so TypeScript catches mismatches at compile time, not at runtime.

**Workflow:**

```bash
# 1. Ensure NestJS API is running
npm run start:dev    # in engine/

# 2. Verify Swagger UI accessible
# Open: http://localhost:8001/api  ← Swagger UI
# Open: http://localhost:8001/api-json  ← Raw OpenAPI JSON

# 3. Regenerate frontend TypeScript types
cd ui/
npx openapi-typescript http://localhost:8001/api-json -o src/types/api.generated.ts

# 4. Check for TypeScript compile errors (breaking changes will surface here)
npm run build
```

**When to regenerate (always, not optionally):**
- After adding a new endpoint
- After renaming a controller method
- After changing a request or response DTO field
- After modifying validation constraints that affect the schema
- Before any frontend PR that calls backend APIs

**Benefits:**
- TypeScript catches API mismatches at compile time
- IDE auto-complete for all backend endpoints
- Single source of truth: NestJS decorators → OpenAPI JSON → frontend types
- Zero manual copying of interfaces between backend and frontend

### 14.6 API Response Transformation

Services must return what the **frontend needs**, not raw database rows.
Compute derived and denormalized fields in the service layer — not in the frontend.

```typescript
// ✓ Transform in service — frontend gets a ready-to-use shape
async listEntities(profileId: string): Promise<EntityResponseDto[]> {
  const entities = await this.entityRepo.listByProfile(profileId, 1, 500);
  return entities.data.map((e) => this.toResponseDto(e));
}

private toResponseDto(entity: Entity): EntityResponseDto {
  return {
    entityId:      entity.entityId,
    displayName:   entity.displayName,
    fieldValues:   entity.fieldValues,
    isActive:      entity.isActive,
    createdAt:     entity.createdAt.toISOString(),
    // Computed for frontend convenience:
    fieldCount:    Object.keys(entity.fieldValues).length,
    hasEmbedding:  entity.semanticFields.length > 0,
    sourceLabel:   entity.sourceSystem ?? 'Manual',
  };
}
```

---

## 15. Code Review Checklists

Use these checklists before proposing any code change or opening a PR.

### Backend Checklist

```
□ Request DTO defined with all validation decorators (@IsString, @IsNotEmpty, etc.)
□ Response DTO defined with @ApiProperty on every field
□ @ApiOperation, @ApiResponse (200, 400, 404, 500) on every controller method
□ Error cases handled explicitly (no silent failures, no generic 500 for known errors)
□ No business logic in controller — delegate to service
□ No SQL in service — delegate to repository
□ Repository method name is descriptive (findByExactField not getRow)
□ No raw `any` types — use typed interfaces or `unknown` with guards
□ All public methods have TSDoc blocks
□ File is under 600 lines
□ No function over 40 lines
□ curl/PowerShell test executed and passing
□ Snowflake state verified with SELECT (if persistence involved)
□ Unit tests written for new logic (zero I/O)
□ Integration test covers the new route (Supertest)
```

### Frontend Checklist

```
□ API types regenerated from OpenAPI spec after any backend change
□ No fetch/axios calls directly in components — use ui/src/api/ functions
□ TypeScript interfaces match backend response DTO exactly
□ Error states handled (try/catch + user-visible message via notistack)
□ Loading states shown for all async operations
□ Empty states handled gracefully (no blank screen on zero results)
□ No type assertions (as SomeType) — prefer proper typing
□ Components under 300 lines — extract sub-components if larger
□ Props typed with explicit interface (not inline object type)
□ Browser console is error-free after manual test
```

### Integration Checklist

```
□ Backend tested independently with curl/PowerShell FIRST
□ Snowflake data state verified before wiring frontend
□ Frontend wired to correct endpoint (slug, method, body shape)
□ End-to-end flow tested: UI → API → Snowflake → Response → UI render
□ Browser console checked for errors after full flow
□ Pact contract test updated if API response shape changed
□ Regression: existing features not broken
```

---

## 16. Docker & Service Management

### Targeted Rebuild — Never Bring Everything Down

```bash
# ✓ CORRECT: Rebuild and restart only the modified service
docker compose build engine
docker compose up -d engine

# ✓ CORRECT: Restart without rebuild (env-only change)
docker compose restart engine

# ✓ CORRECT: View logs for one service
docker compose logs -f engine

# ✓ CORRECT: Recreate one service without restarting dependencies
docker compose up -d --force-recreate --no-deps engine

# ✗ WRONG: Destroys all containers — avoid unless full reset is explicitly needed
docker compose down

# ✗ WRONG: Rebuilds everything from scratch — wastes 5-10 minutes
docker compose build --no-cache
```

### Service-Specific Rules

| When you change | Rebuild only |
|---|---|
| `engine/src/**` | `engine` |
| `ui/src/**` | `ui` |
| `.env` file | Restart target service only |
| Snowflake schema | Run SQL directly in Snowflake, no Docker change |
| Redis config | `redis` only |

### Build Optimization

- Do **not** use `--no-cache` unless diagnosing a broken build layer
- Docker layer caching is configured — incremental builds take 10–30 seconds
- First build per service: 2–3 minutes; subsequent: 10–30 seconds

---

## 17. Git & PR Standards

```
Branch naming:  feature/<ticket>-short-description
                fix/<ticket>-short-description
                chore/<ticket>-short-description

Commit format:  <type>(<scope>): <subject>
                feat(strategies): add JaroWinkler strategy
                fix(cache): handle Redis timeout gracefully
                test(resolution): add fast-path unit tests
                refactor(scoring): extract weight normalization helper

PR requirements:
  ✓ All unit tests pass
  ✓ All integration tests pass
  ✓ Pact contract tests pass
  ✓ No file > 600 lines
  ✓ No new `any` types
  ✓ All public methods have TSDoc
  ✓ OpenAPI decorators on all new endpoints
```

---

## 18. What NOT to Do (Guardrails)

These will be flagged in code review and rejected:

```typescript
// ✗ Business logic in a controller
@Post(':slug/resolve')
async resolve(@Param('slug') slug: string, @Body() dto: ResolveRequestDto) {
  const session = this.snowflake.getSession();           // ← no: I/O in controller
  const result = session.sql('CALL RESOLVE_AND_UPSERT(...)').collect(); // ← no: SQL in controller
  return result;
}

// ✗ Direct SQL in a service
@Injectable()
export class ResolutionService {
  async resolve(request: ResolveRequest) {
    const rows = await this.snowflake.query('SELECT * FROM profile_entities'); // ← no: SQL in service
  }
}

// ✗ Concrete dependency instead of interface
@Injectable()
export class ResolutionService {
  constructor(private readonly repo: SnowflakeEntityRepository) {} // ← no: concrete class
}

// ✗ God class — too many responsibilities
export class EntityMatchingService {
  createProfile() { ... }
  deleteProfile() { ... }
  resolveEntity() { ... }
  createEntity()  { ... }
  generateEmbed() { ... }
  writeCache()    { ... }
  logAudit()      { ... }  // ← 7+ responsibilities: split into modules
}

// ✗ Ignoring errors
try {
  await this.audit.log(event);
} catch (_e) {}  // ← must at least log the failure

// ✗ Snowflake stored procedure calls for business logic
await this.snowflake.query('CALL RESOLVE_AND_UPSERT(...)');  // ← logic belongs in Node.js

// ✗ Await blocking in batch (the exact bug in v1)
const results = [];
for (const entity of entities) {
  results.push(await this.resolve(entity));  // ← sequential: use Promise.allSettled
}
```

---

---

## 19. Default Assumptions

Unless explicitly stated otherwise in a task or feature request:

- **API style**: REST (JSON request/response)
- **Authentication**: handled at the API gateway / guard level — services assume requests are authenticated
- **Configuration**: data-driven and profile-based — no hardcoded entity types or field rules
- **Scalability**: every service and repository must be stateless and horizontally scalable
- **Auditability**: every resolution decision is logged to `profile_match_log` — no exceptions
- **Caching**: Redis L1 (TTL=3600s) + in-process LRU L0 — never cache in Snowflake tables; cache is flushed hourly after the sync cycle
- **Embedding provider**: Snowflake Cortex (`e5-base-v2`) unless explicitly overridden
- **Match threshold**: `0.95` — EXACT_MATCH (=1.0) and HIGH_CONFIDENCE (>=0.95) auto-accepted; below 0.95 routes to Manual Review
- **Primary return ID**: `salesforceId` — this is THE identifier returned by `getMatchingEntity`; internal `entityId` is not exposed to callers
- **Resolution scenarios**: 4 outcomes — EXACT_MATCH, HIGH_CONFIDENCE, LOW_CONFIDENCE, NO_MATCH
- **Engine never creates entities**: `getMatchingEntity` classifies only; callers decide what to do (create in SF, create alias, route to manual review)
- **Data sync**: SF + Gen3 → Snowflake hourly (external ETL); ResolveIQ runs EmbeddingRefreshJob + CacheRefreshJob after each sync
- **Entity aliases**: created via Manual Review UI; embedded in next hourly cycle; checked as step 0 of every resolution pipeline call
- **Snowflake**: read/write for entity data, embeddings, aliases, and audit log only — no business logic SQL
- **Error responses**: always include `statusCode`, `message`, `path`, `timestamp`
- **Batch operations**: always concurrent (`Promise.allSettled`) — never sequential loops

---

## 20. Final Instruction

Claude Code must behave as a **Senior Backend Architect** producing **production-grade,
maintainable, extensible code** aligned with an enterprise entity resolution platform.

**Non-negotiable behaviours:**

1. **Define before implement** — write the contract (DTOs, interfaces) before writing logic
2. **Test before integrate** — verify backend with curl before writing frontend code
3. **SOLID always** — every class has one job, every dependency is injected via interface
4. **No shortcuts** — demo-quality code, hacks, or "we'll fix it later" patterns are not acceptable
5. **Readable without comments** — code should explain itself; comments explain *why*, not *what*
6. **Explicit over implicit** — if behaviour is not obvious, make it obvious through naming or a brief TSDoc note
7. **Fail loudly** — prefer throwing a typed error over returning null silently
8. **Small and focused** — if a file, class, or function feels "too big", it is; split it

---

*Document version: 2.1.0*
*Last updated: February 2026*
*Owner: Engineering Team*

> When in doubt: **SOLID over clever, explicit over implicit, tested over trusted.**
> Contract first. Backend first. Then frontend.
