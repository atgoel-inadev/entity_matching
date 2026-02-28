# ResolveIQ v2: Node.js-First Architecture Proposal
## From Snowflake-Coupled to Modular, Extensible, Provider-Agnostic Engine

---

## 1. Executive Summary

The current ResolveIQ v1 implementation places **all core intelligence inside Snowflake**: matching algorithms, scoring logic, candidate retrieval, cache management, and entity creation are encoded as SQL UDFs and stored procedures (`resolve_entity`, `resolve_and_upsert`, `compute_field_score`, `hybrid_entity_match`, etc.).

This creates a tight coupling where:
- Changing a matching algorithm requires Snowflake DDL changes
- Adding a new strategy (e.g., ML-based re-ranking) requires a new Snowflake UDF
- Testing matching logic requires a live Snowflake connection
- Swapping the embedding provider (Cortex → OpenAI → local model) means rewriting SQL procedures
- The Python FastAPI layer is a thin passthrough — not where intelligence lives

**ResolveIQ v2** extracts all matching intelligence into a **Node.js TypeScript engine** using hexagonal architecture (ports & adapters). Snowflake retains only what it does uniquely well: **embedding generation and vector storage**. Everything else — scoring, composite calculation, match classification, pipeline orchestration, cache strategy, batch processing — moves to Node.js where it can be tested, versioned, swapped, and extended without touching a database.

---

## 2. Current Architecture: What's Wrong

### 2.1 Logic Inventory (Current v1)

| Component | Currently In | Problem |
|---|---|---|
| EXACT scoring | SQL UDF `compute_field_score` | No unit tests, SQL-only evolution |
| FUZZY scoring (Levenshtein) | SQL `EDITDISTANCE()` in UDF | Cannot swap algorithm (e.g., Jaro-Winkler, Indel) |
| PHONETIC scoring | SQL `SOUNDEX()` in UDF | SOUNDEX only — no Double Metaphone, NYSIIS |
| NUMERIC normalization | SQL string ops in UDF | Brittle regex in SQL |
| SEMANTIC scoring | SQL `EMBED_TEXT_768 + VECTOR_COSINE_SIMILARITY` | Both embedding AND cosine similarity locked to Snowflake |
| HYBRID scoring | SQL `0.4*fuzzy + 0.6*semantic` | Weights hardcoded in SQL |
| Composite score calc | SQL `SUM(score*weight)/SUM(weights)` in UDTF | Cannot A/B test scoring formulas |
| Match type classification | SQL CASE statement in UDTF | Business rule changes = DDL change |
| Fast-path logic | SQL in `resolve_and_upsert` procedure | Cannot unit test |
| Cache read/write | SQL MERGE in stored procedure | L2 Snowflake cache adds latency |
| Entity creation (upsert) | SQL inside stored procedure | Atomic with DB — hard to extend |
| Batch processing | Sequential WHILE loop in SQL | Cannot parallelize in SQL |
| Audit logging | SQL INSERT in stored procedure | Mixed with business logic |
| Profile config management | Snowflake tables only | Cannot cache config efficiently in app layer |

### 2.2 Specific Pain Points

**Performance ceiling**: The UDTF `resolve_entity` does a CROSS JOIN of all candidates × all active fields inside Snowflake. For 100K entities, this is a full-table scoring operation per query. A Node.js pipeline with candidate pre-filtering can score 50 candidates with millisecond-level in-process algorithms.

**Testing impossibility**: The matching logic lives in `LANGUAGE SQL` UDFs. You cannot unit test `compute_field_score('IBM', 'International Business Machines', 'SEMANTIC')` without a Snowflake connection and live Cortex credits.

**Strategy rigidity**: Adding "Jaro-Winkler distance" requires adding a new SQL UDF, modifying the CASE statement in `compute_field_score`, and adding a new enum value. In Node.js: implement `JaroWinklerStrategy implements IMatchStrategy` and register it.

**Vendor lock**: Both `EMBED_TEXT_768('e5-base-v2', ...)` (embedding generation) AND `VECTOR_COSINE_SIMILARITY(...)` (cosine math) live in Snowflake. Cosine similarity is trivial math — there is no reason it must run in Snowflake.

---

## 3. Guiding Principles for v2

1. **Snowflake does what only Snowflake does**: embedding generation (Cortex AI) and vector storage/search. Nothing else.
2. **All business logic is Node.js**: scoring, classification, pipeline orchestration, cache strategy, batch processing.
3. **Hexagonal architecture (Ports & Adapters)**: the engine core depends on interfaces, not implementations. Swap Snowflake for Postgres+pgvector without changing engine code.
4. **Strategy pattern for matching**: each algorithm is an injectable, testable class.
5. **No SQL stored procedures for business logic**: SQL for data retrieval only (SELECT), not orchestration (CALL, MERGE, WHILE loops).
6. **Everything unit testable**: all matching logic runs in-process with no external dependencies.

---

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                  HTTP API Layer (Express/Fastify)             │
│   /profiles   /resolve   /entities   /health   /stats        │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                 Resolution Pipeline (Node.js)                 │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ FastPath    │  │  Candidate   │  │  Scoring Engine    │  │
│  │ Checker     │─>│  Retriever   │─>│                    │  │
│  │             │  │              │  │  ┌──────────────┐  │  │
│  └─────────────┘  └──────────────┘  │  │StrategyReg.  │  │  │
│         │                           │  │ EXACT        │  │  │
│         │ (fast-path hit)           │  │ FUZZY        │  │  │
│         ▼                           │  │ PHONETIC     │  │  │
│  ┌─────────────┐                    │  │ NUMERIC      │  │  │
│  │ Score       │                    │  │ SEMANTIC     │  │  │
│  │ Aggregator  │<───────────────────│  │ HYBRID       │  │  │
│  └─────────────┘                    │  │ [custom...]  │  │  │
│         │                           │  └──────────────┘  │  │
│         ▼                           └────────────────────┘  │
│  ┌─────────────┐                                            │
│  │ Match       │                                            │
│  │ Classifier  │                                            │
│  └─────────────┘                                            │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Cache Layer │  │ Entity       │  │  Audit Logger      │  │
│  │ (L0+L1)     │  │ Upsert       │  │                    │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────┬──────────────┬──────────────────────┬──────────┘
              │ Ports        │                      │
    ┌─────────▼──────┐  ┌───▼────────────┐  ┌──────▼─────────┐
    │ IEntityRepo    │  │ IEmbedding     │  │ IProfileRepo   │
    │ ICache         │  │ Provider       │  │ IAuditLogger   │
    └─────────┬──────┘  └───┬────────────┘  └──────┬─────────┘
              │ Adapters    │                       │
    ┌─────────▼──────┐  ┌───▼────────────┐  ┌──────▼─────────┐
    │ Snowflake      │  │ Snowflake      │  │ Postgres       │
    │ Entity Repo    │  │ Cortex Embed   │  │ Profile Repo   │
    │ (entities +    │  │ (ONLY Cortex   │  │ (or Snowflake) │
    │  embeddings)   │  │  remains here) │  │                │
    └────────────────┘  └────────────────┘  └────────────────┘
```

---

## 5. What Stays in Snowflake vs. What Moves to Node.js

### Stays in Snowflake (Data Layer Only)

| What | Why |
|---|---|
| `profile_entities` table | Entity field value storage (VARIANT/JSON, flexible schema) |
| `profile_entity_embeddings` table | VECTOR(FLOAT, 768) — native vector type |
| `EMBED_TEXT_768('e5-base-v2', text)` | Cortex AI — only reason to stay in Snowflake |
| `VECTOR_COSINE_SIMILARITY()` for **ANN candidate retrieval** | Server-side pre-filter: "give me top-50 semantically similar entities" |
| `profile_match_log` | Audit trail in data warehouse (analytics, compliance) |
| Monitoring views (`v_riq_*`) | BI/analytics on top of Snowflake data |

### Moves to Node.js Engine

| What | Currently | New Home |
|---|---|---|
| EXACT scoring | `compute_field_score` SQL UDF | `ExactStrategy.ts` |
| FUZZY scoring (Levenshtein) | `EDITDISTANCE()` SQL | `FuzzyStrategy.ts` (fastest-levenshtein) |
| PHONETIC scoring | `SOUNDEX()` SQL | `PhoneticStrategy.ts` (natural library) |
| NUMERIC normalization + match | SQL string ops | `NumericStrategy.ts` |
| Cosine similarity (scoring) | `VECTOR_COSINE_SIMILARITY()` SQL | `SemanticStrategy.ts` (in-process) |
| HYBRID weighting | Hardcoded `0.4*fuzzy + 0.6*semantic` SQL | `HybridStrategy.ts` (configurable) |
| Composite score calculation | SQL `SUM(score*weight)/SUM(weights)` | `ScoringAggregator.ts` |
| Match type classification | SQL CASE statement | `MatchClassifier.ts` |
| Fast-path EXACT field check | SQL in stored procedure | `FastPathChecker.ts` |
| Cache read/write orchestration | SQL MERGE in stored procedure | `CacheOrchestrator.ts` |
| Entity creation on miss | SQL INSERT in stored procedure | `EntityService.ts` |
| Batch processing | Sequential WHILE loop in SQL | `BatchProcessor.ts` (Promise.all) |
| Audit logging | SQL INSERT mixed with logic | `AuditLogger.ts` (async, non-blocking) |
| Profile config management | Snowflake tables | `ProfileService.ts` (with in-memory cache) |
| Weight normalization (partial match) | SQL inline | `ScoringAggregator.ts` |

### Removed Entirely

| What | Why |
|---|---|
| `profile_match_cache` (Snowflake L2 cache) | Replaced by Redis L1 + in-memory L0. Snowflake cache adds latency, not value. |
| `resolve_entity` UDTF | Logic now in Node.js pipeline |
| `resolve_and_upsert` stored procedure | Logic now in Node.js pipeline |
| `batch_resolve_and_upsert` stored procedure | Logic now in Node.js `BatchProcessor` |
| `bulk_load_entities` stored procedure | Logic now in Node.js `EntityService` |
| `compute_field_score` UDF | Logic now in strategy classes |
| `fuzzy_score` UDF | Logic now in `FuzzyStrategy.ts` |
| `hybrid_entity_match` UDTF | Logic now in `HybridStrategy.ts` + pipeline |

---

## 6. Domain Model & Entities

All models are TypeScript interfaces — the canonical definition of the domain. Snowflake and Postgres schemas are derived from these, not the other way around.

### 6.1 Core Aggregates

```typescript
// Profile — the top-level configuration for a resolution use case
interface Profile {
  id: string;                    // UUID (PROF-xxx)
  slug: string;                  // "supplier-dedup", "buyer-match" (URL-safe)
  name: string;                  // "Supplier Deduplication"
  entityType: string;            // "Supplier", "Person", "Address"
  defaultThreshold: number;      // 0.0–1.0
  fields: FieldConfig[];         // Ordered list of field definitions
  // Derived (computed at load time, cached):
  fastPathFields: string[];      // EXACT fields with weight >= 3.0
  semanticFields: string[];      // Fields needing embeddings
  isActive: boolean;
  sourceSystem?: string;         // "Salesforce", "Gen3", null
  externalIdField?: string;      // "sf_buyer_id" — field that maps to SoR
  allowAuthoritativeCreate: boolean; // false = never create in SoR directly
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// Entity — a single resolved record in a profile, mirrored from SF or Gen3
interface Entity {
  entityId: string;              // Internal ResolveIQ UUID (not returned as primary ID)
  profileId: string;
  displayName: string;           // Primary human-readable label
  fieldValues: Record<string, string>; // Flexible key-value (mirrors VARIANT)
  isActive: boolean;
  salesforceId: string | null;   // ← PRIMARY RETURN ID — Salesforce record ID (e.g., "001Dn000003GhXx")
  gen3Id?: string;               // Gen3 source record ID (if entity originated from Gen3)
  sourceSystem: 'Salesforce' | 'Gen3' | 'Manual'; // Which system is the authoritative source
  lastSyncedAt?: Date;           // When this record was last copied from the source system
  version: number;               // Optimistic concurrency lock
  createdAt: Date;
  updatedAt: Date;
}

// EntityEmbedding — vector representation for a SEMANTIC field
interface EntityEmbedding {
  entityId: string;
  profileId: string;
  fieldName: string;
  sourceText: string;            // Text that was embedded
  embedding: Float32Array;       // 768-dim (e5-base-v2) or model-specific
  modelVersion: string;          // "e5-base-v2", "text-embedding-3-small", etc.
  generatedAt: Date;
}
```

### 6.2 Field Configuration (Value Object)

```typescript
interface FieldConfig {
  fieldName: string;             // "name", "tax_id", "email"
  matchStrategy: MatchStrategy;  // EXACT | FUZZY | SEMANTIC | PHONETIC | NUMERIC | HYBRID | NONE
  weight: number;                // 0.0–10.0 (contribution to composite score)
  isRequired: boolean;           // Whether field is required for entity creation
  isPrimaryDisplay: boolean;     // Which field provides display_name
  isFastPath: boolean;           // Auto-true if EXACT and weight >= 3.0
  fieldOrder: number;            // Display/processing order
  normalizerOptions?: {
    lowercase?: boolean;         // Default true for most strategies
    stripPunctuation?: boolean;
    digitsOnly?: boolean;        // Auto-true for NUMERIC
    trimWhitespace?: boolean;    // Default true
  };
  strategyOptions?: Record<string, unknown>; // Strategy-specific config
}

type MatchStrategy =
  | 'EXACT'
  | 'FUZZY'
  | 'SEMANTIC'
  | 'PHONETIC'
  | 'NUMERIC'
  | 'HYBRID'
  | 'NONE';
```

### 6.3 Resolution Request & Result (API Contracts)

The primary API is `getMatchingEntity`. It does **not** create entities — callers decide
what to do based on the `ResolutionScenario` returned. The threshold is **0.95**.

```typescript
// Incoming entity matching request
interface GetMatchingEntityRequest {
  requestId: string;             // Client-provided or auto-generated (idempotency key)
  profileSlug: string;           // e.g., "buyer-match", "supplier-dedup"
  fields: Record<string, string>;// Input field values — partial inputs allowed
  correlationId?: string;        // Caller's trace ID (Gen3 transaction ID, SF record ID)
  sourceSystem: 'Salesforce' | 'Gen3' | 'AdminUI'; // Required — which system is calling
  includeDebug?: boolean;        // Include all candidates + raw scores in response
}

// Resolution response — the primary return value is salesforceId
//
// ResolutionScenario determines what the caller must do next:
//   EXACT_MATCH      (score = 1.0)   → caller auto-accepts the salesforceId
//   HIGH_CONFIDENCE  (score >= 0.95) → caller auto-accepts the salesforceId
//   LOW_CONFIDENCE   (score < 0.95 but > 0) → caller routes to Manual Review;
//                                     candidates[] are shown for user selection
//   NO_MATCH         (score = 0, matchedEntity = null) → caller routes to Manual Review;
//                                     user creates a new entry in Buyer/Entity table
interface MatchingEntityResult {
  requestId: string;
  salesforceId: string | null;     // ← PRIMARY RETURN ID — null for NO_MATCH
  matchedEntity: MatchedEntity | null; // null for NO_MATCH
  confidenceScore: number;         // 0.0–1.0 (replaces matchScore)
  resolutionScenario: ResolutionScenario;
  fieldScores: FieldScore[];       // Per-field breakdown for transparency / audit
  candidates: CandidateMatch[];    // Non-empty for LOW_CONFIDENCE — shown in Manual Review UI
  wasCached: boolean;
  executionMs: number;
  resolvedAt: Date;
  debug?: ResolutionDebug;         // Only if includeDebug=true
}

// Slimmed-down entity view returned in the result (not the full internal Entity)
interface MatchedEntity {
  salesforceId: string;            // The canonical Salesforce record ID
  displayName: string;             // Human-readable name shown in UI
  fieldValues: Record<string, string>; // Field values from the matched entity
}

// Candidate shown in Manual Review when scenario = LOW_CONFIDENCE
interface CandidateMatch {
  salesforceId: string;
  displayName: string;
  confidenceScore: number;         // Score for this specific candidate
  fieldScores: FieldScore[];
}

// Batch resolution — same 4-scenario semantics per item
interface BatchGetMatchingEntityRequest {
  profileSlug: string;
  sourceSystem: 'Salesforce' | 'Gen3' | 'AdminUI';
  items: Array<{
    requestId?: string;
    fields: Record<string, string>;
    correlationId?: string;
  }>;
}

interface BatchMatchingEntityResult {
  totalProcessed: number;
  totalExactMatch: number;         // scenario = EXACT_MATCH
  totalHighConfidence: number;     // scenario = HIGH_CONFIDENCE
  totalLowConfidence: number;      // scenario = LOW_CONFIDENCE → Manual Review
  totalNoMatch: number;            // scenario = NO_MATCH → Manual Review
  executionMs: number;
  results: MatchingEntityResult[];
}
```

### 6.4 Scoring Internals & Resolution Scenario

```typescript
// Per-field score breakdown
interface FieldScore {
  fieldName: string;
  strategy: MatchStrategy;
  weight: number;
  inputValue: string;
  candidateValue: string;
  rawScore: number;              // 0.0–1.0 from strategy algorithm
  normalizedWeight: number;      // weight / totalActiveWeight
  weightedContribution: number;  // rawScore * normalizedWeight
}

// Aggregate score for one candidate (internal — not returned directly to callers)
interface CandidateScore {
  entity: Entity;
  compositeScore: number;        // Weighted average across all active fields
  fieldScores: FieldScore[];
  totalActiveWeight: number;
  fieldsEvaluated: number;
}

// The 4-scenario business outcome — this is what callers act on.
//
// The threshold for HIGH_CONFIDENCE is 0.95 (not 0.65 from v1).
//
// Scenario   | confidenceScore       | matchedEntity | Caller action
// -----------|-----------------------|---------------|------------------------------
// EXACT_MATCH    | = 1.0             | non-null      | Auto-accept salesforceId
// HIGH_CONFIDENCE| >= 0.95 && < 1.0  | non-null      | Auto-accept salesforceId
// LOW_CONFIDENCE | > 0 && < 0.95     | non-null      | Manual Review (show candidates[])
// NO_MATCH       | = 0               | null          | Manual Review (create new entity)
type ResolutionScenario =
  | 'EXACT_MATCH'        // confidenceScore = 1.0 — perfect match on all provided fields
  | 'HIGH_CONFIDENCE'    // confidenceScore >= 0.95 — strong signal, auto-acceptable
  | 'LOW_CONFIDENCE'     // 0 < confidenceScore < 0.95 — possible match, needs human review
  | 'NO_MATCH';          // confidenceScore = 0, matchedEntity = null — new entity candidate

// Internal strategy-level match signals (for ScoringEngine, not exposed in API response)
type MatchSignal =
  | 'EXACT_ALL'          // Every provided field scored 1.0
  | 'EXACT_FASTPATH'     // High-weight EXACT field matched in fast-path (score → 1.0)
  | 'EXACT'              // At least one EXACT field scored 1.0
  | 'SEMANTIC'           // Dominant signal from embedding similarity
  | 'PHONETIC'           // Dominant signal from phonetic match
  | 'FUZZY'              // Dominant signal from edit distance
  | 'HYBRID_HIGH'        // EXACT + SEMANTIC both >= 0.9
  | 'HYBRID'             // HYBRID strategy dominant
  | 'COMPOSITE';         // Blended multi-strategy, no single dominant signal

// Debug output (for development / tuning)
interface ResolutionDebug {
  candidatesEvaluated: number;
  candidateScores: CandidateScore[];
  fastPathAttempted: boolean;
  fastPathHit: boolean;
  cacheAttempted: boolean;
  cacheHit: boolean;
  embeddingFetchMs?: number;
  scoringMs: number;
  pipelineStages: string[];
}
```

### 6.5 Cache Entries

```typescript
interface CacheEntry {
  key: string;                   // SHA256(profileId|sortedFields)
  profileId: string;
  result: MatchingEntityResult;
  createdAt: Date;
  expiresAt: Date;               // TTL = 3600s (1 hour — aligned with sync cycle)
  hitCount: number;
}

// L0: in-process LRU cache (hot profiles, sub-ms)
// L1: Redis (cross-process, ~1ms; TTL = 3600s, auto-expires each sync cycle)
// L2: REMOVED (was Snowflake profile_match_cache — eliminated)
//
// Cache refresh strategy (hourly):
//   - L1 Redis TTL = 3600s → naturally expires when new data arrives
//   - L0 LRU is cleared explicitly by CacheRefreshJob after each sync cycle
//   - This ensures callers always see data from the latest Snowflake copy
```

### 6.6 Entity Alias (BuyerAlias / EntityAlias)

Created during Manual Review when a user links an unrecognized name to a canonical Salesforce record.
On the next hourly embedding refresh, the alias fields are embedded and indexed. Subsequent calls
to `getMatchingEntity` with matching field values resolve directly to the stored `salesforceId`.

```typescript
// EntityAlias — maps known variant names/values to a canonical Salesforce ID
// Table: entity_alias in Snowflake (replicated across profiles as needed)
interface EntityAlias {
  aliasId: string;                     // UUID
  profileId: string;                   // e.g., "buyer-match" profile's internal ID
  salesforceId: string;                // Canonical SF ID this alias resolves to
  displayName: string;                 // Human-readable label for the canonical entity
  aliasFields: Record<string, string>; // Field values that should match to this SF ID
                                       // e.g., { buyer_name: "Acme Corp.", email: "ap@acme.com" }
  createdBy: string;                   // Username/userId of the reviewer who created this
  createdFromCorrelationId?: string;   // Gen3 transaction / SF case ID that triggered creation
  createdAt: Date;
  isActive: boolean;
  embeddingStatus: 'PENDING' | 'EMBEDDED'; // PENDING until next hourly refresh
}
```

### 6.7 Audit Event (Domain Event)

```typescript
interface ResolutionAuditEvent {
  eventId: string;                      // UUID
  requestId: string;
  correlationId?: string;               // Gen3 transaction ID or SF case ID
  profileSlug: string;
  profileId: string;
  sourceSystem: 'Salesforce' | 'Gen3' | 'AdminUI';
  inputFields: Record<string, string>;
  inputHash: string;                    // SHA256 of sorted input — for replay
  salesforceId: string | null;          // Primary returned ID (null for NO_MATCH)
  matchedEntityId?: string;             // Internal ResolveIQ entityId of matched entity
  confidenceScore: number;              // 0.0–1.0
  resolutionScenario: ResolutionScenario; // EXACT_MATCH | HIGH_CONFIDENCE | LOW_CONFIDENCE | NO_MATCH
  fieldScores: FieldScore[];
  candidateCount: number;               // How many candidates were returned (for LOW_CONFIDENCE)
  wasCached: boolean;
  thresholdUsed: number;                // Always 0.95 unless overridden per profile
  profileSnapshotTs: Date;             // When profile config was last loaded
  entitiesSnapshotTs: Date;            // When entity data was last synced from SF/Gen3
  modelVersion: string;                 // Embedding model used (e.g., "e5-base-v2")
  executionMs: number;
  resolvedAt: Date;
  errorCode?: string;
  errorMessage?: string;
}
```

---

## 7. Port Interfaces (The Contracts)

The engine core depends ONLY on these interfaces. Adapters implement them.

```typescript
// WHERE profiles are stored (Snowflake, Postgres, or in-memory for tests)
interface IProfileRepository {
  findBySlug(slug: string): Promise<Profile | null>;
  findAll(includeInactive?: boolean): Promise<Profile[]>;
  create(input: CreateProfileInput): Promise<Profile>;
  update(slug: string, updates: UpdateProfileInput): Promise<Profile>;
  softDelete(slug: string): Promise<void>;
  addField(slug: string, field: FieldConfig): Promise<Profile>;
  updateField(slug: string, fieldName: string, updates: Partial<FieldConfig>): Promise<Profile>;
  removeField(slug: string, fieldName: string): Promise<Profile>;
}

// WHERE entities are stored (Snowflake VARIANT tables + embeddings)
interface IEntityRepository {
  findById(entityId: string): Promise<Entity | null>;
  findByExactField(
    profileId: string,
    fieldName: string,
    value: string
  ): Promise<Entity | null>;                      // Fast-path lookup
  getCandidatesByEmbedding(
    profileId: string,
    fieldName: string,
    embedding: Float32Array,
    topK: number,
    minSimilarity: number
  ): Promise<Array<{ entity: Entity; similarity: number }>>; // ANN in Snowflake
  getCandidatesByProfile(
    profileId: string,
    limit?: number
  ): Promise<Entity[]>;                           // For non-semantic-only profiles
  upsert(entity: Partial<Entity> & { profileId: string }): Promise<Entity>;
  softDelete(entityId: string): Promise<void>;
  bulkInsert(profileId: string, entities: Partial<Entity>[]): Promise<Entity[]>;
  listByProfile(
    profileId: string,
    page: number,
    pageSize: number
  ): Promise<{ entities: Entity[]; total: number }>;
}

// HOW embeddings are generated (Snowflake Cortex, OpenAI, local model)
interface IEmbeddingProvider {
  generateEmbedding(text: string): Promise<Float32Array>;
  generateEmbeddings(texts: string[]): Promise<Float32Array[]>;
  getModelVersion(): string;
  getDimensions(): number;       // 768 for e5-base-v2, 1536 for OpenAI ada-002
}

// WHERE results are cached (Redis, in-memory, no-op)
interface ICacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByProfile(profileId: string): Promise<void>;
  flush(): Promise<void>;
  stats(): Promise<{ keys: number; hitRate: number }>;
}

// HOW audit events are persisted (Snowflake, Postgres, stdout, no-op)
interface IAuditLogger {
  logResolution(event: ResolutionAuditEvent): Promise<void>;
  // Fire-and-forget — never blocks the resolution response
}

// THE matching algorithm contract — each strategy implements this
interface IMatchStrategy {
  readonly strategyName: MatchStrategy;
  score(
    inputValue: string,
    candidateValue: string,
    context?: StrategyContext
  ): number | Promise<number>;
  normalize(value: string): string;
  requiresEmbedding(): boolean;    // true only for SEMANTIC
  isAsync(): boolean;              // true only for SEMANTIC (embedding fetch)
}

interface StrategyContext {
  inputEmbedding?: Float32Array;   // Pre-fetched for SEMANTIC fields
  candidateEmbedding?: Float32Array;
  fieldConfig?: FieldConfig;
}
```

---

## 8. Node.js Module Structure

```
resolveiq-engine/
├── package.json                          # Node 20+, TypeScript 5.x
├── tsconfig.json
│
├── src/
│   ├── index.ts                          # Public API exports
│   │
│   ├── api/                              # HTTP layer (thin — no business logic)
│   │   ├── server.ts                     # Fastify server + lifecycle
│   │   ├── middleware/
│   │   │   ├── requestId.ts              # Inject requestId
│   │   │   ├── correlationId.ts          # Extract caller's correlationId
│   │   │   └── errorHandler.ts           # Structured error responses
│   │   └── routes/
│   │       ├── profiles.routes.ts        # /profiles CRUD
│   │       ├── resolve.routes.ts         # /profiles/:slug/resolve
│   │       ├── entities.routes.ts        # /profiles/:slug/entities
│   │       ├── health.routes.ts          # /health
│   │       └── stats.routes.ts           # /stats
│   │
│   ├── core/                             # Engine — zero external dependencies
│   │   │
│   │   ├── models/                       # Domain interfaces (section 6 above)
│   │   │   ├── Profile.ts
│   │   │   ├── Entity.ts
│   │   │   ├── FieldConfig.ts
│   │   │   ├── ResolveRequest.ts
│   │   │   ├── ResolveResult.ts
│   │   │   ├── FieldScore.ts
│   │   │   ├── CandidateScore.ts
│   │   │   ├── MatchType.ts
│   │   │   └── AuditEvent.ts
│   │   │
│   │   ├── ports/                        # Interface definitions (section 7)
│   │   │   ├── IProfileRepository.ts
│   │   │   ├── IEntityRepository.ts
│   │   │   ├── IEmbeddingProvider.ts
│   │   │   ├── ICacheProvider.ts
│   │   │   ├── IAuditLogger.ts
│   │   │   └── IMatchStrategy.ts
│   │   │
│   │   ├── strategies/                   # Matching algorithm implementations
│   │   │   ├── StrategyRegistry.ts       # Plugin registry — register/lookup strategies
│   │   │   ├── ExactStrategy.ts          # Case-insensitive string equality
│   │   │   ├── FuzzyStrategy.ts          # Levenshtein via `fastest-levenshtein`
│   │   │   ├── PhoneticStrategy.ts       # Soundex + Double Metaphone via `natural`
│   │   │   ├── NumericStrategy.ts        # Digit-only strip + exact compare
│   │   │   ├── SemanticStrategy.ts       # Cosine similarity on pre-fetched embeddings
│   │   │   ├── HybridStrategy.ts         # Configurable blend of strategies
│   │   │   └── NoneStrategy.ts           # No-op (field stored but not scored)
│   │   │
│   │   ├── engine/                       # Pipeline orchestration
│   │   │   ├── ResolutionEngine.ts       # Main orchestrator — wires all stages
│   │   │   ├── FastPathChecker.ts        # EXACT field fast-path (bypass full pipeline)
│   │   │   ├── CandidateRetriever.ts     # Get candidates (exact lookup OR embedding ANN)
│   │   │   ├── EmbeddingFetcher.ts       # Batch-fetch embeddings for semantic fields
│   │   │   ├── ScoringEngine.ts          # Apply strategies to candidate × field matrix
│   │   │   ├── ScoringAggregator.ts      # Weighted composite score + normalization
│   │   │   ├── MatchClassifier.ts        # Assign MatchType from score signals
│   │   │   └── BatchProcessor.ts         # Concurrent batch resolution (Promise.allSettled)
│   │   │
│   │   └── services/                     # Domain services
│   │       ├── ProfileService.ts         # Profile CRUD + in-process LRU cache
│   │       ├── EntityService.ts          # Entity CRUD + embedding generation on create
│   │       ├── CacheOrchestrator.ts      # L0/L1 cache read-through + invalidation logic
│   │       └── AuditService.ts           # Fire-and-forget audit log dispatch
│   │
│   ├── adapters/                         # Infrastructure implementations
│   │   │
│   │   ├── snowflake/
│   │   │   ├── SnowflakeEntityRepository.ts   # Entity read/write via Snowpark
│   │   │   ├── SnowflakeCortexEmbedding.ts    # EMBED_TEXT_768 call
│   │   │   ├── SnowflakeAuditLogger.ts         # INSERT to profile_match_log
│   │   │   └── SnowflakeClient.ts              # Connection pool + session management
│   │   │
│   │   ├── postgres/
│   │   │   ├── PostgresProfileRepository.ts   # Profiles in Postgres (alternative)
│   │   │   ├── PostgresEntityRepository.ts    # Entities in Postgres + pgvector
│   │   │   └── PostgresClient.ts
│   │   │
│   │   ├── cache/
│   │   │   ├── RedisCacheProvider.ts          # Redis L1 (ioredis)
│   │   │   ├── InMemoryLRUCache.ts             # L0 in-process (lru-cache)
│   │   │   ├── LayeredCacheProvider.ts         # L0 → L1 → miss (chain pattern)
│   │   │   └── NoOpCacheProvider.ts            # For testing / disabled
│   │   │
│   │   ├── embedding/
│   │   │   ├── SnowflakeCortexEmbedding.ts    # (same as above, aliased)
│   │   │   ├── OpenAIEmbeddingProvider.ts      # text-embedding-3-small (future)
│   │   │   └── LocalEmbeddingProvider.ts       # ONNX / transformers.js (future)
│   │   │
│   │   └── audit/
│   │       ├── SnowflakeAuditLogger.ts
│   │       ├── ConsoleAuditLogger.ts           # Development
│   │       └── CompositeAuditLogger.ts         # Fan-out to multiple loggers
│   │
│   ├── infrastructure/
│   │   ├── config.ts                     # Typed env config (zod)
│   │   ├── container.ts                  # DI container (tsyringe or manual)
│   │   ├── logger.ts                     # Structured logging (pino)
│   │   └── metrics.ts                    # Prometheus metrics (optional)
│   │
│   └── __tests__/                        # Tests (no external deps needed)
│       ├── strategies/
│       │   ├── ExactStrategy.test.ts
│       │   ├── FuzzyStrategy.test.ts
│       │   ├── PhoneticStrategy.test.ts
│       │   ├── NumericStrategy.test.ts
│       │   └── SemanticStrategy.test.ts  # Uses mock IEmbeddingProvider
│       ├── engine/
│       │   ├── ScoringAggregator.test.ts
│       │   ├── MatchClassifier.test.ts
│       │   ├── FastPathChecker.test.ts
│       │   └── ResolutionEngine.test.ts  # Full integration with mocks
│       └── fixtures/
│           ├── profiles.fixture.ts
│           └── entities.fixture.ts
│
└── sql/                                  # ONLY data-layer SQL (no logic)
    ├── schema/
    │   ├── 01_entities.sql               # profile_entities table
    │   ├── 02_embeddings.sql             # profile_entity_embeddings table
    │   ├── 03_audit_log.sql              # profile_match_log (append-only)
    │   └── 04_profiles.sql              # Optional: profiles in Snowflake
    └── queries/
        ├── entity_exact_lookup.sql       # Fast-path EXACT field lookup
        ├── embedding_ann_search.sql      # ANN via VECTOR_COSINE_SIMILARITY
        ├── entity_bulk_insert.sql        # Bulk entity load
        └── audit_insert.sql             # Audit log INSERT
```

---

## 9. The Resolution Pipeline (Step by Step)

The main entry point is `getMatchingEntity`. The engine never creates entities — it only
classifies outcomes into one of the 4 ResolutionScenarios. The caller acts on the scenario.

```
POST /profiles/buyer-match/getMatchingEntity
  { fields: { buyer_name: "Acme Corp", tax_id: "36-1234567" }, sourceSystem: "Gen3" }
                    │
                    ▼
            ┌──────────────┐
            │ 0. Alias     │  AliasChecker: query entity_alias table
            │    Check     │  WHERE profile_id = ? AND alias matches input fields
            └──────┬───────┘  → If alias found: return EXACT_MATCH (score=1.0, salesforceId)
              MISS │           → Skip remaining pipeline
                   ▼
            ┌──────────────┐
            │ 1. Load      │  ProfileService.getBySlug("buyer-match")
            │    Profile   │  → LRU cache hit in ~0ms (after first load)
            └──────┬───────┘
                   │ Profile { fastPathFields: ["tax_id"], semanticFields: ["buyer_name"], ... }
                   ▼
            ┌──────────────┐
            │ 2. Cache     │  CacheOrchestrator.get(cacheKey)
            │    Check     │  → L0 (in-process): ~0ms
            └──────┬───────┘  → L1 (Redis, TTL=3600s): ~1ms
              MISS │           → return cached result if HIT
                   ▼
            ┌──────────────┐
            │ 3. Fast-Path │  FastPathChecker: tax_id is EXACT, weight=3.0 >= 3.0
            │    Check     │  → IEntityRepository.findByExactField(
            └──────┬───────┘       "buyer-match", "tax_id", "36-1234567")
              MISS │               → SQL: SELECT WHERE salesforce_id IS NOT NULL
              or HIT → score=1.0 → EXACT_MATCH
                   ▼
            ┌──────────────┐
            │ 4. Candidate │  Profile has SEMANTIC field "buyer_name" →
            │    Retrieval │  a) Generate embedding for "Acme Corp" (IEmbeddingProvider)
            └──────┬───────┘  b) ANN search: IEntityRepository.getCandidatesByEmbedding(
                   │               topK=50, minSimilarity=0.4)
                   │           → Returns: [Entity_A, Entity_B, ... Entity_50]
                   │           + their pre-fetched embeddings for step 5
                   ▼
            ┌──────────────┐
            │ 5. Scoring   │  ScoringEngine.scoreAll(candidates, activeFields):
            │    Engine    │
            └──────┬───────┘  For each candidate C in candidates:
                   │            For each field F in activeFields:
                   │              strategy = StrategyRegistry.get(F.matchStrategy)
                   │              fieldScore = strategy.score(
                   │                input.fields[F.name], C.fieldValues[F.name], ctx)
                   │
                   │          Strategies run in-process (no I/O):
                   │            EXACT:    "36-1234567" == "36-1234567" → 1.0
                   │            SEMANTIC: cosine(inputEmb, candidateEmb) → 0.88
                   │            FUZZY:    levenshtein("Acme Corp","ACME Corp") → 0.97
                   │
                   ▼
            ┌──────────────┐
            │ 6. Score     │  ScoringAggregator.aggregate(candidateFieldScores):
            │    Aggregation│   composite = SUM(score*weight) / SUM(activeWeights)
            └──────┬───────┘   weight normalization handles missing fields automatically
                   │
                   ▼
            ┌───────────────────────────────────────────────────────┐
            │ 7. Classify → ResolutionScenario                      │
            │                                                       │
            │  score = 1.0          → EXACT_MATCH                   │
            │  score >= 0.95        → HIGH_CONFIDENCE                │
            │  0 < score < 0.95     → LOW_CONFIDENCE                 │
            │                         + return top-5 candidates[]   │
            │  score = 0 / no match → NO_MATCH                      │
            │                         + return empty candidates[]   │
            └──────┬────────────────────────────────────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │ 8. Cache     │  CacheOrchestrator.set(cacheKey, result, ttl=3600)
            │    Write     │  → L0 + L1 written async (non-blocking)
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │ 9. Audit     │  AuditService.log(event) — fire and forget
            │    Log       │  → SnowflakeAuditLogger.logResolution(...)
            └──────┬───────┘  → Async, never blocks response
                   │
                   ▼

  Scenario a — EXACT_MATCH (score = 1.0):
    { salesforceId: "001Dn000003GhXx", matchedEntity: { displayName: "ACME Corporation", ... },
      confidenceScore: 1.0, resolutionScenario: "EXACT_MATCH",
      candidates: [], wasCached: false, executionMs: 18 }

  Scenario b — HIGH_CONFIDENCE (score >= 0.95):
    { salesforceId: "001Dn000003GhXx", matchedEntity: { displayName: "ACME Corporation", ... },
      confidenceScore: 0.97, resolutionScenario: "HIGH_CONFIDENCE",
      candidates: [], executionMs: 72 }

  Scenario c — LOW_CONFIDENCE (0 < score < 0.95):
    { salesforceId: null, matchedEntity: null,
      confidenceScore: 0.74, resolutionScenario: "LOW_CONFIDENCE",
      candidates: [
        { salesforceId: "001Dn000003GhXx", displayName: "ACME Corporation", confidenceScore: 0.74 },
        { salesforceId: "001Dn000004KmYz", displayName: "Acme Corp Limited", confidenceScore: 0.61 }
      ], executionMs: 88 }
    → Caller (Gen3/SF) routes transaction to Manual Review
    → User selects a candidate OR creates a BuyerAlias entry

  Scenario d — NO_MATCH (score = 0):
    { salesforceId: null, matchedEntity: null,
      confidenceScore: 0, resolutionScenario: "NO_MATCH",
      candidates: [], executionMs: 45 }
    → Caller routes to Manual Review for new entity creation in Buyer/Supplier table
```

### Engine Does NOT Create Entities

The engine **never** creates entities or Salesforce records. Entity creation is the caller's
responsibility and must go through the System of Record (Salesforce) governance process:

```
Gen3/SF receives NO_MATCH or LOW_CONFIDENCE
  └─> Routes to Manual Review queue
       └─> User reviews, selects or creates
            ├─ If user accepts a candidate (LOW_CONFIDENCE) or links a name:
            │    → EntityAliasService.createAlias(profileId, salesforceId, aliasFields)
            │    → Alias stored in entity_alias table (embeddingStatus = PENDING)
            │    → Next hourly EmbeddingRefreshJob embeds the alias fields
            │    → User requeues the transaction after ~1 hour
            │
            └─ If no match (NO_MATCH): user creates new record in Salesforce
                 → SF → Snowflake sync (next hourly cycle)
                 → EmbeddingRefreshJob generates embeddings for new SF record
                 → User requeues transaction; getMatchingEntity will now find it
```

---

## 10. Strategy Implementations

### ExactStrategy
```typescript
class ExactStrategy implements IMatchStrategy {
  readonly strategyName = 'EXACT';
  requiresEmbedding() { return false; }
  isAsync() { return false; }

  normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  score(input: string, candidate: string): number {
    if (!input || !candidate) return 0;
    return this.normalize(input) === this.normalize(candidate) ? 1.0 : 0.0;
  }
}
```

### FuzzyStrategy (Levenshtein)
```typescript
import { distance } from 'fastest-levenshtein'; // 5x faster than Snowflake EDITDISTANCE

class FuzzyStrategy implements IMatchStrategy {
  readonly strategyName = 'FUZZY';

  score(input: string, candidate: string): number {
    const a = this.normalize(input);
    const b = this.normalize(candidate);
    if (a === b) return 1.0;
    const maxLen = Math.max(a.length, b.length, 1);
    return Math.max(0, 1 - distance(a, b) / maxLen);
  }
}
```

### PhoneticStrategy (Soundex + Double Metaphone)
```typescript
import { DoubleMetaphone, SoundEx } from 'natural';

class PhoneticStrategy implements IMatchStrategy {
  readonly strategyName = 'PHONETIC';

  score(input: string, candidate: string): number {
    const dmInput = DoubleMetaphone.process(input);
    const dmCandidate = DoubleMetaphone.process(candidate);
    // Primary: Double Metaphone match (better than SOUNDEX)
    if (dmInput[0] === dmCandidate[0] || dmInput[1] === dmCandidate[1]) return 1.0;
    // Fallback: SOUNDEX for backward compatibility
    if (SoundEx.process(input) === SoundEx.process(candidate)) return 0.9;
    // Partial: at least one metaphone code matches
    if (dmInput[0] === dmCandidate[1] || dmInput[1] === dmCandidate[0]) return 0.7;
    // Fuzzy fallback: edit distance on phonetic codes
    return 0;
  }
}
```

### NumericStrategy
```typescript
class NumericStrategy implements IMatchStrategy {
  readonly strategyName = 'NUMERIC';

  normalize(value: string): string {
    return value.replace(/\D/g, ''); // Strip all non-digits
  }

  score(input: string, candidate: string): number {
    const a = this.normalize(input);
    const b = this.normalize(candidate);
    if (!a || !b) return 0;
    return a === b ? 1.0 : 0.0;
  }
}
```

### SemanticStrategy (cosine in Node.js, embedding via Snowflake)
```typescript
class SemanticStrategy implements IMatchStrategy {
  readonly strategyName = 'SEMANTIC';
  requiresEmbedding() { return true; }
  isAsync() { return false; } // By the time score() is called, embeddings are pre-fetched

  score(input: string, candidate: string, context?: StrategyContext): number {
    if (!context?.inputEmbedding || !context?.candidateEmbedding) return 0;
    return this.cosineSimilarity(context.inputEmbedding, context.candidateEmbedding);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
// Note: EMBED_TEXT_768 still runs in Snowflake (IEmbeddingProvider).
// Only the cosine math moves to Node.js — trivial arithmetic, no reason to pay Snowflake compute for it.
```

### StrategyRegistry (Plugin System)
```typescript
class StrategyRegistry {
  private strategies = new Map<MatchStrategy, IMatchStrategy>();

  register(strategy: IMatchStrategy): void {
    this.strategies.set(strategy.strategyName, strategy);
  }

  get(name: MatchStrategy): IMatchStrategy {
    const s = this.strategies.get(name);
    if (!s) throw new Error(`Unknown strategy: ${name}`);
    return s;
  }
}

// At startup:
const registry = new StrategyRegistry();
registry.register(new ExactStrategy());
registry.register(new FuzzyStrategy());
registry.register(new PhoneticStrategy());
registry.register(new NumericStrategy());
registry.register(new SemanticStrategy());
registry.register(new HybridStrategy(registry)); // Composable
registry.register(new NoneStrategy());

// Adding a NEW strategy (e.g., Jaro-Winkler) = 1 file + 1 line:
registry.register(new JaroWinklerStrategy());
// Update a profile field: matchStrategy: "JARO_WINKLER" — done.
```

---

## 11. Snowflake's New Role (Minimal, Precise)

After the migration, Snowflake's job is strictly:

```sql
-- 1. Entity storage (flexible VARIANT schema — unchanged)
SELECT entity_id, display_name, field_values
FROM profile_entities
WHERE profile_id = ? AND is_active = TRUE;

-- 2. Fast-path EXACT lookup (single SQL call, <10ms)
SELECT entity_id, display_name
FROM profile_entities
WHERE profile_id = ?
  AND LOWER(field_values->>'tax_id') = LOWER(?)
LIMIT 1;

-- 3. Embedding generation (ONLY Cortex AI call — stays here forever)
SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', ?) AS embedding;

-- 4. ANN candidate retrieval (vector similarity search — Snowflake is good at this)
SELECT pe.entity_id, pe.display_name, pe.field_values,
       VECTOR_COSINE_SIMILARITY(pee.embedding, ?) AS similarity
FROM profile_entity_embeddings pee
JOIN profile_entities pe ON pe.entity_id = pee.entity_id
WHERE pee.profile_id = ?
  AND pee.field_name = ?
  AND VECTOR_COSINE_SIMILARITY(pee.embedding, ?) >= 0.4
ORDER BY similarity DESC
LIMIT 50;

-- 5. Audit log INSERT (append-only, non-blocking)
INSERT INTO profile_match_log (...) VALUES (?);
```

**No UDTFs. No stored procedures for business logic. No WHILE loops. No MERGE for cache. No CASE statements for match classification.** Pure data operations.

---

## 12. Candidate Retrieval Strategy (Key Design)

This is the most important change from v1. Currently, `resolve_entity` UDTF does a CROSS JOIN of ALL candidates × ALL fields — O(N×F) SQL operations inside Snowflake.

**v2 approach: Snowflake returns a small candidate set; Node.js scores them.**

```
Profile has: name (SEMANTIC, w=5), tax_id (EXACT, w=3), city (FUZZY, w=1.5)

Step A: Fast-path check (if tax_id provided)
  → SELECT WHERE tax_id = input_tax_id → 1 row or 0 rows → done

Step B: Candidate retrieval (if fast-path miss)
  If profile has SEMANTIC fields:
    → Snowflake ANN: top-50 by embedding similarity on "name" field
    → Returns 50 candidates + their embeddings
  Else (EXACT/FUZZY/PHONETIC/NUMERIC only):
    → Simple SELECT all active entities for profile (reasonable for <100K entities)
    → Or blocking rules: WHERE first_char(name) = first_char(input) (reduces candidates 20x)

Step C: Node.js scoring (in-process, microseconds per candidate)
  → 50 candidates × 3 fields = 150 strategy.score() calls
  → All in-process, no I/O
  → Total: <5ms for scoring 50 candidates
```

For profiles with 1M+ entities, **blocking rules** can be added as plugins:
- First-N-character blocking (name must share first 2 chars)
- Phonetic code blocking (SOUNDEX pre-filter)
- EXACT field blocking (e.g., must match country first)

These are implemented as `IBlockingStrategy` in Node.js — no SQL changes needed.

---

## 13. Technology Stack

| Layer | Technology | Version | Justification |
|---|---|---|---|
| Runtime | Node.js | 22 LTS | Native TypeScript support, excellent async I/O |
| Language | TypeScript | 5.x | Type-safe domain models, interfaces |
| HTTP Framework | Fastify | 5.x | 2x faster than Express, native JSON schema validation |
| Validation | Zod | 3.x | Runtime validation + TypeScript inference |
| Levenshtein | fastest-levenshtein | 1.x | 5x faster than native JS implementations |
| Phonetics | natural | 6.x | DoubleMetaphone, NYSIIS, SOUNDEX — all in one |
| Snowflake | snowflake-sdk | latest | Official Node.js driver (replacing Snowpark Python) |
| Cache L0 | lru-cache | 10.x | In-process, configurable size (1000 entries) |
| Cache L1 | ioredis | 5.x | Battle-tested Redis client, pipelining |
| Logging | pino | 9.x | Structured JSON logs, low overhead |
| DI Container | tsyringe | 4.x | Lightweight DI for adapter wiring |
| Testing | vitest | 2.x | Fast, native TypeScript, no transpile step |
| Linting | biome | 1.x | Replaces ESLint + Prettier (10x faster) |

### Removed Dependencies
- `snowflake-snowpark-python` — replaced by `snowflake-sdk` (Node.js)
- `FastAPI` + `uvicorn` — replaced by Fastify
- `pydantic` — replaced by Zod
- `redis` (Python) — replaced by ioredis

---

## 14. Migration Plan (Phased)

### Phase 0: Foundation (Week 1)
- [ ] Initialize Node.js TypeScript project
- [ ] Define all domain models and port interfaces (section 6 & 7)
- [ ] Implement all 6 strategy classes with unit tests
- [ ] Implement `ScoringAggregator` and `MatchClassifier` with unit tests
- [ ] 100% test coverage on all pure logic before touching infrastructure

### Phase 1: Snowflake Adapters (Week 2)
- [ ] Implement `SnowflakeEntityRepository` (entity read/write)
- [ ] Implement `SnowflakeCortexEmbedding` (generateEmbedding calls Cortex)
- [ ] Implement `SnowflakeAuditLogger` (INSERT to profile_match_log)
- [ ] Wire `ResolutionEngine` with Snowflake adapters
- [ ] Run side-by-side validation: call both Python API and Node.js engine with same inputs, compare outputs

### Phase 2: Cache & Pipeline (Week 3)
- [ ] Implement `InMemoryLRUCache` (L0) and `RedisCacheProvider` (L1)
- [ ] Implement `LayeredCacheProvider` (L0 → L1 chain)
- [ ] Implement `FastPathChecker` (EXACT field short-circuit)
- [ ] Implement `CandidateRetriever` (ANN + blocking rules)
- [ ] Implement `BatchProcessor` (concurrent with `Promise.allSettled`)
- [ ] Integration tests against real Snowflake dev environment

### Phase 3: API Layer (Week 4)
- [ ] Build Fastify routes for all 20 existing endpoints (preserve exact API contract)
- [ ] Implement `ProfileService` with profile LRU cache
- [ ] Implement `EntityService` (create entity + generate embeddings inline)
- [ ] Docker image + health checks
- [ ] Load test: verify latency targets (section 15)

### Phase 4: Profile Repository Migration (Week 5, Optional)
- [ ] Implement `PostgresProfileRepository` (profiles in Postgres instead of Snowflake)
- [ ] Migration script: export from Snowflake → import to Postgres
- [ ] Benefit: profile reads no longer require Snowflake connection
- [ ] Keep `SnowflakeProfileRepository` as fallback (swap via config)

### Phase 5: Cutover (Week 6)
- [ ] Deploy Node.js API behind feature flag
- [ ] Route 10% → 50% → 100% traffic
- [ ] Monitor: latency, error rate, match score distributions vs baseline
- [ ] Retire Python FastAPI and Snowflake stored procedures
- [ ] Keep Snowflake SQL scripts for schema only (no stored procedures)

---

## 15. Latency Targets (v2)

| Operation | v1 Target | v2 Target | How |
|---|---|---|---|
| EXACT fast-path | <50ms | <20ms | Single SQL SELECT (unchanged) + no stored procedure overhead |
| Single resolve (FUZZY/PHONETIC) | <200ms | <50ms | In-process scoring, no SQL UDF round-trips |
| Single resolve (SEMANTIC) | <500ms | <150ms | ANN in Snowflake (50 candidates) + in-process cosine |
| Batch 50 (FUZZY) | <5s | <300ms | Concurrent `Promise.all` vs sequential SQL WHILE loop |
| Cache hit (Redis) | ~6ms | ~2ms | L0 in-memory hit for hot profiles |
| Profile load | 10ms | ~0ms | LRU in-process cache after first load |

---

## 16. Extensibility Examples

### Add a new strategy (no SQL, no schema changes)
```typescript
// JaroWinklerStrategy.ts
import { JaroWinklerDistance } from 'natural';
class JaroWinklerStrategy implements IMatchStrategy {
  strategyName = 'JARO_WINKLER' as MatchStrategy;
  score(a: string, b: string) { return JaroWinklerDistance(a, b); }
}
registry.register(new JaroWinklerStrategy());
// Profile field: { matchStrategy: "JARO_WINKLER", weight: 3 }
```

### Swap embedding provider (no engine changes)
```typescript
// In container.ts — change one line:
container.register<IEmbeddingProvider>(
  'IEmbeddingProvider',
  // Was: SnowflakeCortexEmbedding
  new OpenAIEmbeddingProvider({ model: 'text-embedding-3-small' })
);
// All strategy classes, pipeline, and scoring unchanged
```

### Add blocking rules (pre-filter candidates before scoring)
```typescript
interface IBlockingStrategy {
  name: string;
  filter(input: Record<string, string>, candidates: Entity[]): Entity[];
}
class FirstCharBlockingStrategy implements IBlockingStrategy {
  filter(input, candidates) {
    const firstChar = input.name?.[0]?.toLowerCase();
    return candidates.filter(c => c.fieldValues.name?.[0]?.toLowerCase() === firstChar);
  }
}
```

### Add cross-profile entity linking (v2.1 roadmap)
```typescript
// New port: ICrossProfileLinker
interface ICrossProfileLinker {
  findLinkedEntities(entityId: string): Promise<LinkedEntity[]>;
}
// Engine calls this after resolution, zero changes to strategy layer
```

---

## 17. What Snowflake Stored Procedures Are Replaced By

| Procedure / UDF | Replaced By |
|---|---|
| `resolve_and_upsert()` | `ResolutionEngine.resolve()` |
| `batch_resolve_and_upsert()` | `BatchProcessor.resolveAll()` |
| `bulk_load_entities()` | `EntityService.bulkInsert()` |
| `resolve_entity()` UDTF | `ScoringEngine.scoreAll()` + `ScoringAggregator.aggregate()` |
| `compute_field_score()` | `StrategyRegistry.get(strategy).score()` |
| `fuzzy_score()` | `FuzzyStrategy.score()` |
| `hybrid_entity_match()` | `HybridStrategy.score()` |
| `best_resolve_match()` | `MatchClassifier.classify()` → top result |
| `invalidate_profile_cache()` | `CacheOrchestrator.invalidateProfile()` |
| `bulk_load_entities()` | `EntityService.bulkInsert()` |
| `get_profile_id()` | `ProfileService.getBySlug()` |
| `best_entity_match()` | `ResolutionEngine.resolve()` → top candidate |

---

## 18. Risk Mitigation

| Risk | Mitigation |
|---|---|
| Match score drift between v1 (SQL) and v2 (Node.js) | Phase 1 side-by-side validation. Both engines run same inputs, compare field_scores and composite_score. Accept <0.01 floating-point delta. |
| Snowflake ANN not returning same candidates as full UDTF scan | Log candidate overlap %. If <90%, widen topK from 50 to 100. |
| Performance regression at scale | Load test in Phase 3 before cutover. Node.js in-process scoring is ~10x faster than cross-row SQL UDF calls. |
| Embedding model change breaks cosine similarity | `modelVersion` stored with each embedding. Re-embedding via `EntityService.reEmbedProfile()` when model changes. |
| Redis unavailability | `LayeredCacheProvider` degrades gracefully to L0 only. Resolution still works, just slightly higher Snowflake load. |
| Profile config cache staleness | `ProfileService` LRU with configurable TTL (default 60s). Explicit invalidation endpoint. |

---

## 19. Immediate Next Steps

1. **Create `resolveiq-engine` Node.js package** in this repo (`engine/` directory)
2. **Start with pure logic** — all 6 strategy files + tests (zero Snowflake dependency)
3. **Define all TypeScript interfaces** — domain models, ports
4. **Implement Snowflake entity adapter** — replaces Snowflake stored procedures
5. **Wire full pipeline** — validate against Snowflake dev env
6. **Run side-by-side** — both Python FastAPI and Node.js engine live, compare outputs
7. **Cutover** — retire Python + Snowflake stored procedures

---

---

## 20. Hourly Sync Architecture

The entire ResolveIQ data pipeline runs on an **hourly cycle** coordinated across three stages.
ResolveIQ is not responsible for the SF→Snowflake or Gen3→Snowflake ETL — it reacts to it.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  HOURLY CYCLE  (every 60 minutes)                                            │
│                                                                              │
│  Stage 1: External ETL (NOT ResolveIQ's responsibility)                     │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────────────────┐   │
│  │  Salesforce  │────>│    ETL Job   │────>│  Snowflake                 │   │
│  │  (SoR)       │     │  (external)  │     │  buyers_raw / suppliers_raw│   │
│  └──────────────┘     └──────────────┘     └────────────────┬───────────┘   │
│  ┌──────────────┐     ┌──────────────┐              (copy only new/        │   │
│  │  Gen3        │────>│    ETL Job   │────>          updated rows)          │   │
│  │  (PostgreSQL)│     │  (external)  │                       │              │   │
│  └──────────────┘     └──────────────┘                       │              │   │
│                                                               ▼              │
│  Stage 2: EmbeddingRefreshJob (ResolveIQ scheduled job, runs after Stage 1) │
│           ┌─────────────────────────────────────────────────────────────┐   │
│           │ Query: SELECT * FROM buyers_raw                             │   │
│           │   WHERE last_modified_at > (last_embedding_run_at)          │   │
│           │   AND salesforce_id IS NOT NULL                             │   │
│           │   → For each new/updated record:                            │   │
│           │       a) Upsert into profile_entities (salesforceId field)  │   │
│           │       b) Generate embeddings via Snowflake Cortex           │   │
│           │          EMBED_TEXT_768('e5-base-v2', field_value)          │   │
│           │       c) Upsert into profile_entity_embeddings              │   │
│           │   → Also process entity_alias where embeddingStatus=PENDING  │   │
│           │       a) Generate embeddings for aliasFields                │   │
│           │       b) Update embeddingStatus → 'EMBEDDED'               │   │
│           └─────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Stage 3: CacheRefreshJob (runs after EmbeddingRefreshJob completes)        │
│           ┌─────────────────────────────────────────────────────────────┐   │
│           │ → Flush L0 in-process LRU cache                             │   │
│           │ → Redis L1 entries expire naturally (TTL = 3600s)           │   │
│           │ → Update entitiesSnapshotTs in ProfileService               │   │
│           │   (used in audit log for reproducibility)                   │   │
│           └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Scheduled Job Interfaces

```typescript
// Runs immediately after Stage 1 ETL completes (via webhook or fixed offset)
@Injectable()
export class EmbeddingRefreshJob {
  /**
   * Process all new/updated entities since the last run.
   * Generates embeddings for both raw entity records and pending entity aliases.
   *
   * @param lastRunAt - Timestamp of the previous successful run
   */
  async run(lastRunAt: Date): Promise<EmbeddingRefreshResult> { ... }
}

// Runs after EmbeddingRefreshJob succeeds
@Injectable()
export class CacheRefreshJob {
  /**
   * Flush in-process LRU cache and record the new entities snapshot timestamp.
   * Redis entries expire via TTL — no explicit flush needed for L1.
   */
  async run(): Promise<void> { ... }
}

interface EmbeddingRefreshResult {
  entitiesProcessed: number;
  entitiesEmbedded: number;
  aliasesProcessed: number;
  aliasesEmbedded: number;
  errors: number;
  durationMs: number;
  completedAt: Date;
}
```

### Snowflake Tables (Updated Schema)

```sql
-- Core entity storage (mirrored from Salesforce / Gen3)
-- salesforce_id is the canonical external ID returned by getMatchingEntity
CREATE TABLE profile_entities (
  entity_id        VARCHAR(36)   NOT NULL,    -- Internal UUID (not returned as primary ID)
  profile_id       VARCHAR(36)   NOT NULL,
  display_name     VARCHAR(500)  NOT NULL,
  field_values     VARIANT       NOT NULL,    -- Flexible JSON key-value
  salesforce_id    VARCHAR(50),               -- ← PRIMARY RETURN ID (null for Gen3-only records)
  gen3_id          VARCHAR(100),              -- Gen3 source record ID
  source_system    VARCHAR(20)   NOT NULL,    -- 'Salesforce' | 'Gen3' | 'Manual'
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  last_synced_at   TIMESTAMP_NTZ,             -- When last copied from source system
  created_at       TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at       TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_profile_entities PRIMARY KEY (entity_id),
  CONSTRAINT uq_salesforce_entity UNIQUE (profile_id, salesforce_id)
);

-- Vector embeddings for SEMANTIC fields (unchanged structure)
CREATE TABLE profile_entity_embeddings (
  entity_id      VARCHAR(36)       NOT NULL,
  profile_id     VARCHAR(36)       NOT NULL,
  field_name     VARCHAR(100)      NOT NULL,
  source_text    VARCHAR(2000)     NOT NULL,
  embedding      VECTOR(FLOAT, 768) NOT NULL,
  model_version  VARCHAR(50)       NOT NULL DEFAULT 'e5-base-v2',
  generated_at   TIMESTAMP_NTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_entity_embeddings PRIMARY KEY (entity_id, profile_id, field_name)
);

-- Entity aliases — created during Manual Review
-- Links alternative field values to a canonical Salesforce ID
CREATE TABLE entity_alias (
  alias_id                    VARCHAR(36)   NOT NULL,
  profile_id                  VARCHAR(36)   NOT NULL,
  salesforce_id               VARCHAR(50)   NOT NULL,  -- Canonical SF record
  display_name                VARCHAR(500)  NOT NULL,
  alias_fields                VARIANT       NOT NULL,  -- JSON: field values that map to SF ID
  created_by                  VARCHAR(200)  NOT NULL,
  created_from_correlation_id VARCHAR(200),            -- Originating transaction/case ID
  embedding_status            VARCHAR(20)   NOT NULL DEFAULT 'PENDING', -- 'PENDING'|'EMBEDDED'
  is_active                   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_entity_alias PRIMARY KEY (alias_id)
);

-- Audit log (append-only — unchanged purpose, updated columns)
CREATE TABLE profile_match_log (
  log_id               VARCHAR(36)   NOT NULL,
  timestamp_utc        TIMESTAMP_NTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  profile_slug         VARCHAR(100)  NOT NULL,
  source_system        VARCHAR(20)   NOT NULL,    -- 'Salesforce' | 'Gen3' | 'AdminUI'
  correlation_id       VARCHAR(200),
  request_payload      VARIANT       NOT NULL,
  salesforce_id        VARCHAR(50),               -- Primary returned ID (null for NO_MATCH)
  matched_entity_id    VARCHAR(36),               -- Internal entity_id
  confidence_score     NUMBER(5,4),               -- 0.0000–1.0000
  resolution_scenario  VARCHAR(30)   NOT NULL,    -- EXACT_MATCH|HIGH_CONFIDENCE|LOW_CONFIDENCE|NO_MATCH
  field_scores         VARIANT,
  candidate_count      INTEGER       NOT NULL DEFAULT 0,
  was_cached           BOOLEAN       NOT NULL DEFAULT FALSE,
  threshold_used       NUMBER(5,4)   NOT NULL DEFAULT 0.9500,
  model_version        VARCHAR(50),
  profile_snapshot_ts  TIMESTAMP_NTZ,
  entities_snapshot_ts TIMESTAMP_NTZ,
  execution_ms         INTEGER,
  error_code           VARCHAR(50),
  error_message        VARCHAR(2000),
  CONSTRAINT pk_profile_match_log PRIMARY KEY (log_id)
);
```

---

## 21. Manual Review Flow & Requeue

This section describes the end-to-end flow for scenarios c (LOW_CONFIDENCE) and d (NO_MATCH).
The flow is identical for both Gen3 and Salesforce callers.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  MANUAL REVIEW FLOW (Scenarios c & d)                                       │
│                                                                             │
│  1. getMatchingEntity returns LOW_CONFIDENCE or NO_MATCH                    │
│                                                                             │
│  2. Caller (Gen3 / SF) routes transaction to Manual Review queue            │
│     → Transaction is PARKED (not processed further until resolved)          │
│     → Correlation ID links transaction to the resolution request            │
│                                                                             │
│  3. Manual Review UI displays:                                              │
│     [LOW_CONFIDENCE] → Shows candidates[] ranked by confidenceScore         │
│       User can:                                                             │
│         a) Accept a candidate → system creates EntityAlias:                 │
│              aliasFields = input fields from the transaction                │
│              salesforceId = selected candidate's salesforceId               │
│         b) None of the above → treat as NO_MATCH (proceed to step 3b)      │
│                                                                             │
│     [NO_MATCH] →                                                            │
│         a) Create new record in Salesforce (Buyer / Supplier table)         │
│            → SF governance workflow runs (KYC, approval, etc.)             │
│            → New SF record gets a Salesforce ID                             │
│         b) Optionally: create EntityAlias to map input to existing SF ID    │
│            (if the entity exists in SF but embeddings didn't catch it)      │
│                                                                             │
│  4. After alias creation OR new SF record creation:                         │
│     → User requeues the parked transaction (available after ~1 hour)       │
│                                                                             │
│  5. On requeue (~1 hour later, after EmbeddingRefreshJob ran):              │
│     → getMatchingEntity is called again with the same input fields          │
│     → AliasChecker finds the new alias → returns EXACT_MATCH (score=1.0)  │
│     → OR: entity is now in Snowflake with embeddings → HIGH_CONFIDENCE     │
│     → Transaction proceeds normally                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### EntityAlias Service

```typescript
// Handles alias creation from the Manual Review UI
@Injectable()
export class EntityAliasService {
  /**
   * Create an alias that maps the given field values to a canonical Salesforce ID.
   * The alias will be picked up by the next EmbeddingRefreshJob and embedded.
   * After embedding, getMatchingEntity will return EXACT_MATCH for these inputs.
   *
   * @param profileId   - Profile to create the alias in
   * @param salesforceId - The canonical SF record ID this alias should resolve to
   * @param aliasFields  - The field values (from the failed transaction) to alias
   * @param createdBy    - User who approved this alias mapping
   * @param correlationId - Transaction/case that triggered the Manual Review
   */
  async createAlias(
    profileId: string,
    salesforceId: string,
    aliasFields: Record<string, string>,
    createdBy: string,
    correlationId?: string,
  ): Promise<EntityAlias> { ... }
}
```

### NestJS Module Structure — Additions for v2.1

```
engine/src/
├── sync/                              # SyncModule — hourly data refresh
│   ├── sync.module.ts
│   ├── embedding-refresh.job.ts      # Processes new/updated entities + pending aliases
│   ├── cache-refresh.job.ts          # Flushes L0, records snapshot timestamp
│   └── __tests__/
│       ├── embedding-refresh.job.spec.ts
│       └── cache-refresh.job.spec.ts
│
├── aliases/                           # AliasModule — manual review alias management
│   ├── aliases.module.ts
│   ├── aliases.controller.ts          # POST /profiles/:slug/aliases
│   ├── aliases.service.ts             # EntityAliasService
│   ├── aliases.repository.ts          # IEntityAliasRepository implementation
│   └── dto/
│       ├── create-alias.dto.ts
│       └── alias-response.dto.ts
│
└── resolution/
    └── pipeline/
        ├── alias.checker.ts           # New: Step 0 — check entity_alias before pipeline
        └── ...existing pipeline files
```

### Alias Checker (new pipeline step 0)

```typescript
@Injectable()
export class AliasChecker {
  /**
   * Check if the input fields match any active alias in the entity_alias table.
   * This runs BEFORE cache check and fast-path to ensure aliases always win.
   *
   * @returns MatchingEntityResult with EXACT_MATCH and salesforceId if alias found, else null
   */
  async check(
    profileId: string,
    inputFields: Record<string, string>,
  ): Promise<MatchingEntityResult | null> {
    const alias = await this.aliasRepo.findMatchingAlias(profileId, inputFields);
    if (!alias) return null;

    return {
      salesforceId: alias.salesforceId,
      matchedEntity: { salesforceId: alias.salesforceId, displayName: alias.displayName, fieldValues: alias.aliasFields },
      confidenceScore: 1.0,
      resolutionScenario: 'EXACT_MATCH',
      fieldScores: [],
      candidates: [],
      wasCached: false,
      executionMs: 0,
      resolvedAt: new Date(),
    };
  }
}
```

---

## 22. Updated API Endpoints

```
POST   /profiles/:slug/getMatchingEntity        → MatchingEntityResult (single)
POST   /profiles/:slug/getMatchingEntity/batch  → BatchMatchingEntityResult (concurrent)

POST   /profiles/:slug/aliases                  → Create EntityAlias (Manual Review)
GET    /profiles/:slug/aliases                  → List aliases (paginated)
DELETE /profiles/:slug/aliases/:aliasId         → Soft-delete alias

GET    /profiles/:slug/entities                 → Paginated (salesforceId included in each)
POST   /profiles/:slug/entities/bulk            → Bulk load from external system

GET    /sync/status                             → Last EmbeddingRefreshJob run info
POST   /sync/trigger                            → Manually trigger refresh (admin only)

GET    /health                                  → { status, snowflake, redis, lastSyncAt }
GET    /stats                                   → Aggregate metrics (scenario breakdown, cache hit rate)
```

---

*Prepared by: Engineering Team*
*Date: February 2026*
*Version: 2.1.0*

---

**Design Principle Summary:**
> Snowflake is a world-class data warehouse and AI platform. Use it for what it excels at: storing vectors, generating embeddings, and warehousing audit data. Business logic — scoring, classifying, orchestrating — belongs in code that can be versioned, tested, and replaced without a DDL change.
>
> ResolveIQ's job is to classify. The Salesforce ID is the answer. The caller decides the action.
