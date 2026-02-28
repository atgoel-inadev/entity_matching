import type { Entity, UpsertEntityInput } from '../models/entity.model';

/** A candidate entity paired with its ANN similarity score. */
export interface EntityWithSimilarity {
  readonly entity: Entity;
  readonly similarity: number;
}

/** Paginated list result. */
export interface PaginatedEntities {
  readonly entities: Entity[];
  readonly total: number;
}

/**
 * Port interface for entity persistence.
 * All SQL for entity operations lives exclusively in the adapter implementation.
 */
export interface IEntityRepository {
  /**
   * Retrieves a single entity by its primary key.
   * @returns The entity, or null if not found or inactive.
   */
  findById(entityId: string): Promise<Entity | null>;

  /**
   * Fast-path lookup: finds an entity where a specific EXACT field equals the given value.
   * Used by FastPathChecker to bypass the full embedding pipeline.
   * @param profileId - Scope to this profile.
   * @param fieldName - The EXACT field to look up (e.g., "tax_id").
   * @param value - The value to match (case-insensitive).
   */
  findByExactField(
    profileId: string,
    fieldName: string,
    value: string,
  ): Promise<Entity | null>;

  /**
   * Approximate nearest-neighbour candidate retrieval using vector cosine similarity.
   * Executes: VECTOR_COSINE_SIMILARITY(embedding, ?) >= minSimilarity ORDER BY DESC LIMIT topK
   * @param profileId - Scope to this profile.
   * @param fieldName - The SEMANTIC field whose embedding to compare against.
   * @param embedding - The query embedding (Float32Array, 768-dim).
   * @param topK - Maximum number of candidates to return.
   * @param minSimilarity - Minimum cosine similarity threshold (e.g., 0.4).
   */
  getCandidatesByEmbedding(
    profileId: string,
    fieldName: string,
    embedding: Float32Array,
    topK: number,
    minSimilarity: number,
  ): Promise<EntityWithSimilarity[]>;

  /**
   * Returns all active entities for a profile (used for non-semantic profiles).
   * @param profileId - Scope to this profile.
   * @param limit - Upper bound on the number returned.
   */
  getCandidatesByProfile(profileId: string, limit?: number): Promise<Entity[]>;

  /**
   * Inserts a new entity or updates an existing one (upsert by profileId + externalId).
   * Also stores the entity_id embedding if semantic fields are provided.
   */
  upsert(input: UpsertEntityInput): Promise<Entity>;

  /**
   * Updates an existing entity's field values and optional display name.
   * @param entityId - The entity to update.
   * @param updates - New field values and optional display name override.
   * @returns The updated entity.
   */
  update(
    entityId: string,
    updates: { displayName?: string; fieldValues: Record<string, string> },
  ): Promise<Entity>;

  /**
   * Soft-deletes an entity (sets is_active = false).
   */
  softDelete(entityId: string): Promise<void>;

  /**
   * Batch inserts multiple entities. More efficient than individual upsert calls.
   * @param profileId - All entities belong to this profile.
   * @param inputs - Array of entity inputs.
   */
  bulkInsert(
    profileId: string,
    inputs: UpsertEntityInput[],
  ): Promise<Entity[]>;

  /**
   * Returns a paginated list of entities for a profile.
   * @param profileId - Filter to this profile.
   * @param page - 1-based page number.
   * @param pageSize - Number of entities per page.
   */
  listByProfile(
    profileId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedEntities>;
}
