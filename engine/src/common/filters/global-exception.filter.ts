import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  ProfileNotFoundError,
  EntityNotFoundError,
  FieldNotFoundError,
  ResolutionError,
  EmbeddingError,
  SnowflakeError,
  CacheError,
  BatchSizeExceededError,
  AppError,
} from '../errors/domain-errors';

/** Structured error response shape. */
interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  timestamp: string;
  path: string;
}

/**
 * GlobalExceptionFilter catches all unhandled exceptions and maps them
 * to appropriate HTTP responses with structured error bodies.
 *
 * Mapping table:
 *   ProfileNotFoundError    → 404 NOT_FOUND
 *   EntityNotFoundError     → 404 NOT_FOUND
 *   FieldNotFoundError      → 400 BAD_REQUEST
 *   BatchSizeExceededError  → 400 BAD_REQUEST
 *   ResolutionError         → 422 UNPROCESSABLE_ENTITY
 *   EmbeddingError          → 502 BAD_GATEWAY
 *   SnowflakeError          → 503 SERVICE_UNAVAILABLE
 *   CacheError              → 503 SERVICE_UNAVAILABLE
 *   HttpException           → original status code
 *   All others              → 500 INTERNAL_SERVER_ERROR
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const { statusCode, code, message } = this.resolveError(exception);

    this.logError(exception, statusCode, request.url);

    const body: ErrorResponse = {
      statusCode,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    void reply.status(statusCode).send(body);
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
  } {
    if (exception instanceof ProfileNotFoundError || exception instanceof EntityNotFoundError) {
      return { statusCode: HttpStatus.NOT_FOUND, code: (exception as AppError).code, message: exception.message };
    }

    if (exception instanceof FieldNotFoundError || exception instanceof BatchSizeExceededError) {
      return { statusCode: HttpStatus.BAD_REQUEST, code: (exception as AppError).code, message: exception.message };
    }

    if (exception instanceof ResolutionError) {
      return { statusCode: HttpStatus.UNPROCESSABLE_ENTITY, code: exception.code, message: exception.message };
    }

    if (exception instanceof EmbeddingError) {
      return { statusCode: HttpStatus.BAD_GATEWAY, code: exception.code, message: 'Embedding service unavailable' };
    }

    if (exception instanceof SnowflakeError || exception instanceof CacheError) {
      return { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: (exception as AppError).code, message: 'Upstream service unavailable' };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'object' && 'message' in response
        ? String((response as { message: unknown }).message)
        : exception.message;
      return { statusCode: status, code: 'HTTP_ERROR', message };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  private logError(exception: unknown, statusCode: number, path: string): void {
    if (statusCode >= 500) {
      this.logger.error(`[${statusCode}] ${path}`, exception);
    } else {
      this.logger.warn(`[${statusCode}] ${path}: ${String(exception)}`);
    }
  }
}
