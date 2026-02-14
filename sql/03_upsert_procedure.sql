-- =============================================================================
-- SECTION C: REAL-TIME UPDATE PROCEDURE
-- upsert_and_match: Try match -> If no match, insert new -> Return result
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- STORED PROCEDURE: upsert_and_match
-- Logic:
--   1. Check cache first
--   2. Try hybrid match
--   3. If match found -> return it, update cache
--   4. If no match -> insert new entity + embedding, return new entity
--   5. Invalidate stale cache entries on inserts
-- =============================================================================
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
BEGIN
    -- Record start time for performance tracking
    v_start_time := CURRENT_TIMESTAMP();

    -- Step 1: Compute cache key (SHA256 of normalized input + threshold)
    v_cache_key := SHA2(normalize_name(:p_entity_name) || '|' || :p_threshold::VARCHAR, 256);

    -- Step 2: Check cache (< 1hr old)
    SELECT matched_entity_id, matched_name, match_score, match_type
    INTO :v_entity_id, :v_canonical, :v_match_score, :v_match_type
    FROM match_cache
    WHERE cache_key = :v_cache_key
      AND expires_at > CURRENT_TIMESTAMP()
    LIMIT 1;

    -- If cache hit, update hit count and return
    IF (v_entity_id IS NOT NULL) THEN
        v_was_cached := TRUE;

        UPDATE match_cache
        SET hit_count = hit_count + 1
        WHERE cache_key = :v_cache_key;

        v_matched_alias := v_canonical;
    ELSE
        -- Step 3: Try hybrid matching
        SELECT entity_id, canonical_name, matched_alias, hybrid_score, match_type
        INTO :v_entity_id, :v_canonical, :v_matched_alias, :v_match_score, :v_match_type
        FROM TABLE(hybrid_entity_match(:p_entity_name, :p_threshold))
        ORDER BY hybrid_score DESC
        LIMIT 1;

        -- Step 4: If no match found, create new entity
        IF (v_entity_id IS NULL) THEN
            v_is_new := TRUE;
            v_entity_id := UUID_STRING();
            v_canonical := :p_entity_name;
            v_match_score := 1.0;
            v_match_type := 'NEW_ENTITY';

            -- Insert new entity
            INSERT INTO entities (entity_id, canonical_name, entity_type, industry, country, metadata)
            SELECT
                :v_entity_id,
                :p_entity_name,
                COALESCE(:p_metadata:entity_type::VARCHAR, 'COMPANY'),
                :p_metadata:industry::VARCHAR,
                :p_metadata:country::VARCHAR,
                :p_metadata;

            -- Insert as its own alias
            INSERT INTO entity_aliases (entity_id, alias_name, alias_type, name_normalized)
            VALUES (
                :v_entity_id,
                :p_entity_name,
                'LEGAL',
                normalize_name(:p_entity_name)
            );

            -- Generate and store embedding for the new entity
            INSERT INTO entity_embeddings (entity_id, source_text, embedding)
            SELECT
                :v_entity_id,
                :p_entity_name,
                SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', :p_entity_name);

            -- Invalidate any cache entries that might now match differently
            -- (conservative: clear cache entries with low scores near the new entity)
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
            matched_entity_id = src.matched_entity_id,
            matched_name = src.matched_name,
            match_score = src.match_score,
            match_type = src.match_type,
            created_at = src.created_at,
            expires_at = src.expires_at,
            hit_count = 0
        WHEN NOT MATCHED THEN INSERT (
            cache_key, input_name, matched_entity_id, matched_name,
            match_score, match_type, threshold_used, created_at, expires_at
        ) VALUES (
            src.cache_key, src.input_name, src.matched_entity_id, src.matched_name,
            src.match_score, src.match_type, src.threshold_used, src.created_at, src.expires_at
        );
    END IF;

    -- Step 6: Calculate execution time
    v_execution_ms := DATEDIFF('millisecond', v_start_time, CURRENT_TIMESTAMP());

    -- Step 7: Log the match attempt
    INSERT INTO match_log (input_name, matched_entity_id, match_score, match_type, was_cached, execution_ms)
    VALUES (:p_entity_name, :v_entity_id, :v_match_score, :v_match_type, :v_was_cached, :v_execution_ms);

    -- Step 8: Build and return result
    v_result := OBJECT_CONSTRUCT(
        'entity_id',      v_entity_id,
        'canonical_name',  v_canonical,
        'matched_alias',   v_matched_alias,
        'match_score',     v_match_score,
        'match_type',      v_match_type,
        'is_new_entity',   v_is_new,
        'was_cached',      v_was_cached,
        'execution_ms',    v_execution_ms
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHER THEN
        -- Log the error and return error object
        v_execution_ms := DATEDIFF('millisecond', v_start_time, CURRENT_TIMESTAMP());
        
        INSERT INTO match_log (input_name, match_type, execution_ms)
        VALUES (:p_entity_name, 'ERROR', :v_execution_ms);

        RETURN OBJECT_CONSTRUCT(
            'error',    TRUE,
            'message',  SQLERRM,
            'sqlcode',  SQLCODE,
            'input',    p_entity_name
        );
END;
$$;


-- =============================================================================
-- PROCEDURE: Batch upsert for multiple entities at once
-- =============================================================================
CREATE OR REPLACE PROCEDURE batch_upsert_and_match(
    p_entities VARIANT  -- Array of {name, metadata} objects
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_results VARIANT DEFAULT PARSE_JSON('[]');
    v_single_result VARIANT;
    v_entity_name VARCHAR;
    v_metadata VARIANT;
    v_idx INTEGER DEFAULT 0;
    v_count INTEGER;
BEGIN
    v_count := ARRAY_SIZE(:p_entities);

    WHILE (v_idx < v_count) DO
        v_entity_name := :p_entities[:v_idx]:name::VARCHAR;
        v_metadata := :p_entities[:v_idx]:metadata;

        IF (v_metadata IS NULL) THEN
            v_metadata := PARSE_JSON('{}');
        END IF;

        CALL upsert_and_match(:v_entity_name, :v_metadata, 0.65) INTO :v_single_result;

        v_results := ARRAY_APPEND(:v_results, :v_single_result);
        v_idx := v_idx + 1;
    END WHILE;

    RETURN OBJECT_CONSTRUCT(
        'total_processed', v_count,
        'results', v_results
    );
END;
$$;


-- =============================================================================
-- PROCEDURE: Invalidate cache (manual trigger)
-- =============================================================================
CREATE OR REPLACE PROCEDURE invalidate_cache(
    p_entity_id VARCHAR DEFAULT NULL  -- NULL = invalidate all
)
RETURNS VARCHAR
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_deleted INTEGER;
BEGIN
    IF (:p_entity_id IS NOT NULL) THEN
        DELETE FROM match_cache
        WHERE matched_entity_id = :p_entity_id;
    ELSE
        DELETE FROM match_cache
        WHERE expires_at <= CURRENT_TIMESTAMP();
    END IF;

    v_deleted := SQLROWCOUNT;
    RETURN 'Invalidated ' || :v_deleted || ' cache entries';
END;
$$;


-- =============================================================================
-- TEST THE PROCEDURES
-- =============================================================================

-- Test 1: Match existing entity
CALL upsert_and_match('Microsoft', NULL, 0.65);

-- Test 2: Match with typo
CALL upsert_and_match('Gooogle', NULL, 0.5);

-- Test 3: Insert new entity (should not match anything)
CALL upsert_and_match(
    'Acme Rocket Corporation',
    PARSE_JSON('{"entity_type": "COMPANY", "industry": "Aerospace", "country": "USA"}'),
    0.8
);

-- Test 4: Verify the new entity was created
SELECT * FROM entities WHERE canonical_name = 'Acme Rocket Corporation';

-- Test 5: Now match the newly created entity
CALL upsert_and_match('Acme Rocket Corp', NULL, 0.5);

-- Test 6: Batch upsert
CALL batch_upsert_and_match(
    PARSE_JSON('[
        {"name": "Apple Inc", "metadata": {}},
        {"name": "Amazn", "metadata": {}},
        {"name": "Totally New Company XYZ", "metadata": {"industry": "Technology", "country": "USA"}}
    ]')
);

-- Test 7: Check cache
SELECT * FROM match_cache ORDER BY created_at DESC LIMIT 10;

-- Test 8: Check logs
SELECT * FROM match_log ORDER BY created_at DESC LIMIT 10;
