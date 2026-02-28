import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
} from '@nestjs/swagger';
import { EntitiesService } from './entities.service';
import { ProfilesService } from '../profiles/profiles.service';
import {
  BulkLoadRequestDto,
  BulkLoadResultDto,
  EntityResponseDto,
  UpdateEntityDto,
} from './dto/entity.dto';
import type { Entity } from '../common/models/entity.model';

/**
 * EntitiesController handles HTTP requests for entity management.
 * HTTP-only: no business logic — delegates to EntitiesService.
 */
@ApiTags('Entities')
@Controller('profiles/:slug/entities')
export class EntitiesController {
  constructor(
    private readonly entitiesService: EntitiesService,
    private readonly profilesService: ProfilesService,
  ) {}

  /**
   * Bulk-loads entities into a profile (max 1000 per request).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bulk load entities into a profile' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiResponse({ status: 201, type: BulkLoadResultDto })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async bulkLoad(
    @Param('slug') slug: string,
    @Body() dto: BulkLoadRequestDto,
  ): Promise<BulkLoadResultDto> {
    const profile = await this.profilesService.getBySlug(slug);

    const result = await this.entitiesService.bulkLoad(
      dto.entities.map((e) => ({
        fields: e.fields,
        displayName: e.displayName,
        externalId: e.externalId,
        metadata: e.metadata,
      })),
      profile,
    );

    return {
      totalLoaded: result.totalLoaded,
      embeddingsGenerated: result.embeddingsGenerated,
      executionMs: result.executionMs,
    };
  }

  /**
   * Lists entities in a profile with pagination.
   * Accepts limit/offset (UI) or page/pageSize (internal).
   */
  @Get()
  @ApiOperation({ summary: 'List entities in a profile (paginated)' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiResponse({ status: 200, description: 'Paginated entity list' })
  async list(
    @Param('slug') slug: string,
    @Query('limit') limit = 50,
    @Query('offset') offset = 0,
  ): Promise<{ entities: EntityResponseDto[]; total: number; limit: number; offset: number }> {
    const profile = await this.profilesService.getBySlug(slug);

    const resolvedLimit = Math.min(Number(limit), 500);
    const resolvedOffset = Number(offset);
    const page = Math.floor(resolvedOffset / resolvedLimit) + 1;

    const result = await this.entitiesService.list(
      profile.id,
      page,
      resolvedLimit,
    );

    return {
      entities: result.entities.map((e) => this.mapEntityToDto(e)),
      total: result.total,
      limit: resolvedLimit,
      offset: resolvedOffset,
    };
  }

  /**
   * Gets a single entity by ID.
   */
  @Get(':entityId')
  @ApiOperation({ summary: 'Get entity by ID' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiParam({ name: 'entityId' })
  @ApiResponse({ status: 200, type: EntityResponseDto })
  @ApiResponse({ status: 404, description: 'Entity not found' })
  async getById(
    @Param('slug') slug: string,
    @Param('entityId') entityId: string,
  ): Promise<EntityResponseDto> {
    await this.profilesService.getBySlug(slug); // Verify profile exists
    const entity = await this.entitiesService.getById(entityId);
    return this.mapEntityToDto(entity);
  }

  /**
   * Updates an entity's field values.
   */
  @Put(':entityId')
  @ApiOperation({ summary: 'Update entity fields' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiParam({ name: 'entityId' })
  @ApiResponse({ status: 200, type: EntityResponseDto })
  @ApiResponse({ status: 404, description: 'Entity not found' })
  async update(
    @Param('slug') slug: string,
    @Param('entityId') entityId: string,
    @Body() dto: UpdateEntityDto,
  ): Promise<EntityResponseDto> {
    const profile = await this.profilesService.getBySlug(slug);
    const entity = await this.entitiesService.update(
      entityId,
      { fields: dto.fields, displayName: dto.displayName },
      profile,
    );
    return this.mapEntityToDto(entity);
  }

  /**
   * Soft-deletes an entity.
   */
  @Delete(':entityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an entity' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiParam({ name: 'entityId' })
  @ApiResponse({ status: 204, description: 'Entity deleted' })
  @ApiResponse({ status: 404, description: 'Entity not found' })
  async softDelete(
    @Param('slug') slug: string,
    @Param('entityId') entityId: string,
  ): Promise<void> {
    await this.profilesService.getBySlug(slug); // Verify profile exists
    await this.entitiesService.softDelete(entityId);
  }

  private mapEntityToDto(entity: Entity): EntityResponseDto {
    return {
      entityId: entity.entityId,
      profileId: entity.profileId,
      displayName: entity.displayName,
      fieldValues: entity.fieldValues,
      isActive: entity.isActive,
      externalId: entity.externalId,
      createdAt: entity.createdAt.toISOString(),
    };
  }
}
