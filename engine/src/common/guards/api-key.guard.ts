import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';

/**
 * ApiKeyGuard validates the X-API-Key header against the configured API_KEY env var.
 *
 * Behavior:
 * - If API_KEY is not configured (empty/unset): guard is disabled, all requests pass.
 * - If API_KEY is configured: the X-API-Key header must match exactly.
 *
 * Apply globally in main.ts or selectively with @UseGuards(ApiKeyGuard).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly configuredApiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.configuredApiKey = this.configService.get<string>('API_KEY', '');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.configuredApiKey) {
      return true; // Auth disabled — no API_KEY configured
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const providedKey = request.headers['x-api-key'];

    if (providedKey !== this.configuredApiKey) {
      this.logger.warn(`Rejected request with invalid API key from ${request.ip}`);
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
