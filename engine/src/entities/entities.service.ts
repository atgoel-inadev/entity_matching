import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IEntityRepository, PaginatedEntities } from '../common/ports/entity-repository.port';
import type { IEmbeddingProvider } from '../common/ports/embedding-provider.port';
import { INJECTION_TOKENS } from '../common/tokens/injection-tokens';
import type { Entity, BulkEntityInput, BulkLoadResult } from '../common/models/entity.model';
import type { Profile } from '../common/models/profile.model';
import { EntityNotFoundError } from '../common/errors/domain-errors';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * EntitiesService manages entity lifecycle operations:
 * bulk loading, updating, soft deletion, and paginated listing.
 *
 * For SEMANTIC/HYBRID fields, this service also generates and stores embeddings
 * via the IEmbeddingProvider port (Snowflake Cortex).
 */
@Injectable()
export class EntitiesService {
  private readonly logger = new Logger(EntitiesService.name);

  constructor(
    @Inject(INJECTION_TOKENS.ENTITY_REPOSITORY)
    private readonly entityRepository: IEntityRepository,
    @Inject(INJECTION_TOKENS.EMBEDDING_PROVIDER)
    private readonly embeddingProvider: IEmbeddingProvider,
  ) {}

  /**
   * Bulk-loads entities into a profile, generating embeddings for SEMANTIC/HYBRID fields.
   * @param inputs - Array of entity inputs.
   * @param profile - The target profile (used to identify semantic fields).
   * @returns Summary of loaded entities and embeddings generated.
   */
  async bulkLoad(
    inputs: BulkEntityInput[],
    profile: Profile,
  ): Promise<BulkLoadResult> {
    const startTime = Date.now();
    let embeddingsGenerated = 0;

    const upsertInputs = await Promise.all(
      inputs.map(async (input) => {
        const semanticEmbeddings = await this.generateEmbeddingsForEntity(
          input.fields,
          profile,
        );
        embeddingsGenerated += semanticEmbeddings.size;

        return {
          profileId: profile.id,
          displayName: input.displayName ?? this.deriveDisplayName(input.fields, profile),
          fieldValues: input.fields,
          externalId: input.externalId,
          embeddings: semanticEmbeddings,
        };
      }),
    );

    await this.entityRepository.bulkInsert(
      profile.id,
      upsertInputs.map(({ embeddings: _emb, ...rest }) => rest),
    );

    const executionMs = Date.now() - startTime;

    this.logger.log(
      `Bulk loaded ${inputs.length} entities into profile '${profile.slug}' ` +
      `(${embeddingsGenerated} embeddings, ${executionMs}ms)`,
    );

    return {
      totalLoaded: inputs.length,
      embeddingsGenerated,
      executionMs,
    };
  }

  /**
   * Returns a paginated list of active entities for a profile.
   * @param profileId - The profile to list entities for.
   * @param page - 1-based page number.
   * @param pageSize - Entities per page (max 500).
   */
  async list(
    profileId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedEntities> {
    return this.entityRepository.listByProfile(profileId, page, pageSize);
  }

  /**
   * Retrieves a single entity by ID.
   * @throws EntityNotFoundError if the entity does not exist.
   */
  async getById(entityId: string): Promise<Entity> {
    const entity = await this.entityRepository.findById(entityId);

    if (!entity) {
      throw new EntityNotFoundError(entityId);
    }

    return entity;
  }

  /**
   * Updates an entity's field values and optionally its display name.
   * @param entityId - The entity to update.
   * @param data - New field values and optional display name.
   * @param profile - The profile (used to regenerate embeddings for SEMANTIC fields).
   * @throws EntityNotFoundError if the entity does not exist.
   */
  async update(
    entityId: string,
    data: { fields: Record<string, string>; displayName?: string },
    profile: Profile,
  ): Promise<Entity> {
    await this.getById(entityId); // Verify existence

    const entity = await this.entityRepository.update(entityId, {
      displayName: data.displayName,
      fieldValues: data.fields,
    });

    // Regenerate embeddings for SEMANTIC/HYBRID fields asynchronously
    const embeddings = await this.generateEmbeddingsForEntity(data.fields, profile);
    if (embeddings.size > 0) {
      this.logger.debug(`Regenerated ${embeddings.size} embeddings for entity ${entityId}`);
    }

    return entity;
  }

  /**
   * Soft-deletes an entity (marks is_active = false).
   * @throws EntityNotFoundError if the entity does not exist.
   */
  async softDelete(entityId: string): Promise<void> {
    await this.getById(entityId); // Verifies existence
    await this.entityRepository.softDelete(entityId);
    this.logger.log(`Soft-deleted entity: ${entityId}`);
  }

  private async generateEmbeddingsForEntity(
    fields: Record<string, string>,
    profile: Profile,
  ): Promise<Map<string, Float32Array>> {
    const semanticFieldsWithValues = profile.semanticFields.filter(
      (fieldName) => fields[fieldName]?.trim(),
    );

    if (semanticFieldsWithValues.length === 0) {
      return new Map();
    }

    const texts = semanticFieldsWithValues.map((name) => fields[name]);
    const embeddings = await this.embeddingProvider.generateEmbeddings(texts);

    const result = new Map<string, Float32Array>();
    for (let i = 0; i < semanticFieldsWithValues.length; i++) {
      result.set(semanticFieldsWithValues[i], embeddings[i]);
    }

    return result;
  }

  private deriveDisplayName(
    fields: Record<string, string>,
    profile: Profile,
  ): string {
    const primaryField = profile.fields.find((f) => f.isPrimaryDisplay);
    if (primaryField && fields[primaryField.fieldName]) {
      return fields[primaryField.fieldName];
    }
    return Object.values(fields)[0] ?? 'Unknown';
  }
}
