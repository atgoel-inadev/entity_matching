-- =============================================================================
-- RESOLVEIQ: Performance Optimization
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- 1. Embedding cost estimator (run before bulk loads)
-- =============================================================================
CREATE OR REPLACE FUNCTION estimate_embedding_cost(
    p_profile_id   VARCHAR,
    p_entity_count INTEGER
)
RETURNS VARIANT
LANGUAGE SQL
AS
$$
    SELECT OBJECT_CONSTRUCT(
        'profile_id', p_profile_id,
        'entity_count', p_entity_count,
        'semantic_field_count', COUNT(*),
        'total_embeddings', COUNT(*) * p_entity_count,
        'estimated_cost_usd', ROUND(COUNT(*) * p_entity_count * 0.0001, 4),
        'note', 'Cost is for EMBED_TEXT_768 calls only; warehouse compute is additional.'
    )::VARIANT
    FROM profile_fields
    WHERE profile_id = p_profile_id
      AND match_strategy = 'SEMANTIC'
$$;

-- Test: how much would 1000 suppliers cost?
SELECT estimate_embedding_cost('PROF-SUPPLIER-001', 1000);
-- Expected: 1 semantic field * 1000 entities = $0.10

-- =============================================================================
-- 2. Cache cleanup task
-- =============================================================================
CREATE OR REPLACE TASK riq_cleanup_cache
    WAREHOUSE = SNOWFLAKE_LEARNING_WH
    SCHEDULE = 'USING CRON 0 2 * * * America/New_York'
AS
    DELETE FROM profile_match_cache WHERE expires_at <= CURRENT_TIMESTAMP();

ALTER TASK riq_cleanup_cache RESUME;

-- =============================================================================
-- 3. Log retention (30 days)
-- =============================================================================
CREATE OR REPLACE TASK riq_cleanup_logs
    WAREHOUSE = SNOWFLAKE_LEARNING_WH
    SCHEDULE = 'USING CRON 0 3 * * 0 America/New_York'
AS
    DELETE FROM profile_match_log
    WHERE created_at < DATEADD('day', -30, CURRENT_TIMESTAMP());

ALTER TASK riq_cleanup_logs RESUME;

-- =============================================================================
-- 4. Session-level query cache
-- =============================================================================
ALTER SESSION SET USE_CACHED_RESULT = TRUE;

-- =============================================================================
-- VERIFICATION
-- =============================================================================
SHOW TASKS IN SCHEMA ENTITY_MATCHING;
