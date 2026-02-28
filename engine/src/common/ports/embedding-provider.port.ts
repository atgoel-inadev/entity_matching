/**
 * Port interface for generating dense vector embeddings from text.
 * The current adapter uses Snowflake Cortex EMBED_TEXT_768 (e5-base-v2).
 * Swapping to OpenAI, Azure, or a local ONNX model requires only a new adapter
 * implementing this interface — no changes to the resolution pipeline.
 */
export interface IEmbeddingProvider {
  /**
   * Generates a 768-dimensional embedding for a single text value.
   * @param text - The text to embed.
   * @returns A Float32Array of length 768.
   */
  generateEmbedding(text: string): Promise<Float32Array>;

  /**
   * Batch generates embeddings for multiple texts.
   * Implementations should parallelise calls where possible.
   * @param texts - Array of texts to embed.
   * @returns Array of Float32Arrays, in the same order as input texts.
   */
  generateEmbeddings(texts: string[]): Promise<Float32Array[]>;

  /**
   * Returns the model identifier string used for audit traceability.
   * Example: "e5-base-v2"
   */
  getModelVersion(): string;

  /**
   * Returns the vector dimension count (768 for e5-base-v2).
   * Used by the Snowflake adapter when casting: VECTOR(FLOAT, 768).
   */
  getDimensions(): number;
}
