import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A single entity for bulk load.
 * Accepts displayName or snake_case alias display_name (UI compatibility).
 */
export class BulkEntityItemDto {
  @ApiProperty({
    description: 'Field values for this entity',
    example: { name: 'Acme Corp', tax_id: '36-1234567', city: 'Chicago' },
  })
  @IsObject()
  fields!: Record<string, string>;

  @ApiPropertyOptional({ example: 'Acme Corporation' })
  @Transform(({ value, obj }) => {
    const raw = obj as Record<string, unknown>;
    return value ?? raw['display_name'];
  })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'SF-ACC-001' })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Request body for bulk loading entities into a profile.
 * Maximum 1000 entities per request.
 */
export class BulkLoadRequestDto {
  @ApiProperty({
    description: 'Entities to load (max 1000)',
    type: [BulkEntityItemDto],
    maxItems: 1000,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkEntityItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  entities!: BulkEntityItemDto[];
}

/**
 * Request body for updating an entity's fields.
 * Accepts displayName or snake_case alias display_name.
 */
export class UpdateEntityDto {
  @ApiProperty({
    description: 'Updated field values',
    example: { name: 'Acme Corporation', city: 'Chicago' },
  })
  @IsObject()
  fields!: Record<string, string>;

  @ApiPropertyOptional({ example: 'Acme Corporation' })
  @Transform(({ value, obj }) => {
    const raw = obj as Record<string, unknown>;
    return value ?? raw['display_name'];
  })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Response shape for a single entity.
 */
export class EntityResponseDto {
  @ApiProperty({ example: 'ENT-00000001' })
  entityId!: string;

  @ApiProperty({ example: 'PROF-SUPPLIER-001' })
  profileId!: string;

  @ApiProperty({ example: 'Acme Corporation' })
  displayName!: string;

  @ApiProperty({ example: { name: 'Acme Corp', tax_id: '36-1234567' } })
  fieldValues!: Record<string, string>;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ example: 'SF-ACC-001' })
  externalId?: string;

  @ApiProperty({ example: '2026-02-25T12:00:00.000Z' })
  createdAt!: string;
}

/**
 * Response shape for bulk load results.
 */
export class BulkLoadResultDto {
  @ApiProperty({ example: 50 })
  totalLoaded!: number;

  @ApiProperty({ example: 30, description: 'Number of embeddings generated for SEMANTIC fields' })
  embeddingsGenerated!: number;

  @ApiProperty({ example: 1250 })
  executionMs!: number;
}
