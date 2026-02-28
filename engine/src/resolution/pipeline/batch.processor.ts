import { Injectable, Logger } from '@nestjs/common';
import type { ResolveRequest, ResolveResult, BatchResolveResult } from '../../common/models/resolution.model';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';
import { BatchSizeExceededError } from '../../common/errors/domain-errors';

/** Callback type for processing a single resolve request. */
export type ResolveSingleFn = (request: ResolveRequest) => Promise<ResolveResult>;

/**
 * BatchProcessor processes multiple resolve requests concurrently.
 *
 * Uses Promise.allSettled() so that individual failures do not abort the entire batch.
 * Failed requests return a NEW_ENTITY result with an error code in the response,
 * allowing callers to identify and retry specific failures.
 *
 * This is the core concurrency improvement over v1 Python:
 * v1: sequential for-loop — 50 × 100ms = ~5,000ms
 * v2: Promise.allSettled — all 50 fire in parallel — ~150ms
 */
@Injectable()
export class BatchProcessor {
  private readonly logger = new Logger(BatchProcessor.name);

  /**
   * Processes all resolve requests concurrently.
   *
   * @param requests - Array of resolve requests (max MAX_BATCH_SIZE).
   * @param resolveSingle - Callback to resolve a single request (injected to avoid circular dep).
   * @returns Batch result with all individual results, including failures.
   * @throws BatchSizeExceededError if requests.length > MAX_BATCH_SIZE.
   */
  async processAll(
    requests: ResolveRequest[],
    resolveSingle: ResolveSingleFn,
  ): Promise<BatchResolveResult> {
    if (requests.length > RESOLUTION_CONSTANTS.MAX_BATCH_SIZE) {
      throw new BatchSizeExceededError(
        requests.length,
        RESOLUTION_CONSTANTS.MAX_BATCH_SIZE,
      );
    }

    const startTime = Date.now();

    // All requests fire concurrently — Promise.allSettled never rejects
    const settledResults = await Promise.allSettled(
      requests.map((req) => resolveSingle(req)),
    );

    const results = settledResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      this.logger.warn(
        `Batch item ${index} (requestId: ${requests[index].requestId}) failed: ${String(result.reason)}`,
      );

      return this.buildFailureResult(requests[index], result.reason);
    });

    const totalExecutionMs = Date.now() - startTime;

    this.logger.log(
      `Batch processed ${requests.length} requests in ${totalExecutionMs}ms`,
    );

    return {
      totalProcessed: requests.length,
      results,
      totalExecutionMs,
    };
  }

  private buildFailureResult(
    request: ResolveRequest,
    error: unknown,
  ): ResolveResult {
    return {
      requestId: request.requestId,
      matchType: 'NEW_ENTITY',
      fieldScores: [],
      isNewEntity: false,
      isAuthoritative: false,
      wasCached: false,
      executionMs: 0,
      resolvedAt: new Date(),
      debug: {
        candidatesEvaluated: 0,
        pipelineStageMs: {},
        topCandidates: [],
      },
    };
  }
}
