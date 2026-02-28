import { v4 as uuidv4 } from 'uuid';
import type { IEntityRepository, EntityWithSimilarity, PaginatedEntities } from '../../common/ports/entity-repository.port';
import type { Entity, UpsertEntityInput } from '../../common/models/entity.model';

/**
 * In-memory Map-based implementation of IEntityRepository for testing.
 * No Snowflake connection required. Deterministic and fast.
 */
export class FakeEntityRepository implements IEntityRepository {
  private readonly store = new Map<string, Entity>();

  /** Seed the fake with pre-existing entities for test setup. */
  seed(entities: Entity[]): void {
    for (const entity of entities) {
      this.store.set(entity.entityId, entity);
    }
  }

  /** Clears all stored entities. */
  clear(): void {
    this.store.clear();
  }

  async findById(entityId: string): Promise<Entity | null> {
    return this.store.get(entityId) ?? null;
  }

  async findByExactField(
    profileId: string,
    fieldName: string,
    value: string,
  ): Promise<Entity | null> {
    const normalizedValue = value.trim().toLowerCase();

    for (const entity of this.store.values()) {
      if (entity.profileId !== profileId) continue;
      if (!entity.isActive) continue;

      const fieldValue = entity.fieldValues[fieldName];
      if (fieldValue?.trim().toLowerCase() === normalizedValue) {
        return entity;
      }
    }

    return null;
  }

  async getCandidatesByEmbedding(
    profileId: string,
    _fieldName: string,
    _embedding: Float32Array,
    topK: number,
    _minSimilarity: number,
  ): Promise<EntityWithSimilarity[]> {
    const candidates = Array.from(this.store.values())
      .filter((e) => e.profileId === profileId && e.isActive)
      .slice(0, topK)
      .map((entity) => ({ entity, similarity: 0.8 })); // Deterministic similarity for tests

    return candidates;
  }

  async getCandidatesByProfile(
    profileId: string,
    limit = 200,
  ): Promise<Entity[]> {
    return Array.from(this.store.values())
      .filter((e) => e.profileId === profileId && e.isActive)
      .slice(0, limit);
  }

  async upsert(input: UpsertEntityInput): Promise<Entity> {
    const entity: Entity = {
      entityId: uuidv4(),
      profileId: input.profileId,
      displayName: input.displayName,
      fieldValues: input.fieldValues,
      isActive: true,
      externalId: input.externalId,
      sourceSystem: input.sourceSystem,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.store.set(entity.entityId, entity);
    return entity;
  }

  async update(
    entityId: string,
    updates: { displayName?: string; fieldValues: Record<string, string> },
  ): Promise<Entity> {
    const existing = this.store.get(entityId);
    if (!existing) throw new Error(`Entity not found: ${entityId}`);
    const updated: Entity = {
      ...existing,
      displayName: updates.displayName ?? existing.displayName,
      fieldValues: updates.fieldValues,
      updatedAt: new Date(),
    };
    this.store.set(entityId, updated);
    return updated;
  }

  async softDelete(entityId: string): Promise<void> {
    const entity = this.store.get(entityId);
    if (entity) {
      this.store.set(entityId, { ...entity, isActive: false });
    }
  }

  async bulkInsert(
    profileId: string,
    inputs: UpsertEntityInput[],
  ): Promise<Entity[]> {
    return Promise.all(inputs.map((input) => this.upsert({ ...input, profileId })));
  }

  async listByProfile(
    profileId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedEntities> {
    const all = Array.from(this.store.values())
      .filter((e) => e.profileId === profileId && e.isActive);

    const start = (page - 1) * pageSize;
    return {
      entities: all.slice(start, start + pageSize),
      total: all.length,
    };
  }
}
