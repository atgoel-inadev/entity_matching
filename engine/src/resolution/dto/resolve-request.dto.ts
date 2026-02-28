import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * HTTP request body for resolving a single entity.
 * Accepts both camelCase (API standard) and snake_case (UI compatibility).
 */
export class ResolveRequestDto {
  @ApiProperty({
    description: 'Input field values to match against stored entities',
    example: { name: 'Acme Corp', tax_id: '36-1234567' },
  })
  @IsObject()
  fields!: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Override the profile default threshold (0.0–1.0)',
    minimum: 0,
    maximum: 1,
    example: 0.75,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold?: number;

  @ApiPropertyOptional({
    description: 'Create a new entity if no match is found (also accepted as create_if_missing)',
    default: false,
  })
  @Transform(({ value, obj }) => {
    const raw = obj as Record<string, unknown>;
    return value ?? raw['create_if_missing'];
  })
  @IsOptional()
  @IsBoolean()
  createIfMissing?: boolean;

  @ApiPropertyOptional({ description: 'Include pipeline debug information', default: false })
  @IsOptional()
  @IsBoolean()
  includeDebug?: boolean;

  @ApiPropertyOptional({
    description: 'Cross-system correlation ID for audit traceability',
    example: 'sf-flow-abc123',
  })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiPropertyOptional({
    description: 'Identifies the calling system for audit logging',
    example: 'Salesforce',
  })
  @IsOptional()
  @IsString()
  sourceSystem?: string;
}

/**
 * HTTP request body for batch entity resolution.
 * Maximum 50 entities per batch.
 */
export class BatchResolveRequestDto {
  @ApiProperty({
    description: 'Array of entity resolution requests (max 50)',
    type: [ResolveRequestDto],
    maxItems: 50,
  })
  entities!: ResolveRequestDto[];

  @ApiPropertyOptional({
    description: 'Cross-system correlation ID applied to all entities in this batch',
  })
  @IsOptional()
  @IsString()
  correlationId?: string;
}
