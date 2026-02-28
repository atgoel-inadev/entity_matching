import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MatchType } from '../../common/models/resolution.model';

/**
 * Per-field score breakdown in the resolution response.
 */
export class FieldScoreDto {
  @ApiProperty({ example: 'name' })
  fieldName!: string;

  @ApiProperty({ example: 'SEMANTIC', enum: ['EXACT', 'FUZZY', 'SEMANTIC', 'PHONETIC', 'NUMERIC', 'HYBRID', 'NONE'] })
  strategy!: string;

  @ApiProperty({ example: 5.0 })
  weight!: number;

  @ApiProperty({ example: 'Acme Corp' })
  inputValue!: string;

  @ApiProperty({ example: 'Acme Corporation' })
  candidateValue!: string;

  @ApiProperty({ example: 0.92, minimum: 0, maximum: 1 })
  rawScore!: number;

  @ApiProperty({ example: 0.71 })
  normalizedWeight!: number;

  @ApiProperty({ example: 0.65 })
  weightedContribution!: number;
}

/**
 * Response body for a single entity resolution request.
 */
export class ResolveResultDto {
  @ApiProperty({ example: 'req-abc123' })
  requestId!: string;

  @ApiPropertyOptional({ example: 'ENT-00000001' })
  entityId?: string;

  @ApiPropertyOptional({ example: 'Acme Corporation' })
  displayName?: string;

  @ApiPropertyOptional({ example: 'SF-ACC-001' })
  externalId?: string;

  @ApiPropertyOptional({ example: 0.87, minimum: 0, maximum: 1 })
  matchScore?: number;

  @ApiProperty({
    example: 'SEMANTIC',
    enum: [
      'EXACT_ALL', 'EXACT_FASTPATH', 'EXACT', 'SEMANTIC', 'PHONETIC',
      'FUZZY', 'HYBRID_HIGH', 'HYBRID', 'COMPOSITE', 'NEW_ENTITY',
    ],
  })
  matchType!: MatchType;

  @ApiProperty({ type: [FieldScoreDto] })
  fieldScores!: FieldScoreDto[];

  @ApiProperty({ example: false })
  isNewEntity!: boolean;

  @ApiProperty({ example: false })
  isAuthoritative!: boolean;

  @ApiProperty({ example: false })
  wasCached!: boolean;

  @ApiProperty({ example: 45 })
  executionMs!: number;

  @ApiProperty({ example: '2026-02-25T12:00:00.000Z' })
  resolvedAt!: string;
}

/**
 * Response body for a batch resolution request.
 */
export class BatchResolveResultDto {
  @ApiProperty({ example: 5 })
  totalProcessed!: number;

  @ApiProperty({ type: [ResolveResultDto] })
  results!: ResolveResultDto[];

  @ApiProperty({ example: 180 })
  totalExecutionMs!: number;
}
