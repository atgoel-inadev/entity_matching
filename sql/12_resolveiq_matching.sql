-- =============================================================================
-- RESOLVEIQ: Generic Matching Engine
-- Configuration-driven: reads strategies & weights from profile_fields
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- MAIN UDTF: resolve_entity
-- Scores all candidate entities across all configured fields
-- Returns top 10 matches above threshold with per-field breakdown
-- =============================================================================
CREATE OR REPLACE FUNCTION resolve_entity(
    p_profile_id   VARCHAR,
    p_field_values VARIANT,        -- {"name": "Acme", "tax_id": "123", ...}
    p_threshold    FLOAT DEFAULT 0.65
)
RETURNS TABLE (
    entity_id      VARCHAR,
    display_name   VARCHAR,
    match_score    FLOAT,
    match_type     VARCHAR,
    field_scores   VARIANT         -- {"name": 0.92, "tax_id": 1.0, ...}
)
LANGUAGE SQL
AS
$$
    WITH
    -- Step 1: Load field config for this profile (tiny table, cached by Snowflake)
    field_config AS (
        SELECT field_name, match_strategy, weight
        FROM profile_fields
        WHERE profile_id = p_profile_id
          AND match_strategy != 'NONE'
    ),

    -- Step 2: Identify which input fields are provided AND have a configured strategy
    active_fields AS (
        SELECT
            fc.field_name,
            fc.match_strategy,
            fc.weight,
            p_field_values[fc.field_name]::VARCHAR AS input_value
        FROM field_config fc
        WHERE p_field_values[fc.field_name] IS NOT NULL
          AND TRIM(p_field_values[fc.field_name]::VARCHAR) != ''
    ),

    -- Step 3: Total active weight for normalization (handles partial matching)
    weight_sum AS (
        SELECT GREATEST(SUM(weight), 0.001) AS total_weight FROM active_fields
    ),

    -- Step 4: All candidate entities for this profile
    candidates AS (
        SELECT entity_id, display_name, field_values
        FROM profile_entities
        WHERE profile_id = p_profile_id
          AND is_active = TRUE
    ),

    -- Step 5: Non-semantic field scores (EXACT, FUZZY, PHONETIC, NUMERIC)
    nonsemantic_scores AS (
        SELECT
            c.entity_id,
            af.field_name,
            af.weight,
            af.match_strategy,
            compute_field_score(
                af.input_value,
                c.field_values[af.field_name]::VARCHAR,
                af.match_strategy
            ) AS field_score
        FROM candidates c
        CROSS JOIN active_fields af
        WHERE af.match_strategy IN ('EXACT', 'FUZZY', 'PHONETIC', 'NUMERIC')
    ),

    -- Step 6: Semantic field scores via embedding cosine similarity
    semantic_scores AS (
        SELECT
            pee.entity_id,
            af.field_name,
            af.weight,
            'SEMANTIC' AS match_strategy,
            VECTOR_COSINE_SIMILARITY(
                pee.embedding,
                SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', af.input_value)
            )::FLOAT AS field_score
        FROM profile_entity_embeddings pee
        CROSS JOIN (
            SELECT field_name, input_value, weight
            FROM active_fields
            WHERE match_strategy = 'SEMANTIC'
        ) af
        WHERE pee.profile_id = p_profile_id
          AND pee.field_name = af.field_name
          -- Pre-filter: skip low-quality semantic matches early
          AND VECTOR_COSINE_SIMILARITY(
                pee.embedding,
                SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', af.input_value)
              ) >= 0.4
    ),

    -- Step 6b: HYBRID field scores (40% fuzzy + 60% semantic)
    hybrid_scores AS (
        SELECT
            c.entity_id,
            af.field_name,
            af.weight,
            'HYBRID' AS match_strategy,
            (
                COALESCE(
                    compute_field_score(
                        af.input_value,
                        c.field_values[af.field_name]::VARCHAR,
                        'FUZZY'
                    ), 0
                ) * 0.4
                +
                COALESCE(
                    VECTOR_COSINE_SIMILARITY(
                        pee.embedding,
                        SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', af.input_value)
                    ), 0
                ) * 0.6
            )::FLOAT AS field_score
        FROM candidates c
        CROSS JOIN (
            SELECT field_name, input_value, weight
            FROM active_fields
            WHERE match_strategy = 'HYBRID'
        ) af
        LEFT JOIN profile_entity_embeddings pee
            ON pee.entity_id = c.entity_id
            AND pee.profile_id = p_profile_id
            AND pee.field_name = af.field_name
        WHERE c.field_values[af.field_name] IS NOT NULL
    ),

    -- Step 7: Union all field scores
    all_scores AS (
        SELECT entity_id, field_name, weight, match_strategy, field_score
        FROM nonsemantic_scores
        WHERE field_score IS NOT NULL

        UNION ALL

        SELECT entity_id, field_name, weight, match_strategy, field_score
        FROM semantic_scores

        UNION ALL

        SELECT entity_id, field_name, weight, match_strategy, field_score
        FROM hybrid_scores
        WHERE field_score IS NOT NULL
    ),

    -- Step 7b: Deduplicate field scores (take max score per entity+field)
    deduped_scores AS (
        SELECT
            entity_id,
            field_name,
            MAX(weight) AS weight,
            MAX(match_strategy) AS match_strategy,
            MAX(field_score) AS field_score
        FROM all_scores
        GROUP BY entity_id, field_name
    ),

    -- Step 8: Compute weighted composite per entity
    entity_composite AS (
        SELECT
            s.entity_id,
            -- Weighted average: sum(score*weight) / sum(active_weights)
            (SUM(s.field_score * s.weight) / ws.total_weight)::FLOAT AS composite_score,
            -- Per-field breakdown as JSON object
            OBJECT_AGG(s.field_name, ROUND(s.field_score, 4)::VARIANT)::VARIANT AS field_scores_obj,
            -- Classify match type
            CASE
                WHEN MIN(s.field_score) = 1.0 AND COUNT(*) = (SELECT COUNT(*) FROM active_fields)
                    THEN 'EXACT_ALL'
                WHEN MAX(CASE WHEN s.match_strategy = 'HYBRID' AND s.field_score >= 0.9 THEN 1 ELSE 0 END) = 1
                    THEN 'HYBRID_HIGH'
                WHEN MAX(CASE WHEN s.match_strategy = 'EXACT' AND s.field_score = 1.0 THEN 1 ELSE 0 END) = 1
                     AND MAX(CASE WHEN s.match_strategy = 'SEMANTIC' AND s.field_score >= 0.9 THEN 1 ELSE 0 END) = 1
                    THEN 'EXACT_SEMANTIC'
                WHEN MAX(CASE WHEN s.match_strategy = 'EXACT' AND s.field_score = 1.0 THEN 1 ELSE 0 END) = 1
                    THEN 'EXACT'
                WHEN MAX(CASE WHEN s.match_strategy = 'HYBRID' THEN s.field_score ELSE 0 END) >= 0.7
                    THEN 'HYBRID'
                WHEN MAX(CASE WHEN s.match_strategy = 'SEMANTIC' THEN s.field_score ELSE 0 END) >= 0.8
                    THEN 'SEMANTIC'
                WHEN MAX(CASE WHEN s.match_strategy IN ('FUZZY','PHONETIC') THEN s.field_score ELSE 0 END) >= 0.7
                    THEN 'FUZZY'
                ELSE 'COMPOSITE'
            END AS match_type
        FROM deduped_scores s
        CROSS JOIN weight_sum ws
        GROUP BY s.entity_id, ws.total_weight
        HAVING (SUM(s.field_score * s.weight) / ws.total_weight) >= p_threshold
    ),

    -- Step 9: Join back for display names and rank
    ranked AS (
        SELECT
            ec.entity_id,
            c.display_name,
            ec.composite_score AS match_score,
            ec.match_type,
            ec.field_scores_obj AS field_scores,
            ROW_NUMBER() OVER (ORDER BY ec.composite_score DESC) AS rn
        FROM entity_composite ec
        JOIN candidates c ON c.entity_id = ec.entity_id
    )

    SELECT entity_id, display_name, match_score, match_type, field_scores
    FROM ranked
    WHERE rn <= 10
    ORDER BY match_score DESC
$$;


-- =============================================================================
-- CONVENIENCE: Best single match for a profile
-- =============================================================================
CREATE OR REPLACE FUNCTION best_resolve_match(
    p_profile_id   VARCHAR,
    p_field_values VARIANT,
    p_threshold    FLOAT DEFAULT 0.65
)
RETURNS TABLE (
    entity_id    VARCHAR,
    display_name VARCHAR,
    match_score  FLOAT,
    match_type   VARCHAR,
    field_scores VARIANT
)
LANGUAGE SQL
AS
$$
    SELECT entity_id, display_name, match_score, match_type, field_scores
    FROM TABLE(resolve_entity(p_profile_id, p_field_values, p_threshold))
    ORDER BY match_score DESC
    LIMIT 1
$$;


-- =============================================================================
-- HELPER: Lookup profile_id by slug
-- =============================================================================
CREATE OR REPLACE FUNCTION get_profile_id(p_slug VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
    SELECT profile_id
    FROM resolution_profiles
    WHERE profile_slug = p_slug
      AND is_active = TRUE
    LIMIT 1
$$;


-- =============================================================================
-- TESTS
-- =============================================================================

-- Test 1: Company match by name only
SELECT * FROM TABLE(resolve_entity(
    'PROF-COMPANY-001',
    PARSE_JSON('{"name": "IBM"}'),
    0.5::FLOAT
));

-- Test 2: Company match with industry filter boost
SELECT * FROM TABLE(resolve_entity(
    'PROF-COMPANY-001',
    PARSE_JSON('{"name": "Microsft", "industry": "Technology"}'),
    0.5::FLOAT
));

-- Test 3: Supplier match - name + tax_id (should fast-path on tax_id)
SELECT * FROM TABLE(resolve_entity(
    'PROF-SUPPLIER-001',
    PARSE_JSON('{"name": "Acme Supply", "tax_id": "36-1234567"}'),
    0.5::FLOAT
));

-- Test 4: Supplier match - name + address (fuzzy on both)
SELECT * FROM TABLE(resolve_entity(
    'PROF-SUPPLIER-001',
    PARSE_JSON('{"name": "Global Parts Mfg", "city": "Detroit", "country": "USA"}'),
    0.5::FLOAT
));

-- Test 5: Person match - name phonetic + email exact
SELECT * FROM TABLE(resolve_entity(
    'PROF-PERSON-001',
    PARSE_JSON('{"first_name": "Jon", "last_name": "Smith", "email": "john.smith@acme.com"}'),
    0.5::FLOAT
));

-- Test 6: Person match - phone number dedup
SELECT * FROM TABLE(resolve_entity(
    'PROF-PERSON-001',
    PARSE_JSON('{"first_name": "J", "last_name": "Smith", "phone": "1-555-0101"}'),
    0.3::FLOAT
));

-- Test 7: Best single match
SELECT * FROM TABLE(best_resolve_match(
    'PROF-COMPANY-001',
    PARSE_JSON('{"name": "Wal Mart"}'),
    0.5::FLOAT
));
