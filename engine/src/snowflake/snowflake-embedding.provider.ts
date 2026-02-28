import { Injectable, Logger } from '@nestjs/common';
import type { IEmbeddingProvider } from '../common/ports/embedding-provider.port';
import { EmbeddingError } from '../common/errors/domain-errors';
import { SnowflakeService } from './snowflake.service';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * SnowflakeCortexEmbeddingProvider generates dense vector embeddings using
 * Snowflake Cortex EMBED_TEXT_768 (e5-base-v2 model).
 *
 * Snowflake's role in v2: ONLY embedding generation and storage.
 * The cosine similarity math runs in Node.js (SemanticStrategy), not in Snowflake SQL.
 *
 * generateEmbeddings() parallelises all Snowflake calls with Promise.all() —
 * N texts = N concurrent Cortex calls rather than N sequential calls.
 */
@Injectable()
export class SnowflakeCortexEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(SnowflakeCortexEmbeddingProvider.name);

  constructor(private readonly snowflakeService: SnowflakeService) {}

  /**
   * Generates a single 768-dimensional embedding from text.
   * @param text - The text to embed.
   * @returns Float32Array of 768 dimensions.
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    const results = await this.generateEmbeddings([text]);
    return results[0];
  }

  /**
   * Batch generates embeddings for multiple texts concurrently.
   * All Cortex API calls are fired in parallel via Promise.all().
   * @param texts - Array of texts to embed.
   * @returns Array of Float32Arrays in the same order as input.
   */
  async generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
    const promises = texts.map((text) => this.callCortexEmbed(text));
    return Promise.all(promises);
  }

  /** @returns The Cortex model version identifier. */
  getModelVersion(): string {
    return RESOLUTION_CONSTANTS.EMBEDDING_MODEL_VERSION;
  }

  /** @returns Vector dimension count (768 for e5-base-v2). */
  getDimensions(): number {
    return RESOLUTION_CONSTANTS.EMBEDDING_DIMENSIONS;
  }

  private async callCortexEmbed(text: string): Promise<Float32Array> {
    try {
      const rows = await this.snowflakeService.executeQuery<{ EMBEDDING: unknown }>(
        `SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768(?, ?) AS embedding`,
        [RESOLUTION_CONSTANTS.EMBEDDING_MODEL_VERSION, text],
      );

      if (!rows[0]?.EMBEDDING) {
        throw new EmbeddingError(`No embedding returned for text: "${text.substring(0, 50)}..."`);
      }

      return this.parseEmbedding(rows[0].EMBEDDING);
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      throw new EmbeddingError(
        `Cortex embedding failed for text "${text.substring(0, 50)}...": ${String(error)}`,
      );
    }
  }

  private parseEmbedding(raw: unknown): Float32Array {
    if (Array.isArray(raw)) {
      return new Float32Array(raw as number[]);
    }

    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as number[];
      return new Float32Array(parsed);
    }

    throw new EmbeddingError(
      `Unexpected embedding format: ${typeof raw}`,
    );
  }
}
