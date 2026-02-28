import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyRequest } from 'fastify';

/**
 * CorrelationId parameter decorator.
 *
 * Extracts the X-Correlation-Id header from the request.
 * If absent, generates a new UUID v4 to ensure every request has a correlation ID.
 *
 * Usage in a controller:
 *   async resolve(@CorrelationId() correlationId: string, ...) {}
 *
 * The correlation ID is propagated to:
 *  - The resolution domain request (for in-process tracing)
 *  - The audit log event (for cross-system correlation)
 *  - Log output (via logger context)
 */
export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers['x-correlation-id'];

    if (typeof header === 'string' && header.trim()) {
      return header.trim();
    }

    return uuidv4();
  },
);
