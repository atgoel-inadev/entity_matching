import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IEmbeddingProvider } from '../../common/ports/embedding-provider.port';
import { INJECTION_TOKENS } from '../../common/tokens/injection-tokens';
import { EmbeddingError } from '../../common/errors/domain-errors';

/**
 * EmbeddingFetcher generates dense vector embeddings for all SEMANTIC/HYBRID input fields.
 *
 * Calls IEmbeddingProvider.generateEmbeddings() in a single batched call for all
 * semantic fields, allowing the provider to parallelise Snowflake Cortex requests.
 * This avoids N sequential Cortex calls when a profile has multiple semantic fields.
 */
@Injectable()
export class EmbeddingFetcher {
  private readonly logger = new Logger(EmbeddingFetcher.name);

  constructor(
    @Inject(INJECTION_TOKENS.EMBEDDING_PROVIDER)
    private readonly embeddingProvider: IEmbeddingProvider,
  ) {}

  /**
   * Generates embeddings for all semantic fields present in the input.
   * Only fields that exist in both semanticFields and the input are embedded.
   *
   * @param fields - Input field values from the resolve request.
   * @param semanticFields - Field names that require embeddings (from profile config).
   * @returns A map of fieldName → embedding Float32Array.
   * @throws EmbeddingError if the provider fails.
   */
  async fetchInputEmbeddings(
    fields: Record<string, string>,
    semanticFields: ReadonlyArray<string>,
  ): Promise<Map<string, Float32Array>> {
    const fieldsToEmbed = semanticFields.filter(
      (fieldName) => fields[fieldName]?.trim(),
    );

    if (fieldsToEmbed.length === 0) {
      return new Map();
    }

    // Normalize (lowercase) for case-insensitive semantic matching
    const texts = fieldsToEmbed.map((name) => fields[name].trim().toLowerCase());

    try {
      const embeddings = await this.embeddingProvider.generateEmbeddings(texts);
      const resultMap = new Map<string, Float32Array>();

      for (let i = 0; i < fieldsToEmbed.length; i++) {
        resultMap.set(fieldsToEmbed[i], embeddings[i]);
      }

      this.logger.debug(
        `Generated ${embeddings.length} embeddings for fields: [${fieldsToEmbed.join(', ')}]`,
      );

      return resultMap;
    } catch (error) {
      throw new EmbeddingError(
        `Failed to generate embeddings for fields [${fieldsToEmbed.join(', ')}]: ${String(error)}`,
      );
    }
  }
}
