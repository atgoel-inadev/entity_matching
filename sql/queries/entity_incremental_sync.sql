-- =============================================================================
-- EmbeddingRefreshJob: Incremental entity and alias sync query
--
-- Returns all records that need embeddings generated or refreshed.
-- Runs every hour immediately after the SF/Gen3 → Snowflake ETL completes.
-- EmbeddingRefreshJob calls this, iterates the result set in batches, generates
-- embeddings via Snowflake Cortex EMBED_TEXT_768, then writes them back to
-- profile_entity_embeddings and updates embedding_status to 'EMBEDDED'.
--
-- Two sections:
--   Section A — profile_entities with embedding_status = 'PENDING'
--               (new or updated entities from the hourly ETL)
--   Section B — entity_alias with embedding_status = 'PENDING'
--               (newly created aliases from Manual Review that need embedding
--                before AliasChecker can use them in semantic fallback)
--
-- Called by: EmbeddingRefreshJob.findPendingWork()
--            in sync/embedding-refresh.job.ts
--
-- Parameters (positional):
--   $1 — batch_size   INTEGER   max records per page (typically 500)
--   $2 — offset       INTEGER   pagination offset (0-based)
--
-- Returns columns (UNION of both sections):
--   record_type    VARCHAR   'ENTITY' | 'ALIAS'
--   record_id      VARCHAR(36)   entity_id or alias_id
--   profile_id     VARCHAR(36)
--   salesforce_id  VARCHAR(50)
--   field_name     VARCHAR(100)   the SEMANTIC field to embed (from profile_fields)
--   source_text    VARCHAR(2000)  the raw text to pass to EMBED_TEXT_768
-- =============================================================================

-- Section A: profile_entities PENDING
SELECT
    'ENTITY'                           AS record_type,
    pe.entity_id                       AS record_id,
    pe.profile_id,
    pe.salesforce_id,
    pf.field_name,
    pe.field_values[pf.field_name]::VARCHAR AS source_text
FROM profile_entities pe
JOIN profile_fields pf
    ON  pf.profile_id    = pe.profile_id
    AND pf.match_strategy = 'SEMANTIC'
WHERE pe.embedding_status = 'PENDING'
  AND pe.is_active        = TRUE
  AND pe.field_values[pf.field_name]::VARCHAR IS NOT NULL

UNION ALL

-- Section B: entity_alias PENDING
-- Aliases embed their alias_fields as a space-joined text blob;
-- AliasChecker already resolves them via hash — embedding is for semantic fallback.
SELECT
    'ALIAS'                            AS record_type,
    ea.alias_id                        AS record_id,
    ea.profile_id,
    ea.salesforce_id,
    'alias_fields'                     AS field_name,
    -- Produce a single text string from all alias field values for embedding
    ARRAY_TO_STRING(
        ARRAY_AGG(v.value::VARCHAR) WITHIN GROUP (ORDER BY v.key),
        ' '
    )                                  AS source_text
FROM entity_alias ea,
    LATERAL FLATTEN(input => ea.alias_fields) v
WHERE ea.embedding_status = 'PENDING'
  AND ea.is_active        = TRUE
GROUP BY ea.alias_id, ea.profile_id, ea.salesforce_id

ORDER BY record_type, record_id
LIMIT  :batch_size
OFFSET :offset;
