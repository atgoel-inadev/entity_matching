-- ======================================================================================================
-- Migration: Add normalizer_options and strategy_options to profile_fields
-- ======================================================================================================
-- Date: 2026-03-01
-- Description: The TypeScript code expects separate normalizer_options and strategy_options columns,
--              but the original schema only had strategy_config. This migration adds the two new
--              columns and migrates any existing data from strategy_config.
-- ======================================================================================================

USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- Add the two new columns to profile_fields
ALTER TABLE profile_fields ADD COLUMN IF NOT EXISTS normalizer_options VARIANT;
ALTER TABLE profile_fields ADD COLUMN IF NOT EXISTS strategy_options VARIANT;

-- Migrate existing strategy_config data to strategy_options
-- (Assuming strategy_config was being used for strategy options)
UPDATE profile_fields
SET strategy_options = strategy_config,
    normalizer_options = OBJECT_CONSTRUCT()
WHERE strategy_config IS NOT NULL;

-- Optional: Drop strategy_config column if no longer needed
-- ALTER TABLE profile_fields DROP COLUMN strategy_config;

-- Add comments for documentation
COMMENT ON COLUMN profile_fields.normalizer_options IS 
    'JSON object for text normalization rules (e.g., lowercaseOnly, trimWhitespace, removeSpecialChars)';
    
COMMENT ON COLUMN profile_fields.strategy_options IS 
    'JSON object for strategy-specific parameters (e.g., semantic blend ratios for HYBRID, fuzzy threshold)';

-- Verify the changes
SELECT COUNT(*) AS total_fields, 
       COUNT(normalizer_options) AS with_normalizer,
       COUNT(strategy_options) AS with_strategy
FROM profile_fields;

COMMIT;
