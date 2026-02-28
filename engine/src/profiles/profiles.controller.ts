import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { CreateProfileDto, CreateFieldDto } from './dto/create-profile.dto';
import { UpdateProfileDto, UpdateFieldDto } from './dto/update-profile.dto';
import type { Profile } from '../common/models/profile.model';

/**
 * ProfilesController manages resolution profile CRUD and field configuration.
 * HTTP-only: no business logic — delegates entirely to ProfilesService.
 */
@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'List all active profiles' })
  @ApiQuery({ name: 'active_only', required: false, type: Boolean, description: 'Filter to active profiles only (default true)' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'List of profiles' })
  async listAll(
    @Query('includeInactive') includeInactive?: string,
    @Query('active_only') activeOnly?: string,
  ): Promise<Profile[]> {
    let shouldIncludeInactive: boolean;
    if (activeOnly !== undefined) {
      // active_only=true → only show active → includeInactive=false
      shouldIncludeInactive = activeOnly === 'false';
    } else {
      shouldIncludeInactive = includeInactive === 'true';
    }
    return this.profilesService.listAll(shouldIncludeInactive);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new resolution profile' })
  @ApiResponse({ status: 201, description: 'Profile created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(@Body() dto: CreateProfileDto): Promise<Profile> {
    return this.profilesService.create({
      slug: dto.slug,
      name: dto.name,
      entityType: dto.entityType,
      defaultThreshold: dto.defaultThreshold,
      fields: dto.fields?.map((f) => ({
        fieldName: f.fieldName,
        matchStrategy: f.matchStrategy,
        weight: f.weight,
        isRequired: f.isRequired ?? false,
        isPrimaryDisplay: f.isPrimaryDisplay ?? false,
        isFastPath: f.matchStrategy === 'EXACT' && f.weight >= 3.0,
        fieldOrder: f.fieldOrder ?? 0,
        strategyOptions: f.strategyOptions,
      })),
      sourceSystem: dto.sourceSystem,
      externalIdField: dto.externalIdField,
      allowAuthoritativeCreate: dto.allowAuthoritativeCreate ?? true,
    });
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get profile by slug' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiResponse({ status: 200, description: 'Profile detail' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getBySlug(@Param('slug') slug: string): Promise<Profile> {
    return this.profilesService.getBySlug(slug);
  }

  @Put(':slug')
  @ApiOperation({ summary: 'Update profile metadata' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiResponse({ status: 200, description: 'Updated profile' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async update(
    @Param('slug') slug: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<Profile> {
    return this.profilesService.update(slug, dto);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a profile' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiResponse({ status: 204, description: 'Profile deleted' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async softDelete(@Param('slug') slug: string): Promise<void> {
    await this.profilesService.softDelete(slug);
  }

  @Post(':slug/fields')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a field to a profile' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  async addField(
    @Param('slug') slug: string,
    @Body() dto: CreateFieldDto,
  ): Promise<Profile> {
    return this.profilesService.addField(slug, {
      fieldName: dto.fieldName,
      matchStrategy: dto.matchStrategy,
      weight: dto.weight,
      isRequired: dto.isRequired ?? false,
      isPrimaryDisplay: dto.isPrimaryDisplay ?? false,
      isFastPath: dto.matchStrategy === 'EXACT' && dto.weight >= 3.0,
      fieldOrder: dto.fieldOrder ?? 0,
      strategyOptions: dto.strategyOptions,
    });
  }

  @Put(':slug/fields/:fieldName')
  @ApiOperation({ summary: 'Update a field configuration' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'fieldName', example: 'name' })
  async updateField(
    @Param('slug') slug: string,
    @Param('fieldName') fieldName: string,
    @Body() dto: UpdateFieldDto,
  ): Promise<Profile> {
    return this.profilesService.updateField(slug, fieldName, dto);
  }

  @Delete(':slug/fields/:fieldName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a field from a profile' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'fieldName', example: 'name' })
  async removeField(
    @Param('slug') slug: string,
    @Param('fieldName') fieldName: string,
  ): Promise<void> {
    await this.profilesService.removeField(slug, fieldName);
  }

  @Delete(':slug/cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invalidate all cached results for a profile' })
  @ApiParam({ name: 'slug' })
  async invalidateCache(
    @Param('slug') slug: string,
  ): Promise<{ message: string }> {
    await this.profilesService.invalidateProfileCache(slug);
    return { message: `Cache invalidated for profile '${slug}'` };
  }
}
