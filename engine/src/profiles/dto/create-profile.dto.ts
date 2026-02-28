import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
  Max,
  IsEnum,
  ValidateNested,
  IsInt,
  IsPositive,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Valid matching strategy enum values. */
const VALID_STRATEGIES = ['EXACT', 'FUZZY', 'SEMANTIC', 'PHONETIC', 'NUMERIC', 'HYBRID', 'NONE'] as const;
type StrategyValue = typeof VALID_STRATEGIES[number];

/**
 * DTO for adding or modifying a field on a profile.
 */
export class CreateFieldDto {
  @ApiProperty({ example: 'name' })
  @IsString()
  fieldName!: string;

  @ApiProperty({ enum: VALID_STRATEGIES, example: 'SEMANTIC' })
  @IsEnum(VALID_STRATEGIES)
  matchStrategy!: StrategyValue;

  @ApiProperty({ minimum: 0, maximum: 10, example: 5.0 })
  @IsNumber()
  @Min(0)
  @Max(10)
  weight!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({
    description: 'Mark as primary display field (used for displayName derivation)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPrimaryDisplay?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  fieldOrder?: number;

  @ApiPropertyOptional({ description: 'Strategy-specific blend ratios or options' })
  @IsOptional()
  strategyOptions?: Record<string, unknown>;
}

/**
 * DTO for creating a new resolution profile.
 */
export class CreateProfileDto {
  @ApiProperty({
    description: 'URL-safe profile identifier used in API paths',
    example: 'supplier-dedup',
    pattern: '^[a-z0-9-]+$',
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, digits, and hyphens',
  })
  slug!: string;

  @ApiProperty({ example: 'Supplier Deduplication' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Supplier' })
  @IsString()
  entityType!: string;

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.7 })
  @IsNumber()
  @Min(0)
  @Max(1)
  defaultThreshold!: number;

  @ApiPropertyOptional({ type: [CreateFieldDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFieldDto)
  fields?: CreateFieldDto[];

  @ApiPropertyOptional({ example: 'Salesforce' })
  @IsOptional()
  @IsString()
  sourceSystem?: string;

  @ApiPropertyOptional({ example: 'sf_buyer_id' })
  @IsOptional()
  @IsString()
  externalIdField?: string;

  @ApiPropertyOptional({
    description: 'Allow entities to be created directly (false = route to external system)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  allowAuthoritativeCreate?: boolean;
}
