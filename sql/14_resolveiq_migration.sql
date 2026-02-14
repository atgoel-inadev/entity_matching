-- =============================================================================
-- RESOLVEIQ: Data Migration
-- Migrates existing legacy entities into the company profile
-- Old tables remain intact — this is additive, not destructive
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- Step 1: Migrate canonical entities from legacy 'entities' table
-- =============================================================================
INSERT INTO profile_entities (entity_id, profile_id, display_name, field_values, field_values_normalized, metadata, is_active, created_at)
SELECT
    e.entity_id,
    'PROF-COMPANY-001',
    e.canonical_name,
    OBJECT_CONSTRUCT(
        'name',     e.canonical_name,
        'industry', e.industry,
        'country',  e.country
    ),
    OBJECT_CONSTRUCT(
        'name',     normalize_field_value(e.canonical_name, 'SEMANTIC'),
        'industry', normalize_field_value(e.industry, 'EXACT'),
        'country',  normalize_field_value(e.country, 'EXACT')
    ),
    e.metadata,
    e.is_active,
    e.created_at
FROM entities e
-- Avoid duplicates if migration runs multiple times
WHERE NOT EXISTS (
    SELECT 1 FROM profile_entities pe
    WHERE pe.entity_id = e.entity_id AND pe.profile_id = 'PROF-COMPANY-001'
);

-- =============================================================================
-- Step 2: Migrate canonical name embeddings
-- =============================================================================
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding, model_version, created_at)
SELECT
    ee.entity_id,
    'PROF-COMPANY-001',
    'name',
    ee.source_text,
    ee.embedding,
    ee.model_version,
    ee.created_at
FROM entity_embeddings ee
WHERE ee.alias_id IS NULL  -- Canonical name embeddings only
  AND EXISTS (
    SELECT 1 FROM profile_entities pe
    WHERE pe.entity_id = ee.entity_id AND pe.profile_id = 'PROF-COMPANY-001'
  )
  AND NOT EXISTS (
    SELECT 1 FROM profile_entity_embeddings pee
    WHERE pee.entity_id = ee.entity_id AND pee.field_name = 'name'
  );

-- =============================================================================
-- Step 3: Migrate aliases as separate linkable entities
-- Each alias becomes its own profile_entity with a parent reference in metadata
-- =============================================================================
INSERT INTO profile_entities (entity_id, profile_id, display_name, field_values, field_values_normalized, metadata, is_active)
SELECT
    a.alias_id,
    'PROF-COMPANY-001',
    a.alias_name,
    OBJECT_CONSTRUCT('name', a.alias_name),
    OBJECT_CONSTRUCT('name', normalize_field_value(a.alias_name, 'SEMANTIC')),
    OBJECT_CONSTRUCT(
        'alias_type', a.alias_type,
        'parent_entity_id', a.entity_id,
        'is_alias', TRUE
    ),
    TRUE
FROM entity_aliases a
JOIN entities e ON e.entity_id = a.entity_id
-- Exclude the canonical name alias (already migrated as the entity itself)
WHERE a.alias_name != e.canonical_name
  AND NOT EXISTS (
    SELECT 1 FROM profile_entities pe
    WHERE pe.entity_id = a.alias_id AND pe.profile_id = 'PROF-COMPANY-001'
  );

-- Migrate alias embeddings
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding, model_version)
SELECT
    ee.alias_id,
    'PROF-COMPANY-001',
    'name',
    ee.source_text,
    ee.embedding,
    ee.model_version
FROM entity_embeddings ee
WHERE ee.alias_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM profile_entities pe
    WHERE pe.entity_id = ee.alias_id AND pe.profile_id = 'PROF-COMPANY-001'
  )
  AND NOT EXISTS (
    SELECT 1 FROM profile_entity_embeddings pee
    WHERE pee.entity_id = ee.alias_id AND pee.field_name = 'name'
  );


-- =============================================================================
-- VERIFICATION
-- =============================================================================
SELECT
    'Legacy entities' AS source,
    (SELECT COUNT(*) FROM entities) AS legacy_count,
    (SELECT COUNT(*) FROM profile_entities WHERE profile_id = 'PROF-COMPANY-001' AND metadata:is_alias IS NULL) AS migrated_entities,
    (SELECT COUNT(*) FROM profile_entities WHERE profile_id = 'PROF-COMPANY-001' AND metadata:is_alias = TRUE) AS migrated_aliases,
    (SELECT COUNT(*) FROM profile_entity_embeddings WHERE profile_id = 'PROF-COMPANY-001') AS migrated_embeddings;

-- Test: legacy data should now be resolvable via the new engine
SELECT * FROM TABLE(resolve_entity(
    'PROF-COMPANY-001',
    PARSE_JSON('{"name": "IBM"}')::VARIANT,
    0.5::FLOAT
));

SELECT * FROM TABLE(resolve_entity(
    'PROF-COMPANY-001',
    PARSE_JSON('{"name": "Big Blue"}')::VARIANT,
    0.5::FLOAT
));
