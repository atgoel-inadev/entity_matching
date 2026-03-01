# ResolveIQ v2 Engine — Low-Level Developer Architecture

> **Target Audience**: Backend developers onboarding to the ResolveIQ v2 codebase  
> **Last Updated**: March 1, 2026  
> **Version**: 2.1.0

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Principles](#2-architecture-principles)
3. [Module Structure](#3-module-structure)
4. [Resolution Pipeline Deep Dive](#4-resolution-pipeline-deep-dive)
5. [Data Flow](#5-data-flow)
6. [Port & Adapter Pattern](#6-port--adapter-pattern)
7. [Strategy Pattern for Matching](#7-strategy-pattern-for-matching)
8. [Caching Strategy](#8-caching-strategy)
9. [Database Schema & Queries](#9-database-schema--queries)
10. [API Layer](#10-api-layer)
11. [Performance Considerations](#11-performance-considerations)
12. [Testing Strategy](#12-testing-strategy)
13. [Design Patterns in Use](#13-design-patterns-in-use)
14. [Common Development Tasks](#14-common-development-tasks)

---

## 1. System Overview

### What is ResolveIQ?

ResolveIQ is an **entity resolution engine** that:
- Takes an input entity (e.g., supplier with name, tax ID, address)
- Matches it against a database of known entities
- Returns the best match with a confidence score
- Supports multiple matching strategies (EXACT, FUZZY, PHONETIC, SEMANTIC)

### Key Capabilities

```
Input: { supplier_name: "Shanghai Supply", tax_id: "CN12345" }
                              ↓
        [Resolution Pipeline — 10 stages]
                              ↓
Output: {
  entity_id: "9f38b6fe-...",
  display_name: "Shanghai Electronics Supply Co",
  match_score: 0.9354,
  match_type: "SEMANTIC",
  field_scores: { supplier_name: 0.9354, tax_id: 1.0 }
}
```

### v1 vs v2 Architecture

| Aspect | v1 (Python + Snowflake) | v2 (Node.js + NestJS) |
|--------|-------------------------|------------------------|
| **Matching Logic** | SQL UDFs in Snowflake | TypeScript classes in Node.js |
| **Scoring** | CROSS JOIN in SQL UDTF | In-process loop over 50 candidates |
| **Strategies** | Hardcoded CASE statements | Pluggable strategy registry |
| **Caching** | Snowflake result cache | L0 (LRU) + L1 (Redis) |
| **Testing** | Manual SQL queries | Unit + Integration + Contract tests |
| **Embedding** | Snowflake Cortex only | Abstracted behind IEmbeddingProvider |
| **Performance** | Full table scan per query | ANN search + fast-path optimization |

**Why Node.js?**
- **V8 JIT** makes cosine similarity 6x faster than CPython
- **TypeScript** provides type safety and IDE autocomplete
- **NestJS** offers dependency injection and module system
- **Strategy pattern** enables hot-swapping matching algorithms
- **Hexagonal architecture** makes database adapter swappable

---

## 2. Architecture Principles

### Hexagonal Architecture (Ports & Adapters)

```
┌──────────────────────────────────────────────────────────────────┐
│                         HTTP Layer                                │
│              (Controllers — validate, delegate, respond)          │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                     Application Layer                             │
│              (Services — business logic orchestration)            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            Resolution Pipeline (pure logic)               │   │
│  │  FastPath → Embedding → Candidates → Score → Classify    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│              Depends on Ports (interfaces), not adapters         │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                       Ports (Interfaces)                          │
│                                                                   │
│  IEntityRepository  │  IEmbeddingProvider  │  ICacheProvider     │
│  IProfileRepository │  IAuditLogger        │  IMatchStrategy     │
└─────────────────────────┬──────────┬──────────────────┬──────────┘
                          │          │                  │
              ┌───────────┘          │                  └──────────┐
              │                      │                             │
┌─────────────▼───────┐  ┌──────────▼──────────┐  ┌───────────────▼──────┐
│  Snowflake Adapter  │  │   Redis Adapter     │  │  Strategy Registry   │
│                     │  │                     │  │  - ExactStrategy     │
│  - SnowflakeEntity  │  │  - RedisCacheService│  │  - FuzzyStrategy     │
│    Repository       │  │                     │  │  - SemanticStrategy  │
│  - SnowflakeCortex  │  │  + LRU (L0 cache)   │  │  - PhoneticStrategy  │
│    EmbeddingProvider│  │                     │  │  - [extensible...]   │
└─────────────────────┘  └─────────────────────┘  └──────────────────────┘
```

**Key Principle**: The core resolution logic depends on **abstractions (ports)**, not **concrete implementations (adapters)**. You can swap Snowflake for Postgres+pgvector without changing a single line of business logic.

### Four-Layer Architecture

Every feature follows this vertical slice:

```
1. Controller     → HTTP routing, validation, response shaping (NO business logic)
2. Service        → Orchestrates domain logic, manages transactions
3. Domain Logic   → Pure TypeScript (strategies, aggregators, classifiers)
4. Infrastructure → Database, cache, external APIs (adapters implementing ports)
```

**Example: POST /profiles/supplier-dedup/resolve**

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: ResolutionController                                   │
│  - Validates ResolveRequestDto (class-validator)                │
│  - Calls resolutionService.resolve()                            │
│  - Maps domain result to ResolveResultDto                       │
│  - Returns 200 with JSON                                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│ Layer 2: ResolutionService                                      │
│  - Loads profile via ProfilesService                            │
│  - Orchestrates 10-stage pipeline                               │
│  - Calls cache, repository, audit via interfaces               │
│  - Returns ResolveResult (domain model)                         │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│ Layer 3: Pipeline Components (Pure Logic)                       │
│  - FastPathChecker.check()                                      │
│  - CandidateRetriever.getCandidates()                           │
│  - ScoringEngine.scoreAll()                                     │
│  - SemanticStrategy.score() ← pure cosine math, no I/O         │
│  - ScoreAggregator.aggregate()                                  │
│  - MatchClassifier.classify()                                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│ Layer 4: Infrastructure Adapters                                │
│  - SnowflakeEntityRepository.findByExactField()                 │
│  - SnowflakeEntityRepository.getCandidatesByEmbedding()         │
│  - SnowflakeCortexEmbeddingProvider.generateEmbedding()         │
│  - LayeredCacheService.get() / .set()                           │
│  - AuditService.log() (fire-and-forget)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Module Structure

### NestJS Module Organization

```
engine/src/
├── app.module.ts              # Root module — imports all feature modules
├── main.ts                    # Bootstrap (port 8001, Swagger, global pipes)
│
├── common/                    # Shared across all modules
│   ├── constants/             # Resolution constants, injection tokens
│   ├── errors/                # Custom error classes (DomainError, etc.)
│   ├── models/                # Domain models (plain TS interfaces)
│   │   ├── profile.model.ts
│   │   ├── entity.model.ts
│   │   ├── resolution.model.ts
│   │   └── field-config.model.ts
│   ├── ports/                 # Port interfaces (the contracts)
│   │   ├── entity-repository.port.ts
│   │   ├── profile-repository.port.ts
│   │   ├── embedding-provider.port.ts
│   │   ├── cache-provider.port.ts
│   │   ├── audit-logger.port.ts
│   │   └── match-strategy.port.ts
│   └── tokens/
│       └── injection-tokens.ts  # DI token constants
│
├── profiles/                  # ProfilesModule
│   ├── profiles.module.ts
│   ├── profiles.controller.ts # GET/POST/PUT /profiles
│   ├── profiles.service.ts    # Profile business logic
│   ├── dto/
│   │   ├── create-profile.dto.ts
│   │   ├── update-profile.dto.ts
│   │   └── profile-response.dto.ts
│   └── __tests__/
│
├── entities/                  # EntitiesModule
│   ├── entities.module.ts
│   ├── entities.controller.ts # GET/PUT/DELETE /profiles/:slug/entities
│   ├── entities.service.ts
│   ├── dto/
│   └── __tests__/
│
├── resolution/                # ResolutionModule ⭐ CORE
│   ├── resolution.module.ts
│   ├── resolution.controller.ts  # POST /profiles/:slug/resolve
│   ├── resolution.service.ts     # Pipeline orchestrator
│   ├── resolution.helpers.ts     # Cache key builder, audit event builder
│   ├── pipeline/                 # 10-stage resolution pipeline
│   │   ├── fast-path.checker.ts       # Stage 2: EXACT high-weight lookup
│   │   ├── embedding.fetcher.ts       # Stage 3: Cortex EMBED_TEXT_768
│   │   ├── candidate.retriever.ts     # Stage 4: ANN or full scan
│   │   ├── scoring.engine.ts          # Stage 5: Apply strategies
│   │   ├── score.aggregator.ts        # Stage 6: Weighted composite score
│   │   ├── match.classifier.ts        # Stage 7: EXACT/HIGH/LOW/NO_MATCH
│   │   └── batch.processor.ts         # Batch API (50 entities in parallel)
│   ├── dto/
│   │   ├── resolve-request.dto.ts
│   │   ├── resolve-result.dto.ts
│   │   └── batch-resolve.dto.ts
│   └── __tests__/
│
├── strategies/                # StrategiesModule
│   ├── strategies.module.ts
│   ├── strategy.registry.ts   # Map<MatchStrategy, IMatchStrategy>
│   ├── exact.strategy.ts      # EXACT: case-insensitive equality
│   ├── fuzzy.strategy.ts      # FUZZY: Levenshtein distance
│   ├── phonetic.strategy.ts   # PHONETIC: Soundex
│   ├── numeric.strategy.ts    # NUMERIC: normalize then compare
│   ├── semantic.strategy.ts   # SEMANTIC: cosine similarity
│   ├── hybrid.strategy.ts     # HYBRID: 0.4*fuzzy + 0.6*semantic
│   ├── none.strategy.ts       # NONE: always returns 0
│   └── __tests__/             # All strategies unit-tested (zero I/O)
│
├── snowflake/                 # SnowflakeModule (Infrastructure Adapter)
│   ├── snowflake.module.ts
│   ├── snowflake.service.ts           # Connection pool manager
│   ├── snowflake-entity.repository.ts # Implements IEntityRepository
│   ├── snowflake-profile.repository.ts# Implements IProfileRepository
│   ├── snowflake-embedding.provider.ts# Implements IEmbeddingProvider
│   └── __tests__/
│
├── cache/                     # CacheModule
│   ├── cache.module.ts
│   ├── layered-cache.service.ts  # L0 → L1 chain (implements ICacheProvider)
│   ├── lru-cache.service.ts      # L0: in-process LRU (lru-cache npm)
│   ├── redis-cache.service.ts    # L1: Redis (ioredis npm)
│   └── __tests__/
│
└── health/                    # HealthModule
    ├── health.module.ts
    ├── health.controller.ts   # GET /health
    └── health.service.ts
```

### Dependency Injection Flow

```typescript
// 1. Define port interface (common/ports/)
export interface IEntityRepository {
  findById(entityId: string): Promise<Entity | null>;
  getCandidatesByEmbedding(...): Promise<Entity[]>;
}

// 2. Implement adapter (snowflake/)
@Injectable()
export class SnowflakeEntityRepository implements IEntityRepository {
  async findById(entityId: string): Promise<Entity | null> {
    // SQL query to Snowflake
  }
}

// 3. Register in module (snowflake.module.ts)
@Module({
  providers: [
    {
      provide: INJECTION_TOKENS.ENTITY_REPOSITORY,
      useClass: SnowflakeEntityRepository,
    },
  ],
  exports: [INJECTION_TOKENS.ENTITY_REPOSITORY],
})
export class SnowflakeModule {}

// 4. Inject in service (resolution.service.ts)
@Injectable()
export class ResolutionService {
  constructor(
    @Inject(INJECTION_TOKENS.ENTITY_REPOSITORY)
    private readonly entityRepo: IEntityRepository,  // ← interface only
  ) {}
}
```

**Key Benefit**: To swap Snowflake for Postgres, change ONE line in `SnowflakeModule` — nothing else.

---

## 4. Resolution Pipeline Deep Dive

### The 10-Stage Pipeline

Every call to `POST /profiles/:slug/resolve` flows through these stages:

```
┌──────────────────────────────────────────────────────────────────┐
│ Stage 0: Alias Check (if alias table exists)                     │
│ ────────────────────────────────────────────────────────────     │
│ SELECT entity_id FROM profile_entity_aliases                     │
│ WHERE profile_id = ? AND alias_name = LOWER(input)              │
│                                                                  │
│ If hit → return EXACT_MATCH (score=1.0) immediately             │
└──────────────────────────────────────────────────────────────────┘
         │ Miss
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 1: Cache Lookup (L0 → L1)                                  │
│ ────────────────────────────────────────────────────────────     │
│ cacheKey = buildCacheKey(profileId, fields, threshold)          │
│ cached = await cacheProvider.get(cacheKey)                      │
│                                                                  │
│ If hit → return cached result immediately (wasCached: true)     │
└──────────────────────────────────────────────────────────────────┘
         │ Miss
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 2: Fast-Path Check (SQL EXACT lookup on high-weight field)│
│ ────────────────────────────────────────────────────────────     │
│ For each field with:                                             │
│   • strategy = EXACT                                             │
│   • weight >= FAST_PATH_MIN_WEIGHT (3.0)                         │
│   • value present in input                                       │
│                                                                  │
│ Execute: SELECT * FROM profile_entities                          │
│          WHERE profile_id = ? AND                                │
│          LOWER(TRIM(field_values[?])) = LOWER(TRIM(?))           │
│                                                                  │
│ If match found → return EXACT_FASTPATH (score=1.0)              │
└──────────────────────────────────────────────────────────────────┘
         │ Miss
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 3: Generate Input Embeddings                               │
│ ────────────────────────────────────────────────────────────     │
│ For each field with strategy in [SEMANTIC, HYBRID]:             │
│   text = LOWER(TRIM(inputValue))                                │
│   embedding = SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', text)│
│                                                                  │
│ Batched: all embeddings generated in parallel via Promise.all() │
│ Returns: Map<fieldName, Float32Array(768)>                      │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 4: Retrieve Candidates                                     │
│ ────────────────────────────────────────────────────────────     │
│ If profile has SEMANTIC fields:                                  │
│   For each semantic field:                                       │
│     Execute ANN search:                                          │
│       SELECT entity_id, field_values,                            │
│              VECTOR_COSINE_SIMILARITY(emb.embedding, ?)          │
│       FROM profile_entities pe                                   │
│       JOIN profile_entity_embeddings emb USING (entity_id)       │
│       WHERE similarity >= 0.4                                    │
│       ORDER BY similarity DESC LIMIT 50                          │
│                                                                  │
│   Merge results, deduplicate by entity_id                        │
│   Attach similarity score to entity._scoringMetadata             │
│                                                                  │
│ Else (no semantic fields):                                       │
│   SELECT * FROM profile_entities WHERE profile_id = ?           │
│   LIMIT 500                                                      │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 5: Score All Candidates                                    │
│ ────────────────────────────────────────────────────────────     │
│ For each candidate entity:                                       │
│   For each active field (field in profile + field in input):    │
│     strategy = strategyRegistry.get(field.matchStrategy)        │
│                                                                  │
│     context = {                                                  │
│       inputEmbedding,                                            │
│       candidateEmbedding: null,  (not needed if ANN)            │
│       precomputedSimilarity: candidate._scoringMetadata[field], │
│       fieldConfig                                                │
│     }                                                            │
│                                                                  │
│     rawScore = strategy.score(inputValue, candidateValue, ctx)  │
│                                                                  │
│   Result: CandidateScore {                                       │
│     entity,                                                      │
│     fieldScores: FieldScore[]                                    │
│   }                                                              │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 6: Aggregate Scores                                        │
│ ────────────────────────────────────────────────────────────     │
│ For each candidate:                                              │
│   totalActiveWeight = SUM(field.weight for fields in input)     │
│   numerator = SUM(fieldScore.rawScore * field.weight)           │
│   compositeScore = numerator / totalActiveWeight                │
│                                                                  │
│   Populate normalizedWeight and weightedContribution on each    │
│   FieldScore for debugging                                       │
│                                                                  │
│ Sort candidates by compositeScore DESC                           │
│ Return top candidate                                             │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 7: Classify Match Type                                     │
│ ────────────────────────────────────────────────────────────     │
│ If compositeScore == 1.0:                                        │
│   → EXACT_MATCH                                                  │
│ Else if compositeScore >= threshold (default 0.95):             │
│   → HIGH_CONFIDENCE_MATCH                                        │
│ Else if compositeScore >= 0.5:                                  │
│   → LOW_CONFIDENCE_MATCH (route to Manual Review)               │
│ Else:                                                            │
│   → NO_MATCH (return NEW_ENTITY placeholder)                    │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 8: Cache Write (async, non-blocking)                       │
│ ────────────────────────────────────────────────────────────     │
│ cacheProvider.set(cacheKey, result, TTL=3600)                   │
│   → L0 (LRU) written synchronously                               │
│   → L1 (Redis) written asynchronously (fire-and-forget)         │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 9: Audit Logging (async, fire-and-forget)                 │
│ ────────────────────────────────────────────────────────────     │
│ auditLogger.log({                                                │
│   eventId, requestId, profileId, inputFields,                   │
│   matchedEntityId, matchScore, matchType, fieldScores,          │
│   executionMs, timestamp                                         │
│ })                                                               │
│                                                                  │
│ Never blocks response — errors logged but not thrown             │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ Stage 10: Return Result                                          │
│ ────────────────────────────────────────────────────────────     │
│ ResolveResult {                                                  │
│   requestId, entityId, displayName, matchScore, matchType,      │
│   fieldScores: { fieldName: rawScore },                         │
│   isNewEntity, wasCached, executionMs, resolvedAt               │
│ }                                                                │
└──────────────────────────────────────────────────────────────────┘
```

### Code Implementation

**resolution.service.ts** (simplified):

```typescript
async resolve(request: ResolveRequest, profile: Profile): Promise<ResolveResult> {
  const startTime = Date.now();
  
  // Stage 1: Cache
  const cached = await this.cacheProvider.get(cacheKey);
  if (cached) return { ...cached, wasCached: true };

  // Stage 2: Fast-path
  const fastPath = await this.fastPathChecker.check(profile, request.fields);
  if (fastPath) return this.finalise(fastPath, ...);

  // Stage 3: Embeddings
  const inputEmbeddings = await this.embeddingFetcher.fetchInputEmbeddings(
    request.fields, profile.semanticFields
  );

  // Stage 4: Candidates
  const candidates = await this.candidateRetriever.getCandidates(
    profile, request.fields, inputEmbeddings
  );

  if (candidates.length === 0) {
    return this.handleNoMatch(...);
  }

  // Stages 5-7: Score, Aggregate, Classify
  const topCandidate = await this.scoreAndRankCandidates(
    candidates, profile, request.fields, inputEmbeddings
  );

  // Stages 8-10: Cache, Audit, Return
  return this.finalise(topCandidate, ...);
}
```

---

## 5. Data Flow

### Request → Response Flow

```
┌─────────────┐
│   Client    │  POST /profiles/supplier-dedup/resolve
│  (Gen3 / SF)│  { fields: { supplier_name: "Shanghai" }, source_system: "Gen3" }
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ NestJS HTTP Server (Fastify)                                     │
│  - Global ValidationPipe (class-validator)                       │
│  - Global ExceptionFilter (maps errors → HTTP status)            │
│  - LoggingInterceptor (logs request/response)                    │
│  - TimingInterceptor (tracks latency)                            │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ ResolutionController.resolve()                                   │
│  - Extracts slug from URL param                                  │
│  - Validates ResolveRequestDto                                   │
│  - Calls profilesService.getBySlug(slug)                         │
│  - Calls resolutionService.resolve(request, profile)             │
│  - Maps ResolveResult → ResolveResultDto                         │
│  - Returns 200 JSON                                              │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ ResolutionService.resolve()                                      │
│  - Runs 10-stage pipeline                                        │
│  - Returns ResolveResult (domain model)                          │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼ (parallel calls to infrastructure)
       │
    ┌──▼─────────────┐  ┌───────────────┐  ┌──────────────────┐
    │  Snowflake     │  │  Redis L1     │  │  In-Process LRU  │
    │  (entities +   │  │  (cache hits) │  │  (L0 cache)      │
    │   embeddings)  │  └───────────────┘  └──────────────────┘
    └────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Response                                                          │
│ {                                                                │
│   "request_id": "0c81bd05-...",                                  │
│   "entity_id": "9f38b6fe-9b3c-4f8b-ba99-eb6f7165c616",          │
│   "display_name": "Shanghai Electronics Supply Co",             │
│   "match_score": 0.8475328826,                                  │
│   "match_type": "SEMANTIC",                                      │
│   "field_scores": { "supplier_name": 0.8475328826 },            │
│   "is_new_entity": false,                                        │
│   "was_cached": false,                                           │
│   "execution_ms": 792,                                           │
│   "resolved_at": "2026-03-01T10:15:30.123Z"                     │
│ }                                                                │
└──────────────────────────────────────────────────────────────────┘
```

### Database Query Flow

**Fast-Path EXACT Lookup** (Stage 2):

```sql
SELECT 
    entity_id,
    profile_id,
    display_name,
    field_values,
    salesforce_id,
    gen3_id
FROM profile_entities
WHERE profile_id = ?
  AND is_active = TRUE
  AND LOWER(TRIM(field_values[?]::VARCHAR)) = LOWER(TRIM(?))
LIMIT 1;
```

**ANN Semantic Search** (Stage 4):

```sql
SELECT 
    pe.entity_id,
    pe.display_name,
    pe.field_values,
    VECTOR_COSINE_SIMILARITY(emb.embedding, ?) AS similarity
FROM profile_entities pe
INNER JOIN profile_entity_embeddings emb 
    ON pe.entity_id = emb.entity_id
WHERE pe.profile_id = ?
  AND pe.is_active = TRUE
  AND emb.field_name = ?
  AND similarity >= 0.4
ORDER BY similarity DESC
LIMIT 50;
```

**Entity Alias Lookup** (Stage 0):

```sql
SELECT entity_id, alias_name
FROM profile_entity_aliases
WHERE profile_id = ?
  AND alias_name = LOWER(TRIM(?))
  AND is_active = TRUE;
```

---

## 6. Port & Adapter Pattern

### What is a Port?

A **port** is an interface that defines a contract between the application core and the outside world.

**Example**: `IEntityRepository` (entity-repository.port.ts)

```typescript
export interface IEntityRepository {
  findById(entityId: string): Promise<Entity | null>;
  
  findByExactField(
    profileId: string, 
    fieldName: string, 
    value: string
  ): Promise<Entity | null>;
  
  getCandidatesByEmbedding(
    profileId: string,
    fieldName: string,
    embedding: Float32Array,
    topK: number,
    minSimilarity: number,
  ): Promise<Array<{ entity: Entity; similarity: number }>>;
  
  upsert(entity: Partial<Entity>): Promise<Entity>;
  
  listByProfile(
    profileId: string, 
    page: number, 
    pageSize: number
  ): Promise<PaginatedResult<Entity>>;
}
```

### What is an Adapter?

An **adapter** is a concrete implementation of a port for a specific technology.

**Example**: `SnowflakeEntityRepository` (snowflake-entity.repository.ts)

```typescript
@Injectable()
export class SnowflakeEntityRepository implements IEntityRepository {
  constructor(private readonly snowflakeService: SnowflakeService) {}

  async findById(entityId: string): Promise<Entity | null> {
    const rows = await this.snowflakeService.executeQuery<EntityRow>(
      'SELECT * FROM profile_entities WHERE entity_id = ?',
      [entityId]
    );
    return rows[0] ? this.mapRowToEntity(rows[0]) : null;
  }

  async getCandidatesByEmbedding(...): Promise<...> {
    const sql = `
      SELECT pe.*, VECTOR_COSINE_SIMILARITY(emb.embedding, ?) AS similarity
      FROM profile_entities pe
      JOIN profile_entity_embeddings emb USING (entity_id)
      WHERE ...
    `;
    const rows = await this.snowflakeService.executeQuery(sql, [embedding]);
    return rows.map(r => ({ entity: this.mapRow(r), similarity: r.SIMILARITY }));
  }
}
```

### Why This Matters

**Scenario**: You want to add PostgreSQL + pgvector support

**Before (tightly coupled)**:
- Change 50+ files
- Rewrite all SQL queries
- Update all service classes
- Rewrite tests

**After (port & adapter)**:
1. Create `PostgresEntityRepository implements IEntityRepository`
2. Change 1 line in `AppModule`:
   ```typescript
   providers: [
     { provide: INJECTION_TOKENS.ENTITY_REPOSITORY, useClass: PostgresEntityRepository }
   ]
   ```
3. Done. Zero changes to business logic.

### All Ports in the System

| Port | Purpose | Current Adapter(s) |
|------|---------|-------------------|
| `IEntityRepository` | Entity CRUD + search | `SnowflakeEntityRepository` |
| `IProfileRepository` | Profile CRUD | `SnowflakeProfileRepository` |
| `IEmbeddingProvider` | Generate embeddings | `SnowflakeCortexEmbeddingProvider` |
| `ICacheProvider` | Key-value cache | `LayeredCacheService` (L0+L1) |
| `IAuditLogger` | Audit trail | `AuditService` (writes to Snowflake) |
| `IMatchStrategy` | Field-level scoring | 7 strategies (EXACT, FUZZY, ...) |

---

## 7. Strategy Pattern for Matching

### The Strategy Interface

```typescript
export interface IMatchStrategy {
  readonly strategyName: MatchStrategy;  // 'EXACT' | 'FUZZY' | 'SEMANTIC' | ...
  
  score(input: string, candidate: string, context?: StrategyContext): number | Promise<number>;
  normalize(value: string): string;
  requiresEmbedding(): boolean;
  isAsync(): boolean;
}
```

### Strategy Registry

**strategies/strategy.registry.ts**:

```typescript
@Injectable()
export class StrategyRegistry {
  private readonly strategies = new Map<MatchStrategy, IMatchStrategy>();

  constructor() {
    // Register all built-in strategies at module init
    this.register(new ExactStrategy());
    this.register(new FuzzyStrategy());
    this.register(new PhoneticStrategy());
    this.register(new NumericStrategy());
    this.register(new SemanticStrategy(...));
    this.register(new HybridStrategy(...));
    this.register(new NoneStrategy());
  }

  register(strategy: IMatchStrategy): void {
    this.strategies.set(strategy.strategyName, strategy);
  }

  get(name: MatchStrategy): IMatchStrategy {
    const strategy = this.strategies.get(name);
    if (!strategy) throw new Error(`No strategy for '${name}'`);
    return strategy;
  }
}
```

### Example Strategy: FUZZY

**strategies/fuzzy.strategy.ts**:

```typescript
export class FuzzyStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'FUZZY';

  score(input: string, candidate: string): number {
    const a = this.normalize(input);
    const b = this.normalize(candidate);
    if (a.length === 0 || b.length === 0) return 0;

    const maxLen = Math.max(a.length, b.length);
    const distance = this.levenshtein(a, b);
    return 1 - distance / maxLen;
  }

  normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  requiresEmbedding(): boolean {
    return false;
  }

  isAsync(): boolean {
    return false;
  }

  private levenshtein(a: string, b: string): number {
    // Edit distance calculation (Wagner-Fischer algorithm)
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }
    return matrix[a.length][b.length];
  }
}
```

### Example Strategy: SEMANTIC

**strategies/semantic.strategy.ts**:

```typescript
export class SemanticStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'SEMANTIC';

  score(_input: string, _candidate: string, context?: StrategyContext): number {
    // Optimization: use pre-computed similarity from ANN search
    if (context?.precomputedSimilarity !== undefined) {
      return context.precomputedSimilarity;
    }

    // Fallback: compute cosine similarity in-process
    if (!context?.inputEmbedding || !context?.candidateEmbedding) {
      return 0;
    }

    return this.cosineSimilarity(
      context.inputEmbedding,
      context.candidateEmbedding
    );
  }

  normalize(value: string): string {
    return value.trim().toLowerCase();  // Must match embedding text normalization
  }

  requiresEmbedding(): boolean {
    return true;
  }

  isAsync(): boolean {
    return false;  // Embeddings pre-fetched, cosine math is sync
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] ** 2;
      normB += b[i] ** 2;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return Math.max(0, Math.min(1, dotProduct / denominator));
  }
}
```

### Adding a New Strategy

**Example**: Add Jaro-Winkler distance

1. **Create the strategy class**:

```typescript
// strategies/jaro-winkler.strategy.ts
export class JaroWinklerStrategy implements IMatchStrategy {
  readonly strategyName: MatchStrategy = 'JARO_WINKLER';

  score(input: string, candidate: string): number {
    const a = this.normalize(input);
    const b = this.normalize(candidate);
    return this.jaroWinkler(a, b);
  }

  normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  requiresEmbedding(): boolean {
    return false;
  }

  isAsync(): boolean {
    return false;
  }

  private jaroWinkler(a: string, b: string): number {
    // Implementation...
  }
}
```

2. **Register in StrategyRegistry**:

```typescript
// strategies/strategy.registry.ts
constructor() {
  this.register(new JaroWinklerStrategy());  // ← One line
}
```

3. **Update MatchStrategy enum**:

```typescript
// common/models/profile.model.ts
export type MatchStrategy = 
  | 'EXACT' 
  | 'FUZZY' 
  | 'JARO_WINKLER'  // ← Add here
  | 'PHONETIC'
  | ...
```

4. **Done.** The strategy is now usable in profile field configs.

---

## 8. Caching Strategy

### Two-Layer Cache (L0 + L1)

```
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│                                                              │
│  ResolutionService.resolve()                                 │
│      ↓                                                       │
│  cacheProvider.get(cacheKey)                                │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│            LayeredCacheService (ICacheProvider)             │
│                                                              │
│  get(key):                                                   │
│    1. Check L0 (LRU) → if hit, return immediately           │
│    2. Check L1 (Redis) → if hit:                            │
│         - populate L0                                        │
│         - return value                                       │
│    3. Return null (cache miss)                              │
│                                                              │
│  set(key, value, ttl):                                       │
│    1. Write to L0 immediately (sync)                         │
│    2. Write to L1 asynchronously (non-blocking)             │
└────┬───────────────────────────────────┬──────────────────┘
     │                                   │
     ▼                                   ▼
┌────────────────────┐      ┌────────────────────────┐
│  L0: LRU Cache     │      │  L1: Redis Cache       │
│  (in-process)      │      │  (shared, persistent)  │
│                    │      │                        │
│  • Max: 1000 keys  │      │  • TTL: 3600s          │
│  • LRU eviction    │      │  • Survives restart    │
│  • 0ms latency     │      │  • 1-2ms latency       │
│  • Per Node.js     │      │  • Shared across pods  │
│    instance        │      │                        │
└────────────────────┘      └────────────────────────┘
```

### Cache Key Construction

**resolution.helpers.ts**:

```typescript
export function buildCacheKey(
  profileId: string,
  fields: Record<string, string>,
  threshold: number,
): string {
  // Normalize field values and sort by key for consistent cache keys
  const normalized = Object.entries(fields)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([k, v]) => `${k.toLowerCase()}:${v.toLowerCase().trim()}`)
    .join('|');

  return `resolve:${profileId}:${threshold}:${normalized}`;
}

// Example:
// buildCacheKey('PROF-001', { supplier_name: 'Shanghai', tax_id: 'CN123' }, 0.7)
// → 'resolve:PROF-001:0.7:supplier_name:shanghai|tax_id:cn123'
```

### Cache TTL & Invalidation

| Scenario | TTL | Invalidation Strategy |
|----------|-----|----------------------|
| **Resolution result** | 3600s (1 hour) | Flushed after hourly entity sync |
| **Profile config** | 3600s (1 hour) | Invalidated on profile update |
| **Entity by ID** | Not cached | Always fresh read |
| **ANN candidates** | Not cached | Computed per request |

**Why 1 hour?**
- Entity data syncs from Salesforce/Gen3 every hour
- After sync, EmbeddingRefreshJob regenerates embeddings
- After embeddings, CacheRefreshJob flushes Redis: `redis-cli FLUSHALL`
- New queries get fresh data from updated entity table

### Cache Performance

| Metric | L0 (LRU) | L1 (Redis) |
|--------|----------|------------|
| **Hit latency** | <1ms | 1-2ms |
| **Miss latency** | <1ms | 1-2ms |
| **Write latency** | <1ms | ~5ms (async) |
| **Hit rate** | ~60% | ~35% |
| **Capacity** | 1000 keys/process | Unlimited (memory constrained) |

**Total cache hit rate**: ~95% (L0 + L1 combined)

---

## 9. Database Schema & Queries

### Core Tables

#### `resolution_profiles`

| Column | Type | Description |
|--------|------|-------------|
| `profile_id` | VARCHAR(36) PK | UUID |
| `profile_name` | VARCHAR(200) | 'Supplier Dedup', 'Buyer Match' |
| `profile_slug` | VARCHAR(100) UNIQUE | 'supplier-dedup', 'b2b-buyer' |
| `entity_type` | VARCHAR(50) | 'SUPPLIER', 'BUYER', ... |
| `default_threshold` | DECIMAL(3,2) | 0.95 (threshold for HIGH_CONFIDENCE) |
| `description` | TEXT | Human-readable description |
| `is_active` | BOOLEAN | FALSE = soft-deleted |
| `created_at` | TIMESTAMP_NTZ | |
| `updated_at` | TIMESTAMP_NTZ | |

#### `profile_fields`

| Column | Type | Description |
|--------|------|-------------|
| `field_id` | VARCHAR(36) PK | UUID |
| `profile_id` | VARCHAR(36) FK | → resolution_profiles |
| `field_name` | VARCHAR(100) | 'supplier_name', 'tax_id', ... |
| `field_label` | VARCHAR(200) | Display name for UI |
| `field_order` | INTEGER | Sort order in form |
| `is_required` | BOOLEAN | Validation rule |
| `is_primary_display` | BOOLEAN | Used in displayName |
| `match_strategy` | VARCHAR(20) | 'EXACT', 'FUZZY', 'SEMANTIC', ... |
| `weight` | DECIMAL(4,2) | Importance (0-10) |
| `strategy_config` | VARIANT | JSON config (e.g., `{"model": "e5-base-v2"}`) |

#### `profile_entities`

| Column | Type | Description |
|--------|------|-------------|
| `entity_id` | VARCHAR(36) PK | UUID |
| `profile_id` | VARCHAR(36) FK | → resolution_profiles |
| `display_name` | VARCHAR(500) | Primary name (e.g., company name) |
| `field_values` | VARIANT | JSON: all field values (`{supplier_name: "...", tax_id: "..."}`) |
| `salesforce_id` | VARCHAR(50) | External ID from Salesforce |
| `gen3_id` | VARCHAR(50) | External ID from Gen3 |
| `source_system` | VARCHAR(20) | 'Salesforce', 'Gen3', 'Manual' |
| `version` | INTEGER | Optimistic locking |
| `is_active` | BOOLEAN | FALSE = soft-deleted |
| `created_at` | TIMESTAMP_NTZ | |
| `updated_at` | TIMESTAMP_NTZ | |
| `last_synced_at` | TIMESTAMP_NTZ | Last ETL watermark |

#### `profile_entity_embeddings`

| Column | Type | Description |
|--------|------|-------------|
| `embedding_id` | VARCHAR(36) PK | UUID |
| `entity_id` | VARCHAR(36) FK | → profile_entities |
| `profile_id` | VARCHAR(36) FK | → resolution_profiles |
| `field_name` | VARCHAR(100) | Which field this embedding represents |
| `source_text` | VARCHAR(2000) | Normalized text that was embedded (for debugging) |
| `embedding` | VECTOR(FLOAT, 768) | e5-base-v2 embedding |
| `model_version` | VARCHAR(50) | 'e5-base-v2' |
| `created_at` | TIMESTAMP_NTZ | |

**Index**: `(entity_id, field_name)` for fast join during ANN search

#### `profile_entity_aliases`

| Column | Type | Description |
|--------|------|-------------|
| `alias_id` | VARCHAR(36) PK | UUID |
| `entity_id` | VARCHAR(36) FK | → profile_entities (the canonical entity) |
| `profile_id` | VARCHAR(36) FK | → resolution_profiles |
| `alias_name` | VARCHAR(500) | Normalized alias text (lowercase) |
| `alias_type` | VARCHAR(20) | 'MANUAL_REVIEW', 'BULK_IMPORT', 'API' |
| `created_by` | VARCHAR(100) | User ID or system identifier |
| `is_active` | BOOLEAN | FALSE = soft-deleted |
| `created_at` | TIMESTAMP_NTZ | |

**Index**: `(profile_id, alias_name)` for fast lookup in Stage 0

#### `profile_match_log`

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | VARCHAR(36) PK | UUID |
| `request_id` | VARCHAR(36) | Correlation ID from client |
| `profile_id` | VARCHAR(36) FK | |
| `input_fields` | VARIANT | JSON of input field values |
| `matched_entity_id` | VARCHAR(36) | NULL if NO_MATCH |
| `match_score` | DECIMAL(5,4) | Composite score [0, 1] |
| `match_type` | VARCHAR(30) | 'EXACT', 'HIGH_CONFIDENCE', 'LOW_CONFIDENCE', 'NO_MATCH' |
| `field_scores` | VARIANT | JSON: per-field raw scores |
| `threshold_used` | DECIMAL(3,2) | Threshold at resolution time |
| `execution_ms` | INTEGER | Pipeline latency |
| `was_cached` | BOOLEAN | Cache hit/miss |
| `source_system` | VARCHAR(20) | 'Salesforce', 'Gen3', 'AdminUI' |
| `created_at` | TIMESTAMP_NTZ | |

**Purpose**: Audit trail for compliance, debugging, and analytics

---

## 10. API Layer

### REST Endpoints

#### **Profile Management**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/profiles` | List all active profiles |
| POST | `/profiles` | Create a new profile |
| GET | `/profiles/:slug` | Get profile by slug |
| PUT | `/profiles/:slug` | Update profile config |
| DELETE | `/profiles/:slug` | Soft-delete profile |

#### **Entity Resolution** (Primary API)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/profiles/:slug/resolve` | Resolve single entity |
| POST | `/profiles/:slug/resolve/batch` | Batch resolve (50 entities) |
| POST | `/profiles/:slug/find-similar` | Get all candidates above threshold |

#### **Entity Management**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/profiles/:slug/entities` | List entities (paginated) |
| GET | `/profiles/:slug/entities/:id` | Get entity by ID |
| PUT | `/profiles/:slug/entities/:id` | Update entity |
| POST | `/profiles/:slug/entities/bulk` | Bulk import entities |
| DELETE | `/profiles/:slug/entities/:id` | Soft-delete entity |

#### **Entity Aliases** (Manual Review)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/profiles/:slug/aliases` | List aliases |
| POST | `/profiles/:slug/aliases` | Create alias (after manual review) |
| DELETE | `/profiles/:slug/aliases/:id` | Delete alias |

#### **Health & Observability**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Health check (Snowflake + Redis) |
| GET | `/stats` | Resolution statistics |

### Request/Response Examples

#### **POST /profiles/:slug/resolve**

**Request**:
```json
{
  "fields": {
    "supplier_name": "Shanghai Supply",
    "tax_id": "CN12345"
  },
  "source_system": "Gen3",
  "correlation_id": "txn-abc-123"
}
```

**Response (SEMANTIC match)**:
```json
{
  "request_id": "7ad9a4ec-df4e-420f-9d2a-9f5f70cf344e",
  "entity_id": "9f38b6fe-9b3c-4f8b-ba99-eb6f7165c616",
  "display_name": "Shanghai Electronics Supply Co",
  "match_score": 0.9354,
  "match_type": "SEMANTIC",
  "field_scores": {
    "supplier_name": 0.9354,
    "tax_id": 1.0
  },
  "is_new_entity": false,
  "is_authoritative": false,
  "was_cached": false,
  "execution_ms": 792,
  "resolved_at": "2026-03-01T10:15:30.123Z"
}
```

**Response (NO_MATCH → suggests new entity)**:
```json
{
  "request_id": "a1b2c3d4-...",
  "entity_id": null,
  "display_name": "Unknown Supplier",
  "match_score": 0.42,
  "match_type": "NO_MATCH",
  "field_scores": {
    "supplier_name": 0.42,
    "tax_id": 0.0
  },
  "is_new_entity": true,
  "is_authoritative": false,
  "was_cached": false,
  "execution_ms": 650,
  "resolved_at": "2026-03-01T10:20:45.678Z"
}
```

### Error Responses

| Status | Error Type | Example |
|--------|------------|---------|
| 400 | Bad Request | Invalid field values, missing required field |
| 404 | Not Found | Profile slug doesn't exist |
| 422 | Validation Error | Field value exceeds max length |
| 429 | Rate Limit | Too many requests (throttler) |
| 500 | Internal Error | Snowflake connection failure |
| 503 | Service Unavailable | Redis cache down (degraded mode) |

**Example 404**:
```json
{
  "statusCode": 404,
  "message": "Profile 'invalid-slug' not found or inactive",
  "error": "Not Found",
  "path": "/profiles/invalid-slug/resolve",
  "timestamp": "2026-03-01T10:25:00.000Z"
}
```

---

## 11. Performance Considerations

### Latency Breakdown

**Typical request latency**: ~800ms (p50), ~1200ms (p95)

| Stage | Latency (p50) | Latency (p95) | Notes |
|-------|---------------|---------------|-------|
| Cache lookup (L0) | <1ms | <1ms | In-process LRU |
| Cache lookup (L1) | 1-2ms | 5ms | Redis network |
| Fast-path SQL | 15ms | 30ms | Single row lookup |
| Embedding generation | 150ms | 250ms | Cortex API (1 field) |
| ANN search | 80ms | 150ms | VECTOR_COSINE_SIMILARITY + LIMIT 50 |
| In-process scoring | 5ms | 10ms | 50 candidates × 3 fields |
| Score aggregation | <1ms | 1ms | Pure math |
| Cache write (L0+L1) | 2ms | 10ms | L1 async |
| Audit log | <1ms | 1ms | Fire-and-forget |

**Optimizations in place**:
1. **L0 cache (LRU)** eliminates Snowflake calls for 60% of requests
2. **Fast-path** skips embeddings for EXACT high-weight matches (e.g., TAX_ID)
3. **ANN search** limits candidates to 50 instead of full table scan
4. **Precomputed ANN similarity** avoids redundant cosine calculation in scoring
5. **Parallel embedding generation** uses `Promise.all()` for multi-field inputs
6. **Async cache write** doesn't block response (L1 Redis write is fire-and-forget)
7. **Async audit logging** never blocks resolution pipeline

### Scalability

**Horizontal scaling**:
- Each Node.js process is stateless (except L0 cache)
- Load balancer distributes requests across N pods
- Redis L1 cache is shared — cache hits benefit all pods
- Snowflake auto-scales via warehouse size

**Throughput**:
- Single Node.js process: ~200 req/s (cache-heavy traffic)
- Single Node.js process: ~50 req/s (cache-cold, all Snowflake)
- With 4 pods: ~800 req/s sustained

**Database scaling**:
- Snowflake warehouse: `MEDIUM` (8 cores) handles 500 concurrent queries
- Entity table size: 100K entities = ~50MB (VARIANT storage)
- Embedding table: 100K × 768 floats × 2 fields = ~600MB
- Query scales: O(log N) for ANN search (Snowflake vector index)

### Memory Usage

| Component | Memory (per pod) |
|-----------|------------------|
| Node.js runtime | ~300MB |
| L0 LRU cache (1000 keys) | ~50MB |
| Strategy registry | ~5MB |
| Profile cache | ~10MB |
| Total (idle) | ~400MB |
| Peak (under load) | ~600MB |

---

## 12. Testing Strategy

### Testing Pyramid

```
          ┌─────────┐
          │  E2E    │  Contract Tests (Pact)
          │ (Pact)  │  - UI ↔ API contract
          └─────────┘  - Runs on CI before deploy
              ▲
         ┌────┴────┐
         │ Integration│  Supertest + NestJS TestingModule
         │  Tests     │  - Controller → Service → mocked repo
         └───────────┘  - 30s total runtime
              ▲
        ┌─────┴──────┐
        │ Unit Tests  │  Jest + pure TypeScript
        │ (majority)  │  - Every strategy, aggregator, classifier
        └─────────────┘  - Zero I/O, <1s total runtime
```

### Unit Test Example

**strategies/__tests__/fuzzy.strategy.spec.ts**:

```typescript
describe('FuzzyStrategy', () => {
  let strategy: FuzzyStrategy;

  beforeEach(() => {
    strategy = new FuzzyStrategy();  // No DI needed — pure class
  });

  describe('score()', () => {
    it('returns 1.0 for identical strings', () => {
      expect(strategy.score('acme corp', 'acme corp')).toBe(1.0);
    });

    it('is case-insensitive', () => {
      expect(strategy.score('ACME Corp', 'acme corp')).toBe(1.0);
    });

    it('returns 0.75 for one character difference', () => {
      // "acme" vs "acm" → 1 edit / max(4,3) = 0.75
      expect(strategy.score('acme', 'acm')).toBeCloseTo(0.75, 2);
    });

    it('returns 0 for completely different strings', () => {
      expect(strategy.score('xyz', 'abc')).toBe(0);
    });

    it('returns 0 when either value is empty', () => {
      expect(strategy.score('', 'acme')).toBe(0);
      expect(strategy.score('acme', '')).toBe(0);
    });
  });
});
```

**Key**: Pure functions with no I/O → instant tests, no mocks, 100% code coverage.

### Integration Test Example

**resolution/__tests__/resolution.controller.spec.ts**:

```typescript
describe('ResolutionController (integration)', () => {
  let app: INestApplication;
  let entityRepo: jest.Mocked<IEntityRepository>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ResolutionModule, ProfilesModule, StrategiesModule],
    })
      .overrideProvider(INJECTION_TOKENS.ENTITY_REPOSITORY)
      .useValue(createMock<IEntityRepository>())
      .overrideProvider(INJECTION_TOKENS.CACHE_PROVIDER)
      .useValue(createMock<ICacheProvider>())
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    entityRepo = module.get(INJECTION_TOKENS.ENTITY_REPOSITORY);
  });

  afterAll(() => app.close());

  describe('POST /profiles/:slug/resolve', () => {
    it('returns 200 with match result', async () => {
      entityRepo.findByExactField.mockResolvedValue(
        buildMockEntity({ entityId: 'ENT-001', displayName: 'ACME Corp' })
      );

      const res = await request(app.getHttpServer())
        .post('/profiles/supplier-dedup/resolve')
        .send({
          fields: { supplier_name: 'ACME', tax_id: '12345' },
          source_system: 'AdminUI',
        });

      expect(res.status).toBe(200);
      expect(res.body.match_type).toBe('EXACT_FASTPATH');
      expect(res.body.match_score).toBe(1.0);
    });

    it('returns 404 when profile not found', async () => {
      const res = await request(app.getHttpServer())
        .post('/profiles/invalid-slug/resolve')
        .send({ fields: { name: 'test' }, source_system: 'AdminUI' });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });
  });
});
```

### Contract Test Example

**UI consumer**:
```typescript
// ui/src/__tests__/pact/resolve.pact.spec.ts
describe('Pact — /profiles/:slug/resolve', () => {
  const provider = new PactV3({ consumer: 'resolveiq-ui', provider: 'resolveiq-api' });

  it('returns resolve result for a matched entity', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'supplier-dedup profile exists with ACME entity' }],
        uponReceiving: 'a resolve request',
        withRequest: {
          method: 'POST',
          path: '/profiles/supplier-dedup/resolve',
          body: { fields: { supplier_name: 'ACME' }, source_system: 'AdminUI' },
        },
        willRespondWith: {
          status: 200,
          body: MatchersV3.like({
            entity_id: MatchersV3.uuid(),
            match_score: MatchersV3.decimal(0.95),
            match_type: MatchersV3.string('EXACT'),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const result = await resolveEntity(mockServer.url, 'supplier-dedup', {
          fields: { supplier_name: 'ACME' },
          source_system: 'AdminUI',
        });
        expect(result.match_type).toBe('EXACT');
      });
  });
});
```

---

## 13. Design Patterns in Use

| Pattern | Where | Why |
|---------|-------|-----|
| **Hexagonal (Ports & Adapters)** | All infrastructure | Swappable database, cache, embedding provider |
| **Strategy** | Matching algorithms | Pluggable scoring logic (EXACT, FUZZY, SEMANTIC) |
| **Repository** | Data access | Abstract SQL/NoSQL behind interface |
| **Pipeline** | Resolution flow | 10 sequential stages with clear boundaries |
| **Factory** | StrategyRegistry | Centralized strategy creation and registration |
| **Dependency Injection** | All modules | NestJS IoC container for loose coupling |
| **Observer** | Audit logging | Fire-and-forget event emission |
| **Command** | Batch processing | Encapsulate resolution request as object |
| **Facade** | ResolutionService | Simplify complex pipeline behind one method |
| **Adapter** | Snowflake/Redis clients | Wrap external libraries with our interfaces |

---

## 14. Common Development Tasks

### Task 1: Add a New Matching Strategy

**Example**: Add Jaro-Winkler distance

1. Create strategy class:
   ```bash
   touch engine/src/strategies/jaro-winkler.strategy.ts
   ```

2. Implement interface:
   ```typescript
   export class JaroWinklerStrategy implements IMatchStrategy {
     readonly strategyName: MatchStrategy = 'JARO_WINKLER';
     score(input, candidate) { /* ... */ }
     normalize(value) { return value.trim().toLowerCase(); }
     requiresEmbedding() { return false; }
     isAsync() { return false; }
   }
   ```

3. Register in module:
   ```typescript
   // strategies/strategies.module.ts
   @Module({
     providers: [
       StrategyRegistry,
       { provide: JaroWinklerStrategy, useClass: JaroWinklerStrategy },
     ],
   })
   export class StrategiesModule {
     constructor(registry: StrategyRegistry, jaroWinkler: JaroWinklerStrategy) {
       registry.register(jaroWinkler);
     }
   }
   ```

4. Update enum:
   ```typescript
   // common/models/profile.model.ts
   export type MatchStrategy = 'EXACT' | 'FUZZY' | 'JARO_WINKLER' | ...
   ```

5. Write tests:
   ```bash
   touch engine/src/strategies/__tests__/jaro-winkler.strategy.spec.ts
   ```

6. Done. Use in profile field config:
   ```json
   { "field_name": "name", "match_strategy": "JARO_WINKLER", "weight": 5.0 }
   ```

### Task 2: Add a New Database Adapter

**Example**: Add PostgreSQL + pgvector support

1. Create adapter:
   ```bash
   mkdir engine/src/postgres
   touch engine/src/postgres/postgres-entity.repository.ts
   ```

2. Implement interface:
   ```typescript
   @Injectable()
   export class PostgresEntityRepository implements IEntityRepository {
     async findById(entityId: string): Promise<Entity | null> {
       // Use pg client, run SELECT with pgvector extension
     }
     async getCandidatesByEmbedding(...): Promise<...> {
       // Use pgvector: SELECT ... ORDER BY embedding <-> ?::vector LIMIT 50
     }
   }
   ```

3. Create module:
   ```typescript
   @Module({
     providers: [
       { provide: INJECTION_TOKENS.ENTITY_REPOSITORY, useClass: PostgresEntityRepository },
     ],
     exports: [INJECTION_TOKENS.ENTITY_REPOSITORY],
   })
   export class PostgresModule {}
   ```

4. Swap in app.module.ts:
   ```typescript
   @Module({
     imports: [
       PostgresModule,  // ← Instead of SnowflakeModule
       CacheModule,
       StrategiesModule,
       ResolutionModule,
     ],
   })
   export class AppModule {}
   ```

5. Done. Zero changes to business logic.

### Task 3: Add a Custom Pipeline Stage

**Example**: Add fraud detection check before returning match

1. Create checker class:
   ```typescript
   // resolution/pipeline/fraud.checker.ts
   @Injectable()
   export class FraudChecker {
     async check(entity: Entity, inputFields: Record<string, string>): Promise<boolean> {
       // Call external fraud API
     }
   }
   ```

2. Inject in ResolutionService:
   ```typescript
   constructor(
     private readonly fraudChecker: FraudChecker,
     ...
   ) {}
   ```

3. Add stage in pipeline:
   ```typescript
   async resolve(...) {
     // ... stages 1-7
     const isFraud = await this.fraudChecker.check(topCandidate.entity, request.fields);
     if (isFraud) return this.handleFraudDetected(...);
     // ... stages 8-10
   }
   ```

4. Done. Pipeline extended without modifying existing stages.

### Task 4: Debug a Slow Query

1. Enable query logging:
   ```typescript
   // snowflake/snowflake.service.ts
   async executeQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
     const start = Date.now();
     const result = await this.connection.execute({ sqlText: sql, binds: params });
     this.logger.debug(`Query took ${Date.now() - start}ms: ${sql.substring(0, 80)}`);
     return result.rows;
   }
   ```

2. Check logs for slow stage:
   ```bash
   npm run start:dev | grep "Query took"
   ```

3. Identify bottleneck (e.g., ANN search taking 500ms)

4. Optimize:
   - Increase `LIMIT` to reduce candidates
   - Raise `minSimilarity` threshold
   - Add vector index to embedding table
   - Cache ANN results in Redis

### Task 5: Add a New API Endpoint

**Example**: GET /profiles/:slug/stats

1. Add DTO:
   ```typescript
   // profiles/dto/profile-stats.dto.ts
   export class ProfileStatsDto {
     readonly entityCount: number;
     readonly resolutionCount: number;
     readonly avgMatchScore: number;
   }
   ```

2. Add service method:
   ```typescript
   // profiles/profiles.service.ts
   async getStats(profileId: string): Promise<ProfileStatsDto> {
     // Query Snowflake for aggregates
   }
   ```

3. Add controller endpoint:
   ```typescript
   // profiles/profiles.controller.ts
   @Get(':slug/stats')
   @ApiOperation({ summary: 'Get profile statistics' })
   @ApiResponse({ status: 200, type: ProfileStatsDto })
   async getStats(@Param('slug') slug: string): Promise<ProfileStatsDto> {
     const profile = await this.profilesService.getBySlug(slug);
     return this.profilesService.getStats(profile.id);
   }
   ```

4. Test:
   ```bash
   curl http://localhost:8001/profiles/supplier-dedup/stats
   ```

5. Done. OpenAPI spec auto-updated at /api.

---

## Conclusion

This document provides the **low-level architecture knowledge** needed to:
- ✅ Understand the resolution pipeline (10 stages)
- ✅ Extend matching strategies (add new algorithms)
- ✅ Swap infrastructure adapters (database, cache, embeddings)
- ✅ Debug performance issues (latency breakdown)
- ✅ Write tests at every layer (unit, integration, contract)
- ✅ Add new API endpoints (following NestJS conventions)
- ✅ Navigate the codebase (module structure, ports vs adapters)

**Key Takeaways**:
1. **Hexagonal architecture** = business logic doesn't know about Snowflake
2. **Strategy pattern** = matching algorithms are pluggable
3. **Pipeline pattern** = 10 clear stages from cache to audit
4. **Caching (L0+L1)** = 95% cache hit rate, sub-second response
5. **Port & Adapter** = swap databases without touching services
6. **Pure domain logic** = 100% unit-testable, zero I/O
7. **NestJS DI** = loosely coupled, mockable, scalable

**Next Steps**:
- Read [CLAUDE.md](../CLAUDE.md) for coding standards
- Read [ARCHITECTURE_PROPOSAL_NODEJS.md](../ARCHITECTURE_PROPOSAL_NODEJS.md) for v1→v2 migration rationale
- Run the test suite: `npm test` (unit) + `npm run test:e2e` (integration)
- Start the server: `npm run start:dev` and hit http://localhost:8001/api (Swagger UI)
- Read the resolution pipeline code: [resolution/resolution.service.ts](../engine/src/resolution/resolution.service.ts)

**Questions?** 
- Check inline TSDoc comments in source files
- Review strategy implementations in `engine/src/strategies/`
- Inspect integration tests in `engine/src/__tests__/`

---

**Document Version**: 1.0.0  
**Last Updated**: March 1, 2026  
**Maintainer**: Engineering Team  
**Feedback**: Submit PRs to improve this document
