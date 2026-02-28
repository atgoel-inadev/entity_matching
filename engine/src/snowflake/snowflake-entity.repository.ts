import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { IEntityRepository, EntityWithSimilarity, PaginatedEntities } from '../common/ports/entity-repository.port';
import type { Entity, UpsertEntityInput } from '../common/models/entity.model';
import { SnowflakeService } from './snowflake.service';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * SnowflakeEntityRepository implements IEntityRepository using raw Snowflake SQL.
 *
 * All SQL for entity operations lives exclusively in this class.
 * Service layer must never contain SQL — only this repository interacts with the database.
 *
 * Key queries:
 *  - findByExactField: fast-path lookup (no embedding needed)
 *  - getCandidatesByEmbedding: ANN via VECTOR_COSINE_SIMILARITY
 *  - upsert: INSERT entity + INSERT embeddings for SEMANTIC fields
 */
@Injectable()
export class SnowflakeEntityRepository implements IEntityRepository {
  private readonly logger = new Logger(SnowflakeEntityRepository.name);

  constructor(private readonly snowflakeService: SnowflakeService) {}

  /** {@inheritDoc IEntityRepository.findById} */
  async findById(entityId: string): Promise<Entity | null> {
    const rows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
      `SELECT entity_id, profile_id, display_name, field_values,
              is_active,
              CASE
                WHEN SOURCE_SYSTEM = 'Salesforce' THEN SALESFORCE_ID
                WHEN SOURCE_SYSTEM = 'Gen3' THEN GEN3_ID
                ELSE NULL
              END AS external_id,
              SOURCE_SYSTEM, version,
              created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
       FROM profile_entities
       WHERE entity_id = ? AND is_active = TRUE`,
      [entityId],
    );

    return rows[0] ? this.mapRowToEntity(rows[0]) : null;
  }

  /** {@inheritDoc IEntityRepository.findByExactField} */
  async findByExactField(
    profileId: string,
    fieldName: string,
    value: string,
  ): Promise<Entity | null> {
    const rows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
      `SELECT entity_id, profile_id, display_name, field_values,
              is_active,
              CASE
                WHEN SOURCE_SYSTEM = 'Salesforce' THEN SALESFORCE_ID
                WHEN SOURCE_SYSTEM = 'Gen3' THEN GEN3_ID
                ELSE NULL
              END AS external_id,
              SOURCE_SYSTEM, version,
              created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
       FROM profile_entities
       WHERE profile_id = ?
         AND is_active = TRUE
         AND LOWER(TRIM(field_values[?]::VARCHAR)) = LOWER(TRIM(?))
       LIMIT 1`,
      [profileId, fieldName, value],
    );

    return rows[0] ? this.mapRowToEntity(rows[0]) : null;
  }

  /** {@inheritDoc IEntityRepository.getCandidatesByEmbedding} */
  async getCandidatesByEmbedding(
    profileId: string,
    fieldName: string,
    embedding: Float32Array,
    topK: number,
    minSimilarity: number,
  ): Promise<EntityWithSimilarity[]> {
    const embeddingArray = Array.from(embedding);
    const embeddingJson = JSON.stringify(embeddingArray);
    const vectorDim = RESOLUTION_CONSTANTS.EMBEDDING_DIMENSIONS;

    const rows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
      `SELECT pe.entity_id, pe.profile_id, pe.display_name, pe.field_values,
              pe.is_active,
              CASE
                WHEN pe.SOURCE_SYSTEM = 'Salesforce' THEN pe.SALESFORCE_ID
                WHEN pe.SOURCE_SYSTEM = 'Gen3' THEN pe.GEN3_ID
                ELSE NULL
              END AS external_id,
              pe.SOURCE_SYSTEM, pe.version,
              pe.created_at::VARCHAR AS created_at, pe.updated_at::VARCHAR AS updated_at,
              VECTOR_COSINE_SIMILARITY(pee.embedding, PARSE_JSON(?)::VECTOR(FLOAT, ${vectorDim})) AS similarity
       FROM profile_entity_embeddings pee
       JOIN profile_entities pe ON pe.entity_id = pee.entity_id AND pe.is_active = TRUE
       WHERE pee.profile_id = ?
         AND pee.field_name = ?
         AND VECTOR_COSINE_SIMILARITY(pee.embedding, PARSE_JSON(?)::VECTOR(FLOAT, ${vectorDim})) >= ?
       ORDER BY similarity DESC
       LIMIT ?`,
      [embeddingJson, profileId, fieldName, embeddingJson, minSimilarity, topK],
    );

    return rows.map((row) => ({
      entity: this.mapRowToEntity(row),
      similarity: row['SIMILARITY'] as number,
    }));
  }

  /** {@inheritDoc IEntityRepository.getCandidatesByProfile} */
  async getCandidatesByProfile(
    profileId: string,
    limit = RESOLUTION_CONSTANTS.DEFAULT_NON_SEMANTIC_CANDIDATE_LIMIT,
  ): Promise<Entity[]> {
    const rows = await this.snowflakeService.executeQuery<Record<string, unknown>>(
      `SELECT entity_id, profile_id, display_name, field_values,
              is_active,
              CASE
                WHEN SOURCE_SYSTEM = 'Salesforce' THEN SALESFORCE_ID
                WHEN SOURCE_SYSTEM = 'Gen3' THEN GEN3_ID
                ELSE NULL
              END AS external_id,
              SOURCE_SYSTEM, version,
              created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
       FROM profile_entities
       WHERE profile_id = ? AND is_active = TRUE
       ORDER BY created_at DESC
       LIMIT ?`,
      [profileId, limit],
    );

    return rows.map((row) => this.mapRowToEntity(row));
  }

  /** {@inheritDoc IEntityRepository.upsert} */
  async upsert(input: UpsertEntityInput): Promise<Entity> {
    const entityId = uuidv4();
    const fieldValuesJson = JSON.stringify(input.fieldValues);

    // Determine which ID column to populate based on source system
    const sourceSystem = input.sourceSystem ?? 'Manual';
    const salesforceId = sourceSystem === 'Salesforce' ? (input.externalId ?? null) : null;
    const gen3Id = sourceSystem === 'Gen3' ? (input.externalId ?? null) : null;

    await this.snowflakeService.executeQuery(
      `INSERT INTO profile_entities
         (entity_id, profile_id, display_name, field_values, SALESFORCE_ID, GEN3_ID, SOURCE_SYSTEM, version)
       VALUES (?, ?, ?, PARSE_JSON(?), ?, ?, ?, 1)`,
      [entityId, input.profileId, input.displayName, fieldValuesJson, salesforceId, gen3Id, sourceSystem],
    );

    this.logger.debug(`Upserted entity ${entityId} in profile ${input.profileId}`);

    const entity = await this.findById(entityId);
    if (!entity) {
      throw new Error(`Failed to retrieve newly created entity ${entityId}`);
    }

    return entity;
  }

  /** {@inheritDoc IEntityRepository.update} */
  async update(
    entityId: string,
    updates: { displayName?: string; fieldValues: Record<string, string> },
  ): Promise<Entity> {
    const fieldValuesJson = JSON.stringify(updates.fieldValues);

    await this.snowflakeService.executeQuery(
      `UPDATE profile_entities
       SET field_values = PARSE_JSON(?),
           display_name = COALESCE(?, display_name),
           updated_at = CURRENT_TIMESTAMP()
       WHERE entity_id = ? AND is_active = TRUE`,
      [fieldValuesJson, updates.displayName ?? null, entityId],
    );

    const entity = await this.findById(entityId);
    if (!entity) {
      throw new Error(`Entity not found after update: ${entityId}`);
    }
    return entity;
  }

  /** {@inheritDoc IEntityRepository.softDelete} */
  async softDelete(entityId: string): Promise<void> {
    await this.snowflakeService.executeQuery(
      `UPDATE profile_entities
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP()
       WHERE entity_id = ?`,
      [entityId],
    );
  }

  /** {@inheritDoc IEntityRepository.bulkInsert} */
  async bulkInsert(
    profileId: string,
    inputs: UpsertEntityInput[],
  ): Promise<Entity[]> {
    const entities: Entity[] = [];

    for (const input of inputs) {
      const entity = await this.upsert({ ...input, profileId });
      entities.push(entity);
    }

    return entities;
  }

  /** {@inheritDoc IEntityRepository.listByProfile} */
  async listByProfile(
    profileId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedEntities> {
    const offset = (page - 1) * pageSize;

    const [entities, countRows] = await Promise.all([
      this.snowflakeService.executeQuery<Record<string, unknown>>(
        `SELECT entity_id, profile_id, display_name, field_values,
                is_active,
                CASE
                  WHEN SOURCE_SYSTEM = 'Salesforce' THEN SALESFORCE_ID
                  WHEN SOURCE_SYSTEM = 'Gen3' THEN GEN3_ID
                  ELSE NULL
                END AS external_id,
                SOURCE_SYSTEM, version,
                created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at
         FROM profile_entities
         WHERE profile_id = ? AND is_active = TRUE
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [profileId, pageSize, offset],
      ),
      this.snowflakeService.executeQuery<{ COUNT: number }>(
        `SELECT COUNT(*) AS count FROM profile_entities WHERE profile_id = ? AND is_active = TRUE`,
        [profileId],
      ),
    ]);

    return {
      entities: entities.map((row) => this.mapRowToEntity(row)),
      total: countRows[0]?.COUNT ?? 0,
    };
  }

  private mapRowToEntity(row: Record<string, unknown>): Entity {
    const fieldValues = typeof row['FIELD_VALUES'] === 'string'
      ? JSON.parse(row['FIELD_VALUES'])
      : row['FIELD_VALUES'] ?? {};

    return {
      entityId: row['ENTITY_ID'] as string,
      profileId: row['PROFILE_ID'] as string,
      displayName: row['DISPLAY_NAME'] as string,
      fieldValues: fieldValues as Record<string, string>,
      isActive: Boolean(row['IS_ACTIVE']),
      externalId: row['EXTERNAL_ID'] as string | undefined,
      sourceSystem: row['SOURCE_SYSTEM'] as string | undefined,
      version: (row['VERSION'] as number) ?? 1,
      createdAt: new Date(row['CREATED_AT'] as string),
      updatedAt: new Date(row['UPDATED_AT'] as string),
    };
  }
}
