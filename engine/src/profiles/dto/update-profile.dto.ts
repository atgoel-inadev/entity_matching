import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const VALID_STRATEGIES = ['EXACT', 'FUZZY', 'SEMANTIC', 'PHONETIC', 'NUMERIC', 'HYBRID', 'NONE'] as const;
type StrategyValue = typeof VALID_STRATEGIES[number];

/**
 * DTO for partially updating a profile's configuration.
 * All fields are optional — only provided fields are updated.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Supplier Deduplication v2' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, example: 0.75 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  defaultThreshold?: number;

  @ApiPropertyOptional({ description: 'Soft-delete or restore the profile' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowAuthoritativeCreate?: boolean;
}

/**
 * DTO for updating an individual field on a profile.
 */
export class UpdateFieldDto {
  @ApiPropertyOptional({ enum: VALID_STRATEGIES })
  @IsOptional()
  @IsEnum(VALID_STRATEGIES)
  matchStrategy?: StrategyValue;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimaryDisplay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  strategyOptions?: Record<string, unknown>;
}
