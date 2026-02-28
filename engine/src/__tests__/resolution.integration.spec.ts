import { v4 as uuidv4 } from 'uuid';
import { ResolutionService } from '../resolution/resolution.service';
import { FastPathChecker } from '../resolution/pipeline/fast-path.checker';
import { EmbeddingFetcher } from '../resolution/pipeline/embedding.fetcher';
import { CandidateRetriever } from '../resolution/pipeline/candidate.retriever';
import { ScoringEngine } from '../resolution/pipeline/scoring.engine';
import { ScoreAggregator } from '../resolution/pipeline/score.aggregator';
import { MatchClassifier } from '../resolution/pipeline/match.classifier';
import { BatchProcessor } from '../resolution/pipeline/batch.processor';
import { StrategyRegistry } from '../strategies/strategy.registry';
import { ExactStrategy } from '../strategies/exact.strategy';
import { FuzzyStrategy } from '../strategies/fuzzy.strategy';
import { PhoneticStrategy } from '../strategies/phonetic.strategy';
import { NumericStrategy } from '../strategies/numeric.strategy';
import { SemanticStrategy } from '../strategies/semantic.strategy';
import { HybridStrategy } from '../strategies/hybrid.strategy';
import { NoneStrategy } from '../strategies/none.strategy';
import { FakeEntityRepository } from './fakes/fake-entity-repository';
import { FakeEmbeddingProvider } from './fakes/fake-embedding-provider';
import { FakeCacheProvider } from './fakes/fake-cache-provider';
import { FakeAuditLogger } from './fakes/fake-audit-logger';
import {
  SUPPLIER_PROFILE,
  SUPPLIER_ENTITIES,
  PERSON_PROFILE,
  PERSON_ENTITIES,
} from './fixtures/test-profiles';

// Suppress Logger output during tests
jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  Logger: class {
    log = jest.fn();
    debug = jest.fn();
    warn = jest.fn();
    error = jest.fn();
  },
  Injectable: () => () => undefined,
  Inject: () => () => undefined,
}));

/**
 * Builds a fully wired ResolutionService using in-memory fakes.
 * No Snowflake or Redis connection needed.
 */
function buildTestService() {
  const entityRepo = new FakeEntityRepository();
  const embeddingProvider = new FakeEmbeddingProvider();
  const cacheProvider = new FakeCacheProvider();
  const auditLogger = new FakeAuditLogger();

  entityRepo.seed([...SUPPLIER_ENTITIES, ...PERSON_ENTITIES]);

  const registry = new StrategyRegistry();
  const fuzzyStrategy = new FuzzyStrategy();
  const semanticStrategy = new SemanticStrategy();

  registry.register(new ExactStrategy());
  registry.register(fuzzyStrategy);
  registry.register(new PhoneticStrategy());
  registry.register(new NumericStrategy());
  registry.register(semanticStrategy);
  registry.register(new HybridStrategy(fuzzyStrategy, semanticStrategy));
  registry.register(new NoneStrategy());

  const fastPathChecker = new FastPathChecker(entityRepo as never);
  const embeddingFetcher = new EmbeddingFetcher(embeddingProvider as never);
  const candidateRetriever = new CandidateRetriever(entityRepo as never);
  const scoringEngine = new ScoringEngine(registry);
  const scoreAggregator = new ScoreAggregator();
  const matchClassifier = new MatchClassifier();
  const batchProcessor = new BatchProcessor();

  const service = new ResolutionService(
    fastPathChecker,
    embeddingFetcher,
    candidateRetriever,
    scoringEngine,
    scoreAggregator,
    matchClassifier,
    batchProcessor,
    cacheProvider as never,
    auditLogger as never,
    entityRepo as never,
  );

  return { service, entityRepo, cacheProvider, auditLogger };
}

describe('ResolutionService — Integration Tests', () => {
  let service: ReturnType<typeof buildTestService>['service'];
  let entityRepo: FakeEntityRepository;
  let cacheProvider: FakeCacheProvider;
  let auditLogger: FakeAuditLogger;

  beforeEach(() => {
    const testContext = buildTestService();
    service = testContext.service;
    entityRepo = testContext.entityRepo;
    cacheProvider = testContext.cacheProvider;
    auditLogger = testContext.auditLogger;
  });

  describe('EXACT fast-path resolution', () => {
    it('returns EXACT_FASTPATH match when tax_id matches exactly', async () => {
      const result = await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'supplier-dedup',
          fields: { tax_id: '36-1234567', name: 'Acme' },
        },
        SUPPLIER_PROFILE,
      );

      expect(result.matchType).toBe('EXACT_FASTPATH');
      expect(result.entityId).toBe('ent-acme-001');
      expect(result.isNewEntity).toBe(false);
      expect(result.matchScore).toBe(1.0);
    });

    it('returns EXACT_FASTPATH for email match on person profile', async () => {
      const result = await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'person-match',
          fields: { email: 'john.smith@example.com', first_name: 'John' },
        },
        PERSON_PROFILE,
      );

      expect(result.matchType).toBe('EXACT_FASTPATH');
      expect(result.entityId).toBe('ent-john-001');
    });
  });

  describe('FUZZY resolution (no fast-path field)', () => {
    it('returns a match for closely matching supplier name', async () => {
      const result = await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'supplier-dedup',
          fields: { name: 'Acme Corporaton' }, // single-char typo (missing 'i'), no tax_id
        },
        SUPPLIER_PROFILE,
      );

      // Should still find Acme Corporation via fuzzy matching (edit distance 1)
      expect(result.isNewEntity).toBe(false);
      expect(result.entityId).toBe('ent-acme-001');
    });
  });

  describe('NEW_ENTITY resolution', () => {
    it('returns NEW_ENTITY when no match found above threshold', async () => {
      const result = await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'supplier-dedup',
          fields: { name: 'Completely Unknown Company XYZ', country: 'JP' },
          threshold: 0.99, // Very high threshold → no match
        },
        SUPPLIER_PROFILE,
      );

      expect(result.matchType).toBe('NEW_ENTITY');
      expect(result.isNewEntity).toBe(true);
      expect(result.entityId).toBeUndefined();
    });

    it('creates entity when createIfMissing=true and no match', async () => {
      const result = await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'supplier-dedup',
          fields: { name: 'Brand New Entity', country: 'DE' },
          threshold: 0.99,
          createIfMissing: true,
        },
        SUPPLIER_PROFILE,
      );

      expect(result.matchType).toBe('NEW_ENTITY');
      expect(result.isNewEntity).toBe(true);
      expect(result.entityId).toBeDefined(); // Created
    });
  });

  describe('Caching behaviour', () => {
    it('returns wasCached=false on first call', async () => {
      const result = await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'supplier-dedup',
          fields: { tax_id: '36-1234567' },
        },
        SUPPLIER_PROFILE,
      );

      expect(result.wasCached).toBe(false);
    });

    it('writes result to cache after resolution', async () => {
      await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'supplier-dedup',
          fields: { tax_id: '36-1234567' },
        },
        SUPPLIER_PROFILE,
      );

      // Allow async cache write to complete
      await new Promise((resolve) => setImmediate(resolve));

      expect(cacheProvider.setCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Audit logging', () => {
    it('logs a resolution audit event for every resolve call', async () => {
      await service.resolve(
        {
          requestId: uuidv4(),
          profileSlug: 'supplier-dedup',
          fields: { tax_id: '36-1234567' },
        },
        SUPPLIER_PROFILE,
      );

      // Allow fire-and-forget audit write to complete
      await new Promise((resolve) => setImmediate(resolve));

      expect(auditLogger.events.length).toBe(1);
      expect(auditLogger.lastEvent()?.profileSlug).toBe('supplier-dedup');
    });
  });

  describe('Batch resolution', () => {
    it('processes multiple entities concurrently and returns all results', async () => {
      const result = await service.resolveBatch(
        [
          {
            requestId: uuidv4(),
            profileSlug: 'supplier-dedup',
            fields: { tax_id: '36-1234567' },
          },
          {
            requestId: uuidv4(),
            profileSlug: 'supplier-dedup',
            fields: { tax_id: '13-0871985' },
          },
          {
            requestId: uuidv4(),
            profileSlug: 'supplier-dedup',
            fields: { name: 'Unknown Company' },
          },
        ],
        SUPPLIER_PROFILE,
      );

      expect(result.totalProcessed).toBe(3);
      expect(result.results).toHaveLength(3);

      // First two should match (exact tax_id), third may be NEW_ENTITY
      expect(result.results[0].matchType).toBe('EXACT_FASTPATH');
      expect(result.results[1].matchType).toBe('EXACT_FASTPATH');
    });
  });
});
