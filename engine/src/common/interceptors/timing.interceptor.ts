import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { FastifyReply } from 'fastify';

/**
 * TimingInterceptor attaches an X-Response-Time-Ms header to every HTTP response.
 * Allows clients and monitoring tools to observe server-side latency.
 */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        void reply.header('X-Response-Time-Ms', String(duration));
      }),
    );
  }
}
