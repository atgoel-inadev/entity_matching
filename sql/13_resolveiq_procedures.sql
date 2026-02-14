-- =============================================================================
-- RESOLVEIQ: Stored Procedures
-- resolve_and_upsert, batch_resolve, bulk_load_entities
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- PROCEDURE: resolve_and_upsert
-- 1. Fast-path: check EXACT fields first
-- 2. Check cache
-- 3. Run resolve_entity() UDTF
-- 4. If no match + create_if_missing: insert new entity + embeddings
-- 5. Cache result, log, return
-- =============================================================================
CREATE OR REPLACE PROCEDURE resolve_and_upsert(
    p_profile_id      VARCHAR,
    p_field_values    VARIANT,
    p_metadata        VARIANT,
    p_threshold       FLOAT DEFAULT 0.65,
    p_create_if_missing BOOLEAN DEFAULT FALSE
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_cache_key       VARCHAR;
    v_input_hash      VARCHAR;
    v_entity_id       VARCHAR;
    v_display_name    VARCHAR;
    v_match_score     FLOAT;
    v_match_type      VARCHAR;
    v_field_scores    VARIANT;
    v_is_new          BOOLEAN DEFAULT FALSE;
    v_was_cached      BOOLEAN DEFAULT FALSE;
    v_start_time      TIMESTAMP_NTZ;
    v_execution_ms    INTEGER;
    v_result          VARIANT;
    v_primary_field   VARCHAR;
BEGIN
    v_start_time := CURRENT_TIMESTAMP();

    -- Compute cache key: SHA256(profile_id + sorted field values + threshold)
    v_input_hash := SHA2(p_field_values::VARCHAR, 256);
    v_cache_key := SHA2(:p_profile_id || '|' || :v_input_hash || '|' || :p_threshold::VARCHAR, 256);

    -- ==========================================================
    -- FAST PATH: Check EXACT fields (tax_id, email) for instant match
    -- ==========================================================
    -- Look for any EXACT-strategy field that has a provided value
    -- and try a direct lookup. This skips the full scoring pipeline.
    BEGIN
        SELECT pe.entity_id, pe.display_name
        INTO :v_entity_id, :v_display_name
        FROM profile_entities pe
        JOIN profile_fields pf ON pf.profile_id = pe.profile_id
        WHERE pe.profile_id = :p_profile_id
          AND pe.is_active = TRUE
          AND pf.match_strategy = 'EXACT'
          AND pf.weight >= 3.0  -- Only high-weight EXACT fields qualify for fast-path
          AND :p_field_values[pf.field_name] IS NOT NULL
          AND LOWER(TRIM(pe.field_values[pf.field_name]::VARCHAR)) = LOWER(TRIM(:p_field_values[pf.field_name]::VARCHAR))
        LIMIT 1;

        IF (v_entity_id IS NOT NULL) THEN
            v_match_score := 1.0;
            v_match_type := 'EXACT_FASTPATH';
            v_field_scores := OBJECT_CONSTRUCT('_fastpath', 'exact_field_match');
            -- Skip to caching and return
        END IF;
    EXCEPTION
        WHEN OTHER THEN
            v_entity_id := NULL;  -- No fast-path match, continue normally
    END;

    -- ==========================================================
    -- CACHE CHECK (if fast-path didn't match)
    -- ==========================================================
    IF (v_entity_id IS NULL) THEN
        BEGIN
            SELECT matched_entity_id, matched_display_name, match_score, match_type, field_scores
            INTO :v_entity_id, :v_display_name, :v_match_score, :v_match_type, :v_field_scores
            FROM profile_match_cache
            WHERE cache_key = :v_cache_key
              AND expires_at > CURRENT_TIMESTAMP()
            LIMIT 1;

            IF (v_entity_id IS NOT NULL) THEN
                v_was_cached := TRUE;
                UPDATE profile_match_cache SET hit_count = hit_count + 1 WHERE cache_key = :v_cache_key;
            END IF;
        EXCEPTION
            WHEN OTHER THEN
                v_entity_id := NULL;
        END;
    END IF;

    -- ==========================================================
    -- FULL MATCHING (if neither fast-path nor cache matched)
    -- ==========================================================
    IF (v_entity_id IS NULL) THEN
        BEGIN
            SELECT entity_id, display_name, match_score, match_type, field_scores
            INTO :v_entity_id, :v_display_name, :v_match_score, :v_match_type, :v_field_scores
            FROM TABLE(resolve_entity(:p_profile_id, :p_field_values, :p_threshold))
            ORDER BY match_score DESC
            LIMIT 1;
        EXCEPTION
            WHEN OTHER THEN
                v_entity_id := NULL;
        END;

        -- ==========================================================
        -- CREATE NEW ENTITY (if no match and create_if_missing is true)
        -- ==========================================================
        IF (v_entity_id IS NULL AND :p_create_if_missing) THEN
            v_is_new := TRUE;
            v_entity_id := UUID_STRING();
            v_match_score := 1.0;
            v_match_type := 'NEW_ENTITY';
            v_field_scores := PARSE_JSON('{}');

            -- Determine display_name from primary_display field or first required field
            BEGIN
                SELECT :p_field_values[pf.field_name]::VARCHAR
                INTO :v_display_name
                FROM profile_fields pf
                WHERE pf.profile_id = :p_profile_id
                  AND (pf.is_primary_display = TRUE OR pf.is_required = TRUE)
                  AND :p_field_values[pf.field_name] IS NOT NULL
                ORDER BY pf.is_primary_display DESC, pf.field_order ASC
                LIMIT 1;
            EXCEPTION
                WHEN OTHER THEN
                    v_display_name := 'Unknown Entity';
            END;

            -- Insert entity
            INSERT INTO profile_entities (entity_id, profile_id, display_name, field_values, metadata)
            SELECT :v_entity_id, :p_profile_id, :v_display_name, :p_field_values, :p_metadata;

            -- Generate embeddings for each SEMANTIC field that has a value
            INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
            SELECT
                :v_entity_id,
                :p_profile_id,
                pf.field_name,
                :p_field_values[pf.field_name]::VARCHAR,
                SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', :p_field_values[pf.field_name]::VARCHAR)
            FROM profile_fields pf
            WHERE pf.profile_id = :p_profile_id
              AND pf.match_strategy IN ('SEMANTIC', 'HYBRID')
              AND :p_field_values[pf.field_name] IS NOT NULL;

            -- Invalidate low-score cache entries that might now match differently
            DELETE FROM profile_match_cache
            WHERE profile_id = :p_profile_id
              AND expires_at > CURRENT_TIMESTAMP()
              AND match_score < 0.7;
        END IF;

        -- ==========================================================
        -- UPDATE CACHE
        -- ==========================================================
        IF (v_entity_id IS NOT NULL AND NOT v_was_cached) THEN
            MERGE INTO profile_match_cache tgt
            USING (
                SELECT
                    :v_cache_key AS cache_key,
                    :p_profile_id AS profile_id,
                    :v_input_hash AS input_hash,
                    :v_entity_id AS matched_entity_id,
                    :v_display_name AS matched_display_name,
                    :v_match_score AS match_score,
                    :v_match_type AS match_type,
                    :v_field_scores AS field_scores,
                    :p_threshold AS threshold_used,
                    CURRENT_TIMESTAMP() AS created_at,
                    DATEADD('hour', 1, CURRENT_TIMESTAMP()) AS expires_at
            ) src
            ON tgt.cache_key = src.cache_key
            WHEN MATCHED THEN UPDATE SET
                matched_entity_id = src.matched_entity_id,
                matched_display_name = src.matched_display_name,
                match_score = src.match_score,
                match_type = src.match_type,
                field_scores = src.field_scores,
                created_at = src.created_at,
                expires_at = src.expires_at,
                hit_count = 0
            WHEN NOT MATCHED THEN INSERT (
                cache_key, profile_id, input_hash, matched_entity_id, matched_display_name,
                match_score, match_type, field_scores, threshold_used, created_at, expires_at
            ) VALUES (
                src.cache_key, src.profile_id, src.input_hash, src.matched_entity_id, src.matched_display_name,
                src.match_score, src.match_type, src.field_scores, src.threshold_used, src.created_at, src.expires_at
            );
        END IF;
    END IF;

    -- ==========================================================
    -- LOG & RETURN
    -- ==========================================================
    v_execution_ms := DATEDIFF('millisecond', v_start_time, CURRENT_TIMESTAMP());

    INSERT INTO profile_match_log (profile_id, input_fields, matched_entity_id, match_score, match_type, field_scores, was_cached, execution_ms)
    SELECT :p_profile_id, :p_field_values, :v_entity_id, :v_match_score, :v_match_type, :v_field_scores, :v_was_cached, :v_execution_ms;

    v_result := OBJECT_CONSTRUCT(
        'entity_id',     v_entity_id,
        'display_name',  v_display_name,
        'match_score',   v_match_score,
        'match_type',    v_match_type,
        'field_scores',  v_field_scores,
        'is_new_entity', v_is_new,
        'was_cached',    v_was_cached,
        'execution_ms',  v_execution_ms
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHER THEN
        v_execution_ms := DATEDIFF('millisecond', v_start_time, CURRENT_TIMESTAMP());
        INSERT INTO profile_match_log (profile_id, input_fields, match_type, execution_ms)
        SELECT :p_profile_id, :p_field_values, 'ERROR', :v_execution_ms;

        RETURN OBJECT_CONSTRUCT(
            'error',   TRUE,
            'message', SQLERRM,
            'sqlcode', SQLCODE,
            'input',   p_field_values
        );
END;
$$;


-- =============================================================================
-- PROCEDURE: batch_resolve_and_upsert
-- =============================================================================
CREATE OR REPLACE PROCEDURE batch_resolve_and_upsert(
    p_profile_id  VARCHAR,
    p_entities    VARIANT,       -- Array of {fields: {...}, metadata: {...}}
    p_threshold   FLOAT DEFAULT 0.65,
    p_create_if_missing BOOLEAN DEFAULT FALSE
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_results       VARIANT DEFAULT PARSE_JSON('[]');
    v_single_result VARIANT;
    v_field_values  VARIANT;
    v_metadata      VARIANT;
    v_idx           INTEGER DEFAULT 0;
    v_count         INTEGER;
BEGIN
    v_count := ARRAY_SIZE(:p_entities);

    WHILE (v_idx < v_count) DO
        v_field_values := :p_entities[:v_idx]:fields;
        v_metadata := COALESCE(:p_entities[:v_idx]:metadata, PARSE_JSON('{}'));

        CALL resolve_and_upsert(:p_profile_id, :v_field_values, :v_metadata, :p_threshold, :p_create_if_missing)
            INTO :v_single_result;

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
-- PROCEDURE: bulk_load_entities (insert-only, no matching)
-- =============================================================================
CREATE OR REPLACE PROCEDURE bulk_load_entities(
    p_profile_id  VARCHAR,
    p_entities    VARIANT        -- Array of {fields: {...}, display_name: "...", metadata: {...}}
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_idx             INTEGER DEFAULT 0;
    v_count           INTEGER;
    v_loaded          INTEGER DEFAULT 0;
    v_embeddings      INTEGER DEFAULT 0;
    v_entity_id       VARCHAR;
    v_display_name    VARCHAR;
    v_field_values    VARIANT;
    v_metadata        VARIANT;
    v_primary_field   VARCHAR;
    v_start_time      TIMESTAMP_NTZ;
BEGIN
    v_start_time := CURRENT_TIMESTAMP();
    v_count := ARRAY_SIZE(:p_entities);

    -- Find primary display field
    SELECT field_name INTO :v_primary_field
    FROM profile_fields
    WHERE profile_id = :p_profile_id AND (is_primary_display = TRUE OR is_required = TRUE)
    ORDER BY is_primary_display DESC, field_order ASC
    LIMIT 1;

    WHILE (v_idx < v_count) DO
        v_entity_id := UUID_STRING();
        v_field_values := :p_entities[:v_idx]:fields;
        v_metadata := :p_entities[:v_idx]:metadata;
        v_display_name := COALESCE(
            :p_entities[:v_idx]:display_name::VARCHAR,
            :v_field_values[:v_primary_field]::VARCHAR,
            'Entity-' || :v_entity_id
        );

        -- Insert entity
        INSERT INTO profile_entities (entity_id, profile_id, display_name, field_values, metadata)
        SELECT :v_entity_id, :p_profile_id, :v_display_name, :v_field_values, :v_metadata;

        -- Generate embeddings for SEMANTIC fields
        INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
        SELECT
            :v_entity_id,
            :p_profile_id,
            pf.field_name,
            :v_field_values[pf.field_name]::VARCHAR,
            SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', :v_field_values[pf.field_name]::VARCHAR)
        FROM profile_fields pf
        WHERE pf.profile_id = :p_profile_id
          AND pf.match_strategy IN ('SEMANTIC', 'HYBRID')
          AND :v_field_values[pf.field_name] IS NOT NULL;

        v_loaded := v_loaded + 1;
        v_idx := v_idx + 1;
    END WHILE;

    -- Count total embeddings generated
    SELECT COUNT(*) INTO :v_embeddings
    FROM profile_entity_embeddings
    WHERE profile_id = :p_profile_id
      AND created_at >= :v_start_time;

    RETURN OBJECT_CONSTRUCT(
        'total_loaded', v_loaded,
        'embeddings_generated', v_embeddings,
        'execution_ms', DATEDIFF('millisecond', v_start_time, CURRENT_TIMESTAMP())
    );
END;
$$;


-- =============================================================================
-- PROCEDURE: invalidate_profile_cache
-- =============================================================================
CREATE OR REPLACE PROCEDURE invalidate_profile_cache(
    p_profile_id VARCHAR,
    p_entity_id  VARCHAR DEFAULT NULL
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
        DELETE FROM profile_match_cache
        WHERE profile_id = :p_profile_id AND matched_entity_id = :p_entity_id;
    ELSE
        DELETE FROM profile_match_cache
        WHERE profile_id = :p_profile_id;
    END IF;

    v_deleted := SQLROWCOUNT;
    RETURN 'Invalidated ' || :v_deleted || ' cache entries';
END;
$$;


-- =============================================================================
-- TESTS
-- =============================================================================

-- Test 1: Resolve existing company
CALL resolve_and_upsert(
    'PROF-COMPANY-001',
    PARSE_JSON('{"name": "Microsoft"}'),
    NULL,
    0.65,
    FALSE
);

-- Test 2: Resolve supplier with tax_id fast-path
CALL resolve_and_upsert(
    'PROF-SUPPLIER-001',
    PARSE_JSON('{"name": "Acme", "tax_id": "36-1234567"}'),
    NULL,
    0.5,
    FALSE
);

-- Test 3: Create new entity when no match
CALL resolve_and_upsert(
    'PROF-SUPPLIER-001',
    PARSE_JSON('{"name": "Brand New Supplier XYZ", "city": "Seattle", "country": "USA", "tax_id": "99-0000001"}'),
    PARSE_JSON('{"source": "manual_entry"}'),
    0.90,
    TRUE
);

-- Test 4: Batch resolve
CALL batch_resolve_and_upsert(
    'PROF-PERSON-001',
    PARSE_JSON('[
        {"fields": {"first_name": "Jon", "last_name": "Smith", "email": "john.smith@acme.com"}},
        {"fields": {"first_name": "Maria", "last_name": "Garcia", "phone": "+52-55-1234-5678"}},
        {"fields": {"first_name": "Unknown", "last_name": "Person", "email": "nobody@test.com"}}
    ]'),
    0.5,
    TRUE
);

-- Test 5: Bulk load
CALL bulk_load_entities(
    'PROF-SUPPLIER-001',
    PARSE_JSON('[
        {"fields": {"name": "Test Supplier A", "city": "Boston", "country": "USA", "tax_id": "11-1111111"}},
        {"fields": {"name": "Test Supplier B", "city": "London", "country": "UK", "tax_id": "GB123456789"}}
    ]')
);
