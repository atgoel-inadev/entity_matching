import type { IEmbeddingProvider } from '../../common/ports/embedding-provider.port';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';

/**
 * Deterministic embedding provider for tests.
 * Returns pseudo-random Float32Arrays based on the input text hash.
 * Does NOT call Snowflake Cortex — entirely in-process.
 */
export class FakeEmbeddingProvider implements IEmbeddingProvider {
  /** If set, identical texts return the same embedding. Default: true. */
  private readonly deterministicByText: boolean;

  constructor(deterministicByText = true) {
    this.deterministicByText = deterministicByText;
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    return this.buildEmbedding(text);
  }

  async generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.buildEmbedding(t));
  }

  getModelVersion(): string {
    return 'fake-e5-base-v2';
  }

  getDimensions(): number {
    return RESOLUTION_CONSTANTS.EMBEDDING_DIMENSIONS;
  }

  private buildEmbedding(text: string): Float32Array {
    const seed = this.deterministicByText
      ? this.hashText(text)
      : Math.random();

    const arr = new Float32Array(RESOLUTION_CONSTANTS.EMBEDDING_DIMENSIONS);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.abs(Math.sin(i * seed + 1));
    }

    // Normalize to unit vector for realistic cosine similarity behaviour
    const norm = Math.sqrt(arr.reduce((sum, v) => sum + v * v, 0));
    for (let i = 0; i < arr.length; i++) {
      arr[i] = arr[i] / norm;
    }

    return arr;
  }

  private hashText(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit int
    }
    return Math.abs(hash) / 2_147_483_647;
  }
}
