-- =============================================================================
-- FastPathChecker: EXACT field fast-path lookup
--
-- Scans profile_entities for a candidate whose stored field value matches
-- the input exactly (case-insensitive). Runs AFTER AliasChecker (Step 0)
-- and BEFORE embedding/scoring — only triggered when the calling field has
-- weight >= FAST_PATH_MIN_WEIGHT (3.0 by default).
--
-- Called by: FastPathChecker.check() in resolution/pipeline/fast-path.checker.ts
--
-- Parameters (positional):
--   $1 — profile_id   VARCHAR(36)
--   $2 — field_name   VARCHAR(100)   e.g. 'tax_id', 'email'
--   $3 — field_value  VARCHAR        normalized input value (trim + lowercase)
--
-- Returns columns:
--   entity_id      VARCHAR(36)
--   salesforce_id  VARCHAR(50)    ← Primary return ID (may be NULL for Manual entities)
--   display_name   VARCHAR(500)
--   field_values   VARIANT
--   source_system  VARCHAR(20)
-- =============================================================================

SELECT
    pe.entity_id,
    pe.salesforce_id,
    pe.display_name,
    pe.field_values,
    pe.source_system
FROM profile_entities pe
WHERE pe.profile_id      = :profile_id
  AND pe.is_active       = TRUE
  AND pe.embedding_status = 'EMBEDDED'
  AND LOWER(TRIM(pe.field_values[:field_name]::VARCHAR)) = LOWER(TRIM(:field_value))
LIMIT 1;
