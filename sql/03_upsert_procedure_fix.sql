-- =============================================================================
-- FIX: Update the upsert_and_match procedure to handle normalize_name properly
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;
CREATE OR REPLACE PROCEDURE upsert_and_match(
    p_entity_name VARCHAR,
    p_metadata    VARIANT,
    p_threshold   FLOAT DEFAULT 0.65
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_cache_key     VARCHAR;
    v_entity_id     VARCHAR;
    v_canonical     VARCHAR;
    v_match_score   FLOAT;
    v_match_type    VARCHAR;
    v_matched_alias VARCHAR;
    v_is_new        BOOLEAN DEFAULT FALSE;
    v_was_cached    BOOLEAN DEFAULT FALSE;
    v_start_time    TIMESTAMP_NTZ;
    v_execution_ms  INTEGER;
    v_result        VARIANT;
    v_normalized_name VARCHAR;  -- NEW: Variable to hold normalized name
BEGIN
    -- Record start time for performance tracking
    v_start_time := CURRENT_TIMESTAMP();

    -- Step 1: Compute cache key (SHA256 of normalized input + threshold)
    v_cache_key := SHA2(normalize_name(:p_entity_name) || '|' || :p_threshold::VARCHAR, 256);

    -- Step 2: Check cache (< 1hr old)
    SELECT matched_entity_id, matched_name, match_score, match_type
    INTO v_entity_id, v_canonical, v_match_score, v_match_type
    FROM match_cache
    WHERE cache_key = :v_cache_key
      AND expires_at > CURRENT_TIMESTAMP()
    LIMIT 1;

    IF (v_entity_id IS NOT NULL) THEN
        v_was_cached := TRUE;
        v_matched_alias := v_canonical;
    ELSE
        -- Step 3: No cache hit -> run hybrid matching UDF
        SELECT entity_id, canonical_name, matched_alias, fuzzy_score_val, match_type
        INTO v_entity_id, v_canonical, v_matched_alias, v_match_score, v_match_type
        FROM TABLE(hybrid_entity_match(:p_entity_name, :p_threshold))
        LIMIT 1;

        -- Step 4: If no match -> insert as new entity
        IF (v_entity_id IS NULL) THEN
            v_entity_id := UUID_STRING();
            v_canonical := p_entity_name;
            v_match_score := NULL;
            v_is_new := TRUE;
            v_match_type := 'NEW_ENTITY';
            
            -- FIX: Compute normalized name first
            v_normalized_name := normalize_name(:p_entity_name);

            -- Insert new entity
            INSERT INTO entities (entity_id, canonical_name, entity_type, industry, country, metadata)
            SELECT
                :v_entity_id,
                :p_entity_name,
                COALESCE(:p_metadata:entity_type::VARCHAR, 'COMPANY'),
                :p_metadata:industry::VARCHAR,
                :p_metadata:country::VARCHAR,
                :p_metadata;

            -- FIX: Use the pre-computed normalized name variable
            INSERT INTO entity_aliases (entity_id, alias_name, alias_type, name_normalized)
            SELECT :v_entity_id, :p_entity_name, 'LEGAL', :v_normalized_name;

            -- Generate and store embedding for the new entity
            INSERT INTO entity_embeddings (entity_id, source_text, embedding)
            SELECT
                :v_entity_id,
                :p_entity_name,
                SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', :p_entity_name);

            -- Invalidate any cache entries that might now match differently
            DELETE FROM match_cache
            WHERE expires_at > CURRENT_TIMESTAMP()
              AND match_score < 0.7;

            v_matched_alias := p_entity_name;
        END IF;

        -- Step 5: Update cache with this result
        MERGE INTO match_cache tgt
        USING (
            SELECT
                :v_cache_key AS cache_key,
                :p_entity_name AS input_name,
                :v_entity_id AS matched_entity_id,
                :v_canonical AS matched_name,
                :v_match_score AS match_score,
                :v_match_type AS match_type,
                :p_threshold AS threshold_used,
                CURRENT_TIMESTAMP() AS created_at,
                DATEADD('hour', 1, CURRENT_TIMESTAMP()) AS expires_at
        ) src
        ON tgt.cache_key = src.cache_key
        WHEN MATCHED THEN UPDATE SET
            tgt.matched_entity_id = src.matched_entity_id,
            tgt.matched_name = src.matched_name,
            tgt.match_score = src.match_score,
            tgt.match_type = src.match_type,
            tgt.created_at = src.created_at,
            tgt.expires_at = src.expires_at
        WHEN NOT MATCHED THEN INSERT (
            cache_key, input_name, matched_entity_id, matched_name,
            match_score, match_type, threshold_used, created_at, expires_at
        ) VALUES (
            src.cache_key, src.input_name, src.matched_entity_id, src.matched_name,
            src.match_score, src.match_type, src.threshold_used, src.created_at, src.expires_at
        );
    END IF;

    -- Step 6: Calculate execution time & build result
    v_execution_ms := DATEDIFF('millisecond', v_start_time, CURRENT_TIMESTAMP());

    v_result := OBJECT_CONSTRUCT(
        'entity_id', v_entity_id,
        'canonical_name', v_canonical,
        'matched_alias', v_matched_alias,
        'match_score', v_match_score,
        'match_type', v_match_type,
        'is_new_entity', v_is_new,
        'was_cached', v_was_cached,
        'execution_ms', v_execution_ms
    );

    RETURN v_result;
END;
$$;

-- Test the fixed procedure
SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()));

CALL upsert_and_match('Quantum Dynamics Solutions Inc', PARSE_JSON('{"industry": "Technology"}'), 0.65);
