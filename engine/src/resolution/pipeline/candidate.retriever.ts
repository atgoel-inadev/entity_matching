import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IEntityRepository } from '../../common/ports/entity-repository.port';
import { INJECTION_TOKENS } from '../../common/tokens/injection-tokens';
import type { Profile } from '../../common/models/profile.model';
import type { Entity } from '../../common/models/entity.model';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';

/**
 * CandidateRetriever fetches the set of candidate entities to score.
 *
 * For profiles with SEMANTIC/HYBRID fields:
 *   Uses ANN (Approximate Nearest Neighbour) via Snowflake VECTOR_COSINE_SIMILARITY.
 *   Returns top-K candidates per semantic field, deduplicated by entityId.
 *
 * For profiles with only EXACT/FUZZY/PHONETIC/NUMERIC fields:
 *   Returns all active entities up to DEFAULT_NON_SEMANTIC_CANDIDATE_LIMIT.
 *   These are small, stable populations (typically <1000 entities).
 */
@Injectable()
export class CandidateRetriever {
  private readonly logger = new Logger(CandidateRetriever.name);

  constructor(
    @Inject(INJECTION_TOKENS.ENTITY_REPOSITORY)
    private readonly entityRepository: IEntityRepository,
  ) {}

  /**
   * Retrieves candidate entities for the given profile and input fields.
   *
   * @param profile - The resolution profile (contains semanticFields list).
   * @param fields - Input field values from the resolve request.
   * @param inputEmbeddings - Pre-fetched embeddings for semantic fields.
   * @param topK - Maximum candidates to retrieve per semantic field.
   * @returns Deduplicated list of candidate entities.
   */
  async getCandidates(
    profile: Profile,
    fields: Record<string, string>,
    inputEmbeddings: Map<string, Float32Array>,
    topK = RESOLUTION_CONSTANTS.DEFAULT_CANDIDATE_TOP_K,
  ): Promise<Entity[]> {
    if (profile.semanticFields.length > 0 && inputEmbeddings.size > 0) {
      return this.getSemanticCandidates(profile, inputEmbeddings, topK);
    }

    return this.getNonSemanticCandidates(profile.id);
  }

  private async getSemanticCandidates(
    profile: Profile,
    inputEmbeddings: Map<string, Float32Array>,
    topK: number,
  ): Promise<Entity[]> {
    const candidateMap = new Map<string, Entity>();

    for (const fieldName of profile.semanticFields) {
      const embedding = inputEmbeddings.get(fieldName);

      if (!embedding) {
        continue;
      }

      const results = await this.entityRepository.getCandidatesByEmbedding(
        profile.id,
        fieldName,
        embedding,
        topK,
        RESOLUTION_CONSTANTS.DEFAULT_SEMANTIC_MIN_SIMILARITY,
      );

      for (const { entity, similarity } of results) {
        const existing = candidateMap.get(entity.entityId);
        if (existing) {
          // Merge similarity scores for multiple semantic fields
          existing._scoringMetadata = {
            ...existing._scoringMetadata,
            [fieldName]: similarity,
          };
        } else {
          // Attach ANN similarity score to entity for scoring optimization
          candidateMap.set(entity.entityId, {
            ...entity,
            _scoringMetadata: { [fieldName]: similarity },
          });
        }
      }
    }

    this.logger.debug(
      `Retrieved ${candidateMap.size} unique candidates via ANN for profile '${profile.slug}'`,
    );

    return Array.from(candidateMap.values());
  }

  private async getNonSemanticCandidates(profileId: string): Promise<Entity[]> {
    const candidates = await this.entityRepository.getCandidatesByProfile(
      profileId,
      RESOLUTION_CONSTANTS.DEFAULT_NON_SEMANTIC_CANDIDATE_LIMIT,
    );

    this.logger.debug(
      `Retrieved ${candidates.length} candidates for non-semantic profile '${profileId}'`,
    );

    return candidates;
  }
}
