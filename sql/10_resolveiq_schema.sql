-- =============================================================================
-- RESOLVEIQ: Generic Entity Resolution Engine
-- Section 10: Schema & Tables
-- =============================================================================
-- Run AFTER existing 01-05 scripts. New tables coexist with legacy tables.
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- TABLE 1: RESOLUTION PROFILES
-- A profile defines a matching use case (e.g., "Supplier Dedup", "Person Match")
-- =============================================================================
CREATE TABLE IF NOT EXISTS resolution_profiles (
    profile_id          VARCHAR(36) DEFAULT UUID_STRING(),
    profile_name        VARCHAR(100) NOT NULL,
    profile_slug        VARCHAR(100) NOT NULL,          -- URL-safe identifier
    entity_type         VARCHAR(50) NOT NULL,            -- COMPANY, SUPPLIER, PERSON, ADDRESS, PRODUCT
    description         VARCHAR(1000),
    default_threshold   FLOAT DEFAULT 0.65,
    is_active           BOOLEAN DEFAULT TRUE,
    created_by          VARCHAR(100) DEFAULT 'system',
    created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    config              VARIANT,                         -- Future: custom normalization rules, blocking rules
    CONSTRAINT pk_profiles PRIMARY KEY (profile_id),
    CONSTRAINT uq_profile_slug UNIQUE (profile_slug)
);

-- =============================================================================
-- TABLE 2: PROFILE FIELDS
-- Each field in a profile has its own match strategy and weight
-- =============================================================================
CREATE TABLE IF NOT EXISTS profile_fields (
    field_id            VARCHAR(36) DEFAULT UUID_STRING(),
    profile_id          VARCHAR(36) NOT NULL,
    field_name          VARCHAR(100) NOT NULL,           -- "name", "address", "tax_id", "email"
    field_label         VARCHAR(200),                    -- Human-readable: "Company Name"
    field_order         INTEGER DEFAULT 0,               -- Processing/display order
    is_required         BOOLEAN DEFAULT FALSE,
    is_primary_display  BOOLEAN DEFAULT FALSE,           -- Used as display_name source
    match_strategy      VARCHAR(20) NOT NULL,            -- EXACT, FUZZY, SEMANTIC, PHONETIC, NUMERIC, HYBRID, NONE
    weight              FLOAT DEFAULT 1.0,               -- Contribution to composite score (0-10)
    strategy_config     VARIANT,                         -- Strategy-specific params (model, tolerance, etc.)
    created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_profile_fields PRIMARY KEY (field_id),
    CONSTRAINT fk_fields_profile FOREIGN KEY (profile_id) REFERENCES resolution_profiles(profile_id),
    CONSTRAINT uq_profile_field UNIQUE (profile_id, field_name)
);

-- Validation procedure to enforce constraints (alternative to CHECK)
CREATE OR REPLACE PROCEDURE insert_profile_field(
    p_profile_id       VARCHAR,
    p_field_name       VARCHAR,
    p_field_label      VARCHAR,
    p_field_order      INTEGER,
    p_is_required      BOOLEAN,
    p_is_primary       BOOLEAN,
    p_match_strategy   VARCHAR,
    p_weight           FLOAT,
    p_strategy_config  VARIANT
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
-- TABLE 3: PROFILE ENTITIES
-- Generic entity store — field values live in a VARIANT column
-- =============================================================================
CREATE TABLE IF NOT EXISTS profile_entities (
    entity_id               VARCHAR(36) DEFAULT UUID_STRING(),
    profile_id              VARCHAR(36) NOT NULL,
    display_name            VARCHAR(500) NOT NULL,           -- Primary display name
    field_values            VARIANT NOT NULL,                -- {"name": "IBM Corp", "address": "1 New Orchard Rd"}
    field_values_normalized VARIANT,                         -- Pre-normalized for fast matching
    metadata                VARIANT,                         -- Arbitrary extra data
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_profile_entities PRIMARY KEY (entity_id),
    CONSTRAINT fk_entities_profile FOREIGN KEY (profile_id) REFERENCES resolution_profiles(profile_id)
);

-- Cluster by profile for partition pruning
ALTER TABLE profile_entities CLUSTER BY (profile_id);
ALTER TABLE profile_entities ADD SEARCH OPTIMIZATION ON EQUALITY(profile_id);

-- =============================================================================
-- TABLE 4: PROFILE ENTITY EMBEDDINGS
-- Per-field embeddings — only generated for SEMANTIC-strategy fields
-- =============================================================================
CREATE TABLE IF NOT EXISTS profile_entity_embeddings (
    embedding_id        VARCHAR(36) DEFAULT UUID_STRING(),
    entity_id           VARCHAR(36) NOT NULL,
    profile_id          VARCHAR(36) NOT NULL,              -- Denormalized for query speed
    field_name          VARCHAR(100) NOT NULL,
    source_text         VARCHAR(2000) NOT NULL,
    embedding           VECTOR(FLOAT, 768),
    model_version       VARCHAR(50) DEFAULT 'e5-base-v2',
    created_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_profile_embeddings PRIMARY KEY (embedding_id),
    CONSTRAINT fk_pemb_entity FOREIGN KEY (entity_id) REFERENCES profile_entities(entity_id),
    CONSTRAINT uq_entity_field_emb UNIQUE (entity_id, field_name)
);

-- Cluster for fast vector scans within a profile+field
ALTER TABLE profile_entity_embeddings CLUSTER BY (profile_id, field_name);

-- =============================================================================
-- TABLE 5: PROFILE MATCH CACHE
-- Profile-aware query result cache
-- =============================================================================
CREATE TABLE IF NOT EXISTS profile_match_cache (
    cache_key               VARCHAR(64) NOT NULL,
    profile_id              VARCHAR(36) NOT NULL,
    input_hash              VARCHAR(64) NOT NULL,          -- SHA256 of input fields only
    matched_entity_id       VARCHAR(36),
    matched_display_name    VARCHAR(500),
    match_score             FLOAT,
    match_type              VARCHAR(30),
    field_scores            VARIANT,                       -- Per-field breakdown
    threshold_used          FLOAT,
    created_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    expires_at              TIMESTAMP_NTZ,
    hit_count               INTEGER DEFAULT 0,
    CONSTRAINT pk_profile_cache PRIMARY KEY (cache_key)
);

ALTER TABLE profile_match_cache ADD SEARCH OPTIMIZATION ON EQUALITY(cache_key);

-- =============================================================================
-- TABLE 6: PROFILE MATCH LOG
-- Profile-aware audit trail with field-level detail
-- =============================================================================
CREATE TABLE IF NOT EXISTS profile_match_log (
    log_id                  VARCHAR(36) DEFAULT UUID_STRING(),
    profile_id              VARCHAR(36) NOT NULL,
    input_fields            VARIANT,                       -- What was submitted
    matched_entity_id       VARCHAR(36),
    match_score             FLOAT,
    match_type              VARCHAR(30),
    field_scores            VARIANT,                       -- Per-field breakdown
    was_cached              BOOLEAN DEFAULT FALSE,
    execution_ms            INTEGER,
    created_at              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);


-- =============================================================================
-- HELPER: Strategy-aware field normalization
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
-- HELPER: Per-field score computation (non-semantic strategies)
-- =============================================================================
CREATE OR REPLACE FUNCTION compute_field_score(
    input_val     VARCHAR,
    candidate_val VARCHAR,
    strategy      VARCHAR
)
RETURNS FLOAT
LANGUAGE SQL
IMMUTABLE
AS
$$
    CASE
        -- NULL input = field not provided, skip scoring
        WHEN input_val IS NULL OR candidate_val IS NULL THEN NULL

        WHEN strategy = 'EXACT' THEN
            CASE WHEN LOWER(TRIM(input_val)) = LOWER(TRIM(candidate_val)) THEN 1.0 ELSE 0.0 END

        WHEN strategy = 'FUZZY' THEN
            GREATEST(0,
                1.0 - (
                    EDITDISTANCE(
                        normalize_field_value(input_val, 'FUZZY'),
                        normalize_field_value(candidate_val, 'FUZZY')
                    )::FLOAT
                    / GREATEST(LENGTH(input_val), LENGTH(candidate_val), 1)::FLOAT
                )
            )

        WHEN strategy = 'PHONETIC' THEN
            CASE
                WHEN SOUNDEX(TRIM(input_val)) = SOUNDEX(TRIM(candidate_val)) THEN 1.0
                -- Partial credit: fuzzy fallback for near-miss phonetics
                ELSE GREATEST(0,
                    (1.0 - (
                        EDITDISTANCE(LOWER(TRIM(input_val)), LOWER(TRIM(candidate_val)))::FLOAT
                        / GREATEST(LENGTH(input_val), LENGTH(candidate_val), 1)::FLOAT
                    )) * 0.5
                )
            END

        WHEN strategy = 'NUMERIC' THEN
            CASE
                WHEN REGEXP_REPLACE(TRIM(input_val), '[^0-9]', '') =
                     REGEXP_REPLACE(TRIM(candidate_val), '[^0-9]', '')
                THEN 1.0
                ELSE 0.0
            END

        ELSE 0.0
    END
$$;


-- =============================================================================
-- VERIFICATION
-- =============================================================================
SELECT 'resolution_profiles' AS tbl, COUNT(*) AS cnt FROM resolution_profiles
UNION ALL SELECT 'profile_fields', COUNT(*) FROM profile_fields
UNION ALL SELECT 'profile_entities', COUNT(*) FROM profile_entities
UNION ALL SELECT 'profile_entity_embeddings', COUNT(*) FROM profile_entity_embeddings;

-- Test helper functions
SELECT
    compute_field_score('IBM', 'IBM', 'EXACT')           AS exact_match,
    compute_field_score('Microsft', 'Microsoft', 'FUZZY') AS fuzzy_match,
    compute_field_score('Smith', 'Smyth', 'PHONETIC')    AS phonetic_match,
    compute_field_score('12-3456', '123456', 'NUMERIC')  AS numeric_match;
