-- =============================================================================
-- AliasChecker: Step 0 of the resolution pipeline
--
-- Checks whether the input field hash matches any active, embedded alias.
-- This runs BEFORE cache check and fast-path — an alias always returns
-- EXACT_MATCH (confidenceScore = 1.0) regardless of scoring.
--
-- Called by: AliasChecker.check() in resolution/pipeline/alias.checker.ts
--
-- Parameters (positional):
--   $1 — profile_id          VARCHAR(36)
--   $2 — alias_fields_hash   VARCHAR(64)   SHA2_HEX of sorted, normalized input fields
--
-- Returns columns:
--   alias_id      VARCHAR(36)
--   salesforce_id VARCHAR(50)   ← Primary return ID
--   display_name  VARCHAR(500)
--   alias_fields  VARIANT       Field values stored in the alias
-- =============================================================================

SELECT
    a.alias_id,
    a.salesforce_id,
    a.display_name,
    a.alias_fields
FROM entity_alias a
WHERE a.profile_id         = :profile_id
  AND a.alias_fields_hash  = :alias_fields_hash
  AND a.embedding_status   = 'EMBEDDED'
  AND a.is_active          = TRUE
LIMIT 1;
