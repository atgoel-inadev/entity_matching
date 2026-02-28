-- =============================================================================
-- Migration: Case-Insensitive Embeddings
-- Date: 2026-03-01
--
-- Why: Semantic search was case-sensitive because embeddings were generated
-- from raw field values without normalization. "Shanghai" and "shanghai"
-- produced different embeddings, causing match failures when case differed.
--
-- Fix: Regenerate all embeddings with LOWER() normalization to match the
-- new behavior in EmbeddingFetcher (engine/src/resolution/pipeline/embedding.fetcher.ts)
-- and SemanticStrategy (engine/src/strategies/semantic.strategy.ts).
--
-- This is idempotent — safe to run multiple times.
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- Step 1: Delete existing embeddings (will be regenerated)
DELETE FROM profile_entity_embeddings;

-- Step 2: Regenerate embeddings for buyer_name field (B2B Buyer Match profile)
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
SELECT
    pe.entity_id,
    pe.profile_id,
    'buyer_name',
    LOWER(TRIM(pe.field_values:buyer_name::VARCHAR)) AS normalized_text,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', LOWER(TRIM(pe.field_values:buyer_name::VARCHAR)))
FROM profile_entities pe
WHERE pe.profile_id = 'PROF-BUYER-B2B-001'
  AND pe.is_active = TRUE
  AND pe.field_values:buyer_name IS NOT NULL;

-- Step 3: Regenerate embeddings for supplier_name field (B2B Supplier Match profile)
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
SELECT
    pe.entity_id,
    pe.profile_id,
    'supplier_name',
    LOWER(TRIM(pe.field_values:supplier_name::VARCHAR)) AS normalized_text,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', LOWER(TRIM(pe.field_values:supplier_name::VARCHAR)))
FROM profile_entities pe
WHERE pe.profile_id = 'PROF-SUPPLIER-B2B-001'
  AND pe.is_active = TRUE
  AND pe.field_values:supplier_name IS NOT NULL;

-- Verification: Check count of regenerated embeddings
SELECT 
    profile_id,
    field_name,
    COUNT(*) AS embedding_count,
    LEFT(source_text, 50) AS sample_text
FROM profile_entity_embeddings
GROUP BY profile_id, field_name, source_text
ORDER BY profile_id, field_name
LIMIT 10;

-- =============================================================================
-- Future: Update EmbeddingRefreshJob to use LOWER() normalization
--
-- When EntitySyncService or EmbeddingRefreshJob generates embeddings after
-- hourly sync, the SQL query must also use LOWER(TRIM(...)) before EMBED_TEXT_768.
--
-- File to update: sql/queries/entity_incremental_sync.sql
-- Current line needs LOWER() wrapper around field value extraction.
-- =============================================================================
