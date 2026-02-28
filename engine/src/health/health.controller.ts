import { Controller, Get, HttpCode, HttpStatus, Inject, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { SnowflakeService } from '../snowflake/snowflake.service';
import { RedisCacheService } from '../cache/redis-cache.service';

/** Health status for a single dependency. */
interface DependencyHealth {
  status: 'ok' | 'degraded';
  latencyMs?: number;
  error?: string;
}

/** Full health check response shape. */
interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  timestamp: string;
  dependencies: {
    snowflake: DependencyHealth;
    redis: DependencyHealth;
  };
}

/**
 * HealthController exposes system health and stats endpoints.
 */
@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly snowflakeService: SnowflakeService,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  /**
   * Checks connectivity to Snowflake and Redis.
   * Returns 200 if all dependencies are healthy, 503 if degraded.
   */
  @Get('health')
  @ApiOperation({ summary: 'System health check (Snowflake + Redis)' })
  @ApiResponse({ status: 200, description: 'All dependencies healthy' })
  @ApiResponse({ status: 503, description: 'One or more dependencies degraded' })
  async health(): Promise<HealthResponse> {
    const [snowflakeHealth, redisHealth] = await Promise.all([
      this.checkSnowflake(),
      this.checkRedis(),
    ]);

    const allHealthy =
      snowflakeHealth.status === 'ok' && redisHealth.status === 'ok';

    return {
      status: allHealthy ? 'ok' : 'degraded',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      dependencies: {
        snowflake: snowflakeHealth,
        redis: redisHealth,
      },
    };
  }

  /**
   * Returns aggregate system-level statistics.
   * Counts are sourced directly from Snowflake.
   */
  @Get('stats')
  @ApiOperation({ summary: 'Aggregate system statistics' })
  @ApiResponse({ status: 200, description: 'System-level counts and metrics' })
  async getStats(): Promise<{
    totalProfiles: number;
    totalEntities: number;
    totalResolutions: number;
    resolutionsToday: number;
  }> {
    const [profiles, entities, resolutions, today] = await Promise.all([
      this.snowflakeService.executeQuery<Record<string, number>>(
        'SELECT COUNT(*) AS count FROM resolution_profiles WHERE is_active = TRUE',
        [],
      ),
      this.snowflakeService.executeQuery<Record<string, number>>(
        'SELECT COUNT(*) AS count FROM profile_entities WHERE is_active = TRUE',
        [],
      ),
      this.snowflakeService.executeQuery<Record<string, number>>(
        'SELECT COUNT(*) AS count FROM profile_match_log',
        [],
      ),
      this.snowflakeService.executeQuery<Record<string, number>>(
        'SELECT COUNT(*) AS count FROM profile_match_log WHERE DATE(created_at) = CURRENT_DATE()',
        [],
      ),
    ]);

    return {
      totalProfiles: Number(profiles[0]?.['COUNT'] ?? 0),
      totalEntities: Number(entities[0]?.['COUNT'] ?? 0),
      totalResolutions: Number(resolutions[0]?.['COUNT'] ?? 0),
      resolutionsToday: Number(today[0]?.['COUNT'] ?? 0),
    };
  }

  /**
   * Returns per-profile statistics: entity count, resolution counts, match type breakdown.
   */
  @Get('profiles/:slug/stats')
  @ApiOperation({ summary: 'Per-profile statistics' })
  @ApiParam({ name: 'slug', example: 'supplier-dedup' })
  @ApiResponse({ status: 200, description: 'Profile-level metrics' })
  async getProfileStats(
    @Param('slug') slug: string,
  ): Promise<{
    entityCount: number;
    resolutionsToday: number;
    totalResolutions: number;
    averageMatchScore: number;
    matchTypeBreakdown: Record<string, number>;
  }> {
    const [entities, resolutions, today, avgScore, breakdown] = await Promise.all([
      this.snowflakeService.executeQuery<Record<string, number>>(
        `SELECT COUNT(*) AS count FROM profile_entities pe
         JOIN resolution_profiles rp ON pe.profile_id = rp.profile_id
         WHERE rp.profile_slug = ? AND pe.is_active = TRUE`,
        [slug],
      ),
      this.snowflakeService.executeQuery<Record<string, number>>(
        'SELECT COUNT(*) AS count FROM profile_match_log WHERE profile_slug = ?',
        [slug],
      ),
      this.snowflakeService.executeQuery<Record<string, number>>(
        `SELECT COUNT(*) AS count FROM profile_match_log
         WHERE profile_slug = ? AND DATE(created_at) = CURRENT_DATE()`,
        [slug],
      ),
      this.snowflakeService.executeQuery<Record<string, number>>(
        'SELECT AVG(confidence_score) AS avg FROM profile_match_log WHERE profile_slug = ? AND confidence_score IS NOT NULL',
        [slug],
      ),
      this.snowflakeService.executeQuery<Record<string, unknown>>(
        `SELECT resolution_scenario, COUNT(*) AS count FROM profile_match_log
         WHERE profile_slug = ? GROUP BY resolution_scenario`,
        [slug],
      ),
    ]);

    const matchTypeBreakdown: Record<string, number> = {};
    for (const row of breakdown) {
      matchTypeBreakdown[String(row['RESOLUTION_SCENARIO'] ?? '')] = Number(row['COUNT'] ?? 0);
    }

    return {
      entityCount: Number(entities[0]?.['COUNT'] ?? 0),
      totalResolutions: Number(resolutions[0]?.['COUNT'] ?? 0),
      resolutionsToday: Number(today[0]?.['COUNT'] ?? 0),
      averageMatchScore: Number(avgScore[0]?.['AVG'] ?? 0),
      matchTypeBreakdown,
    };
  }

  private async checkSnowflake(): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      await this.snowflakeService.executeQuery('SELECT 1 AS ping', []);
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (error) {
      return { status: 'degraded', error: String(error) };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      await this.redisCacheService.get('health:ping');
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (error) {
      return { status: 'degraded', error: String(error) };
    }
  }
}
