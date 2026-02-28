-- =============================================================================
-- CandidateRetriever: ANN semantic vector search
--
-- Retrieves the top-K entity candidates by approximate nearest-neighbour
-- cosine similarity for a single SEMANTIC-strategy field. The calling Node.js
-- code generates the query embedding via Snowflake Cortex before this query
-- runs; the result is passed in as a VECTOR literal.
--
-- Called by: CandidateRetriever.getByEmbedding()
--            in resolution/pipeline/candidate.retriever.ts
--
-- Parameters (positional):
--   $1 — profile_id       VARCHAR(36)
--   $2 — field_name       VARCHAR(100)   e.g. 'buyer_name_semantic'
--   $3 — query_embedding  VECTOR(FLOAT, 768)   from Node.js EMBED call
--   $4 — top_k            INTEGER        typically 50 (DEFAULT_CANDIDATE_TOP_K)
--   $5 — min_similarity   FLOAT          typically 0.4 (SEMANTIC_MIN_SIMILARITY)
--
-- Returns columns:
--   entity_id    VARCHAR(36)
--   salesforce_id VARCHAR(50)   ← Primary return ID
--   display_name  VARCHAR(500)
--   field_values  VARIANT
--   source_system VARCHAR(20)
--   similarity    FLOAT         cosine similarity in [0, 1]
-- =============================================================================

SELECT
    pe.entity_id,
    pe.salesforce_id,
    pe.display_name,
    pe.field_values,
    pe.source_system,
    VECTOR_COSINE_SIMILARITY(pee.embedding, :query_embedding) AS similarity
FROM profile_entity_embeddings pee
JOIN profile_entities pe
    ON  pe.entity_id  = pee.entity_id
    AND pe.profile_id = pee.profile_id
WHERE pee.profile_id  = :profile_id
  AND pee.field_name  = :field_name
  AND pe.is_active    = TRUE
  AND pe.embedding_status = 'EMBEDDED'
  AND VECTOR_COSINE_SIMILARITY(pee.embedding, :query_embedding) >= :min_similarity
ORDER BY similarity DESC
LIMIT :top_k;
