-- =============================================================================
-- SECTION B: HYBRID ENTITY MATCHING UDF
-- Combines Levenshtein (fuzzy) + Cosine Similarity (semantic)
-- Weighted: 40% fuzzy + 60% semantic
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- HELPER: Fuzzy score based on EDITDISTANCE (normalized 0-1)
-- =============================================================================
CREATE OR REPLACE FUNCTION fuzzy_score(input_name VARCHAR, candidate_name VARCHAR)
RETURNS FLOAT
LANGUAGE SQL
IMMUTABLE
AS
$$
    -- Normalize edit distance to 0-1 scale where 1 = perfect match
    -- Max possible distance = length of longer string
    CASE
        WHEN input_name IS NULL OR candidate_name IS NULL THEN 0
        WHEN LOWER(TRIM(input_name)) = LOWER(TRIM(candidate_name)) THEN 1.0
        ELSE
            GREATEST(0,
                1.0 - (
                    EDITDISTANCE(LOWER(TRIM(input_name)), LOWER(TRIM(candidate_name)))::FLOAT
                    / GREATEST(LENGTH(input_name), LENGTH(candidate_name), 1)::FLOAT
                )
            )
    END
$$;


-- =============================================================================
-- MAIN UDF: hybrid_entity_match
-- Returns TABLE of matches above threshold
-- =============================================================================
CREATE OR REPLACE FUNCTION hybrid_entity_match(
    input_name VARCHAR,
    threshold  FLOAT DEFAULT 0.65
)
RETURNS TABLE (
    entity_id    VARCHAR,
    canonical_name VARCHAR,
    matched_alias VARCHAR,
    fuzzy_score_val  FLOAT,
    semantic_score   FLOAT,
    hybrid_score     FLOAT,
    match_type       VARCHAR
)
LANGUAGE SQL
AS
$$
    WITH
    -- Step 1: Generate embedding for the input name (one-time cost per call)
    input_embedding AS (
        SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', input_name) AS emb
    ),

    -- Step 2: Check for exact match first (fastest path)
    exact_matches AS (
        SELECT
            a.entity_id,
            a.alias_name,
            1.0::FLOAT AS fuzzy_sc,
            1.0::FLOAT AS semantic_sc,
            1.0::FLOAT AS hybrid_sc,
            'EXACT'    AS match_type
        FROM entity_aliases a
        WHERE a.name_normalized = normalize_name(input_name)
    ),

    -- Step 3: Fuzzy candidates - pre-filter using first 2 chars + length similarity
    -- This avoids computing EDITDISTANCE on every row
    fuzzy_candidates AS (
        SELECT
            a.entity_id,
            a.alias_id,
            a.alias_name,
            fuzzy_score(input_name, a.alias_name) AS fuzzy_sc
        FROM entity_aliases a
        WHERE
            -- Pre-filter: names must share first character or be within 50% length
            (
                SUBSTRING(a.name_normalized, 1, 1) = SUBSTRING(normalize_name(input_name), 1, 1)
                OR ABS(LENGTH(a.alias_name) - LENGTH(input_name)) < LENGTH(input_name) * 0.5
            )
            -- Skip if already found as exact
            AND a.name_normalized != normalize_name(input_name)
    ),

    -- Step 4: Semantic candidates - vector similarity on embeddings
    semantic_candidates AS (
        SELECT
            ee.entity_id,
            ee.alias_id,
            ee.source_text AS alias_name,
            VECTOR_COSINE_SIMILARITY(ee.embedding, ie.emb)::FLOAT AS semantic_sc
        FROM entity_embeddings ee
        CROSS JOIN input_embedding ie
        WHERE VECTOR_COSINE_SIMILARITY(ee.embedding, ie.emb) >= 0.5  -- Pre-filter low-quality semantic matches
    ),

    -- Step 5: Combine fuzzy + semantic with weighted scoring
    hybrid_matches AS (
        SELECT
            COALESCE(f.entity_id, s.entity_id) AS entity_id,
            COALESCE(f.alias_name, s.alias_name) AS alias_name,
            COALESCE(f.fuzzy_sc, 0)::FLOAT AS fuzzy_sc,
            COALESCE(s.semantic_sc, 0)::FLOAT AS semantic_sc,
            -- Weighted: 40% fuzzy + 60% semantic
            (COALESCE(f.fuzzy_sc, 0) * 0.4 + COALESCE(s.semantic_sc, 0) * 0.6)::FLOAT AS hybrid_sc,
            CASE
                WHEN COALESCE(f.fuzzy_sc, 0) >= 0.9 AND COALESCE(s.semantic_sc, 0) >= 0.9 THEN 'HYBRID_HIGH'
                WHEN COALESCE(f.fuzzy_sc, 0) >= 0.7 THEN 'FUZZY'
                WHEN COALESCE(s.semantic_sc, 0) >= 0.7 THEN 'SEMANTIC'
                ELSE 'HYBRID'
            END AS match_type
        FROM fuzzy_candidates f
        FULL OUTER JOIN semantic_candidates s
            ON f.entity_id = s.entity_id AND f.alias_id = s.alias_id
    ),

    -- Step 6: Union exact + hybrid, deduplicate by entity
    all_matches AS (
        -- Exact matches first
        SELECT entity_id, alias_name, fuzzy_sc, semantic_sc, hybrid_sc, match_type
        FROM exact_matches

        UNION ALL

        -- Hybrid matches
        SELECT entity_id, alias_name, fuzzy_sc, semantic_sc, hybrid_sc, match_type
        FROM hybrid_matches
        WHERE hybrid_sc >= threshold
    ),

    -- Step 7: Rank and pick best match per entity
    ranked AS (
        SELECT
            m.entity_id,
            e.canonical_name,
            m.alias_name AS matched_alias,
            m.fuzzy_sc AS fuzzy_score_val,
            m.semantic_sc AS semantic_score,
            m.hybrid_sc AS hybrid_score,
            m.match_type,
            ROW_NUMBER() OVER (PARTITION BY m.entity_id ORDER BY m.hybrid_sc DESC) AS rn
        FROM all_matches m
        JOIN entities e ON e.entity_id = m.entity_id
    )

    SELECT
        entity_id,
        canonical_name,
        matched_alias,
        fuzzy_score_val,
        semantic_score,
        hybrid_score,
        match_type
    FROM ranked
    WHERE rn = 1
    ORDER BY hybrid_score DESC
    LIMIT 10
$$;


-- =============================================================================
-- CONVENIENCE WRAPPER: Get single best match
-- =============================================================================
CREATE OR REPLACE FUNCTION best_entity_match(
    input_name VARCHAR,
    threshold  FLOAT DEFAULT 0.65
)
RETURNS TABLE (
    entity_id    VARCHAR,
    canonical_name VARCHAR,
    matched_alias VARCHAR,
    match_score    FLOAT,
    match_type     VARCHAR
)
LANGUAGE SQL
AS
$$
    SELECT
        entity_id,
        canonical_name,
        matched_alias,
        hybrid_score AS match_score,
        match_type
    FROM TABLE(hybrid_entity_match(input_name, threshold))
    ORDER BY hybrid_score DESC
    LIMIT 1
$$;


-- =============================================================================
-- TEST THE UDF
-- =============================================================================

-- Test 1: Exact match
SELECT * FROM TABLE(hybrid_entity_match('IBM', 0.5::FLOAT));

-- Test 2: Fuzzy match (misspelling)
SELECT * FROM TABLE(hybrid_entity_match('Microsft', 0.5::FLOAT));

-- Test 3: Semantic match (different name, same entity)
SELECT * FROM TABLE(hybrid_entity_match('Big Blue', 0.5::FLOAT));

-- Test 4: Abbreviation
SELECT * FROM TABLE(hybrid_entity_match('JP Morgan', 0.5::FLOAT));

-- Test 5: Best single match
SELECT * FROM TABLE(best_entity_match('Wal Mart Stores',0.9::FLOAT));

-- Test 6: No match expected
SELECT * FROM TABLE(hybrid_entity_match('Nonexistent Corp XYZ', 0.9::FLOAT));
