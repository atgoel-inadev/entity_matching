import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IEntityRepository } from '../../common/ports/entity-repository.port';
import { INJECTION_TOKENS } from '../../common/tokens/injection-tokens';
import type { Profile } from '../../common/models/profile.model';
import type { CandidateScore } from '../../common/models/resolution.model';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';

/**
 * FastPathChecker executes direct SQL lookups for high-weight EXACT fields.
 *
 * When a profile has one or more EXACT fields with weight >= FAST_PATH_MIN_WEIGHT,
 * those fields are checked first via a simple SQL SELECT. This bypasses the entire
 * embedding + ANN pipeline and returns in <20ms.
 *
 * Example: a "tax_id" field with weight 5.0 triggers a fast-path lookup.
 * If an entity with that tax_id exists, it is returned immediately.
 */
@Injectable()
export class FastPathChecker {
  private readonly logger = new Logger(FastPathChecker.name);

  constructor(
    @Inject(INJECTION_TOKENS.ENTITY_REPOSITORY)
    private readonly entityRepository: IEntityRepository,
  ) {}

  /**
   * Checks whether any fast-path EXACT field matches an existing entity.
   *
   * @param profile - The resolution profile (contains fastPathFields list).
   * @param fields - The input field values from the resolve request.
   * @returns A CandidateScore with score 1.0 if found, or null if no fast-path match.
   */
  async check(
    profile: Profile,
    fields: Record<string, string>,
  ): Promise<CandidateScore | null> {
    if (profile.fastPathFields.length === 0) {
      return null;
    }

    for (const fieldName of profile.fastPathFields) {
      const inputValue = fields[fieldName];

      if (!inputValue?.trim()) {
        continue;
      }

      const entity = await this.entityRepository.findByExactField(
        profile.id,
        fieldName,
        inputValue,
      );

      if (entity) {
        this.logger.debug(
          `Fast-path match on field '${fieldName}' for profile '${profile.slug}'`,
        );

        return this.buildFastPathResult(entity.entityId, entity.displayName, entity.fieldValues, fieldName);
      }
    }

    return null;
  }

  private buildFastPathResult(
    entityId: string,
    displayName: string,
    fieldValues: Record<string, string>,
    matchedField: string,
  ): CandidateScore {
    const fieldScore = {
      fieldName: matchedField,
      strategy: 'EXACT' as const,
      weight: RESOLUTION_CONSTANTS.FAST_PATH_MIN_WEIGHT,
      inputValue: '',
      candidateValue: '',
      rawScore: RESOLUTION_CONSTANTS.PERFECT_SCORE,
      normalizedWeight: 1.0,
      weightedContribution: RESOLUTION_CONSTANTS.PERFECT_SCORE,
    };

    return {
      entityId,
      displayName,
      fieldValues,
      compositeScore: RESOLUTION_CONSTANTS.PERFECT_SCORE,
      fieldScores: [fieldScore],
      matchType: 'EXACT_FASTPATH',
      totalActiveWeight: RESOLUTION_CONSTANTS.FAST_PATH_MIN_WEIGHT,
      fieldsEvaluated: 1,
      isFastPath: true,
    };
  }
}
