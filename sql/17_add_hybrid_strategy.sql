-- =============================================================================
-- MIGRATION: Add HYBRID Match Strategy Support
-- Applies changes to enable HYBRID strategy (40% fuzzy + 60% semantic)
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- Step 1: Re-create the normalize_field_value function with HYBRID support
-- =============================================================================
CREATE OR REPLACE FUNCTION normalize_field_value(raw_value VARCHAR, strategy VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
IMMUTABLE
AS
$$
    CASE strategy
        WHEN 'EXACT' THEN LOWER(TRIM(raw_value))
        WHEN 'FUZZY' THEN
            TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(LOWER(TRIM(raw_value)), '[^a-z0-9\\s]', ''),
                '\\s+', ' '
            ))
        WHEN 'SEMANTIC' THEN TRIM(raw_value)
        WHEN 'HYBRID' THEN TRIM(raw_value)
        WHEN 'PHONETIC' THEN SOUNDEX(TRIM(raw_value))
        WHEN 'NUMERIC' THEN REGEXP_REPLACE(TRIM(raw_value), '[^0-9]', '')
        ELSE LOWER(TRIM(raw_value))
    END
$$;

-- =============================================================================
-- Step 2: Re-create the add_profile_field procedure with HYBRID validation
-- =============================================================================
CREATE OR REPLACE PROCEDURE add_profile_field(
    p_profile_id      VARCHAR,
    p_field_name      VARCHAR,
    p_field_label     VARCHAR,
    p_field_order     INTEGER,
    p_is_required     BOOLEAN,
    p_is_primary      BOOLEAN,
    p_match_strategy  VARCHAR,
    p_weight          FLOAT,
    p_strategy_config VARIANT
)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    valid_strategies ARRAY := ARRAY_CONSTRUCT('EXACT','FUZZY','SEMANTIC','PHONETIC','NUMERIC','HYBRID','NONE');
BEGIN
    -- Validate match_strategy
    IF (NOT ARRAY_CONTAINS(p_match_strategy::VARIANT, valid_strategies)) THEN
        RETURN 'ERROR: match_strategy must be one of: EXACT, FUZZY, SEMANTIC, PHONETIC, NUMERIC, HYBRID, NONE';
    END IF;
    
    -- Validate weight
    IF (p_weight < 0.0 OR p_weight > 10.0) THEN
        RETURN 'ERROR: weight must be between 0.0 and 10.0';
    END IF;
    
    -- Insert if valid
    INSERT INTO profile_fields (
        profile_id, field_name, field_label, field_order, 
        is_required, is_primary_display, match_strategy, weight, strategy_config
    ) VALUES (
        p_profile_id, p_field_name, p_field_label, p_field_order,
        p_is_required, p_is_primary, p_match_strategy, p_weight, p_strategy_config
    );
    
    RETURN 'SUCCESS';
END;
$$;

-- =============================================================================
-- Step 3: Re-create resolve_entity function with HYBRID support
-- =============================================================================
-- Note: This is done by re-running sql/12_resolveiq_matching.sql
-- The updated version includes the hybrid_scores CTE

-- =============================================================================
-- Step 4: Re-create resolve_and_upsert procedure with HYBRID embedding support
-- =============================================================================
-- Note: This is done by re-running sql/13_resolveiq_procedures.sql
-- The updated version generates embeddings for both SEMANTIC and HYBRID fields

-- =============================================================================
-- Step 5: Verification - Test HYBRID strategy
-- =============================================================================

-- Show all current field strategies
SELECT 
    rp.profile_name,
    pf.field_name,
    pf.match_strategy,
    pf.weight
FROM profile_fields pf
JOIN resolution_profiles rp ON rp.profile_id = pf.profile_id
WHERE rp.is_active = TRUE
ORDER BY rp.profile_name, pf.field_order;

-- =============================================================================
-- NOTES FOR APPLYING THE MIGRATION:
-- =============================================================================
-- 1. Run this script to update the helper functions
-- 2. Re-run sql/12_resolveiq_matching.sql to update resolve_entity function
-- 3. Re-run sql/13_resolveiq_procedures.sql to update resolve_and_upsert procedure
-- 4. Existing profiles can now use HYBRID strategy
-- 5. New embeddings will be generated automatically for HYBRID fields
-- 6. Backend API already accepts HYBRID via updated Pydantic models
-- 7. Frontend UI now shows HYBRID in the strategy dropdown

-- Example: Update a field to use HYBRID strategy
-- UPDATE profile_fields 
-- SET match_strategy = 'HYBRID', weight = 5.0
-- WHERE profile_id = (SELECT profile_id FROM resolution_profiles WHERE profile_slug = 'company')
--   AND field_name = 'name';

-- After updating to HYBRID, regenerate embeddings for that field:
-- DELETE FROM profile_entity_embeddings 
-- WHERE profile_id = (SELECT profile_id FROM resolution_profiles WHERE profile_slug = 'company')
--   AND field_name = 'name';

-- INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
-- SELECT 
--     pe.entity_id,
--     pe.profile_id,
--     'name' AS field_name,
--     pe.field_values['name']::VARCHAR AS source_text,
--     SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', pe.field_values['name']::VARCHAR) AS embedding
-- FROM profile_entities pe
-- WHERE pe.profile_id = (SELECT profile_id FROM resolution_profiles WHERE profile_slug = 'company')
--   AND pe.field_values['name'] IS NOT NULL;
