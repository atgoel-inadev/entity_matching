import {
  Controller,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { v4 as uuidv4 } from 'uuid';
import { ResolutionService } from './resolution.service';
import { ProfilesService } from '../profiles/profiles.service';
import { ResolveRequestDto, BatchResolveRequestDto } from './dto/resolve-request.dto';
import { ResolveResultDto, BatchResolveResultDto } from './dto/resolve-result.dto';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';
import { BatchSizeExceededError } from '../common/errors/domain-errors';

/**
 * ResolutionController handles HTTP requests for entity resolution.
 *
 * Responsibilities: parse slug, validate DTO, map to domain model, delegate to service.
 * No business logic lives here — controllers are HTTP-only adapters.
 */
@ApiTags('Resolution')
@Controller('profiles/:slug')
export class ResolutionController {
  constructor(
    private readonly resolutionService: ResolutionService,
    private readonly profilesService: ProfilesService,
  ) {}

  /**
   * Resolve a single entity against a profile.
   */
  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve single entity against a profile' })
  @ApiParam({ name: 'slug', description: 'Profile slug identifier', example: 'supplier-dedup' })
  @ApiBody({ type: ResolveRequestDto })
  @ApiResponse({ status: 200, type: ResolveResultDto, description: 'Resolution result' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  @ApiResponse({ status: 422, description: 'Resolution failed' })
  async resolve(
    @Param('slug') slug: string,
    @Body() body: ResolveRequestDto,
  ): Promise<ResolveResultDto> {
    const profile = await this.profilesService.getBySlug(slug);

    const result = await this.resolutionService.resolve(
      {
        requestId: uuidv4(),
        profileSlug: slug,
        fields: body.fields,
        threshold: body.threshold,
        createIfMissing: body.createIfMissing ?? false,
        includeDebug: body.includeDebug ?? false,
        correlationId: body.correlationId,
        sourceSystem: body.sourceSystem,
      },
      profile,
    );

    // Build field_scores object for UI compatibility (fieldName -> score)
    const fieldScoresObject: Record<string, number> = {};
    result.fieldScores.forEach((fs) => {
      fieldScoresObject[fs.fieldName] = fs.rawScore;
    });

    return {
      requestId: result.requestId,
      entityId: result.entityId,
      displayName: result.displayName,
      externalId: result.externalId,
      matchScore: result.matchScore,
      matchType: result.matchType,
      fieldScores: fieldScoresObject as any, // UI expects object, not array
      isNewEntity: result.isNewEntity,
      isAuthoritative: result.isAuthoritative,
      wasCached: result.wasCached,
      executionMs: result.executionMs,
      resolvedAt: typeof result.resolvedAt === 'string' 
        ? result.resolvedAt 
        : result.resolvedAt.toISOString(),
    };
  }

  /**
   * Resolve a batch of entities concurrently (max 50).
   */
  @Post('resolve/batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve batch of entities (max 50) concurrently' })
  @ApiParam({ name: 'slug', description: 'Profile slug identifier', example: 'supplier-dedup' })
  @ApiBody({ type: BatchResolveRequestDto })
  @ApiResponse({ status: 200, type: BatchResolveResultDto })
  @ApiResponse({ status: 400, description: 'Batch size exceeded' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async resolveBatch(
    @Param('slug') slug: string,
    @Body() body: BatchResolveRequestDto,
  ): Promise<BatchResolveResultDto> {
    if (body.entities.length > RESOLUTION_CONSTANTS.MAX_BATCH_SIZE) {
      throw new BatchSizeExceededError(
        body.entities.length,
        RESOLUTION_CONSTANTS.MAX_BATCH_SIZE,
      );
    }

    const profile = await this.profilesService.getBySlug(slug);

    const requests = body.entities.map((entity) => ({
      requestId: uuidv4(),
      profileSlug: slug,
      fields: entity.fields,
      threshold: entity.threshold,
      createIfMissing: entity.createIfMissing ?? false,
      correlationId: body.correlationId ?? entity.correlationId,
      sourceSystem: entity.sourceSystem,
    }));

    const batchResult = await this.resolutionService.resolveBatch(requests, profile);

    return {
      totalProcessed: batchResult.totalProcessed,
      totalExecutionMs: batchResult.totalExecutionMs,
      results: batchResult.results.map((result) => ({
        requestId: result.requestId,
        entityId: result.entityId,
        displayName: result.displayName,
        externalId: result.externalId,
        matchScore: result.matchScore,
        matchType: result.matchType,
        fieldScores: result.fieldScores.map((fs) => ({
          fieldName: fs.fieldName,
          strategy: fs.strategy,
          weight: fs.weight,
          inputValue: fs.inputValue,
          candidateValue: fs.candidateValue,
          rawScore: fs.rawScore,
          normalizedWeight: fs.normalizedWeight,
          weightedContribution: fs.weightedContribution,
        })),
        isNewEntity: result.isNewEntity,
        isAuthoritative: result.isAuthoritative,
        wasCached: result.wasCached,
        executionMs: result.executionMs,
        resolvedAt: result.resolvedAt.toISOString(),
      })),
    };
  }

  /**
   * Finds all entities similar to the input fields above the threshold.
   * Returns a ranked list without creating new entities.
   */
  @Post('find-similar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find similar entities above threshold (no entity creation)' })
  @ApiParam({ name: 'slug', description: 'Profile slug identifier', example: 'supplier-dedup' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiBody({ type: ResolveRequestDto })
  @ApiResponse({ status: 200, description: 'Ranked list of similar entities' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async findSimilar(
    @Param('slug') slug: string,
    @Body() body: ResolveRequestDto,
    @Query('limit') limit = 10,
  ): Promise<Array<{ entityId?: string; displayName?: string; matchScore: number }>> {
    const profile = await this.profilesService.getBySlug(slug);

    const candidates = await this.resolutionService.findSimilar(
      {
        requestId: uuidv4(),
        profileSlug: slug,
        fields: body.fields,
        threshold: body.threshold,
        createIfMissing: false,
        includeDebug: false,
      },
      profile,
      Math.min(Number(limit), 50),
    );

    return candidates.map((c) => ({
      entityId: c.entityId,
      displayName: c.displayName,
      matchScore: c.compositeScore,
    }));
  }
}
