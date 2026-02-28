-- =============================================================================
-- EmbeddingRefreshJob / EntitySyncService: Entity upsert from hourly ETL
--
-- Inserts or updates a single entity record in profile_entities using the
-- Salesforce ID as the idempotency key. Safe to run on every hourly sync —
-- existing entities are updated only if last_modified_at is newer.
--
-- Called by: EntitySyncService.upsert()
--            in sync/entity-sync.service.ts
--
-- After this MERGE:
--   • New rows: embedding_status = 'PENDING'  (EmbeddingRefreshJob picks them up)
--   • Updated rows: embedding_status reset to 'PENDING' so embeddings regenerate
--   • Rows with no data change: left as-is (embedding_status unchanged)
--
-- Parameters (named — bound by Node.js snowflake-sdk):
--   :profile_id       VARCHAR(36)
--   :salesforce_id    VARCHAR(50)
--   :display_name     VARCHAR(500)
--   :field_values     VARIANT       JSON object of field values
--   :source_system    VARCHAR(20)   'Salesforce' | 'Gen3' | 'Manual'
--   :last_synced_at   TIMESTAMP_NTZ from the source ETL watermark
-- =============================================================================

MERGE INTO profile_entities AS target
USING (
    SELECT
        :profile_id    AS profile_id,
        :salesforce_id AS salesforce_id,
        :display_name  AS display_name,
        PARSE_JSON(:field_values)  AS field_values,
        :source_system AS source_system,
        :last_synced_at::TIMESTAMP_NTZ AS last_synced_at
) AS source
ON  target.profile_id    = source.profile_id
AND target.salesforce_id = source.salesforce_id

-- Row exists and source data is newer → update and mark for re-embedding
WHEN MATCHED AND source.last_synced_at > target.last_synced_at THEN
    UPDATE SET
        target.display_name     = source.display_name,
        target.field_values     = source.field_values,
        target.source_system    = source.source_system,
        target.last_synced_at   = source.last_synced_at,
        target.embedding_status = 'PENDING',
        target.updated_at       = CURRENT_TIMESTAMP()

-- New entity → insert with PENDING embedding status
WHEN NOT MATCHED THEN
    INSERT (
        profile_id,
        salesforce_id,
        display_name,
        field_values,
        source_system,
        last_synced_at,
        embedding_status,
        is_active,
        created_at,
        updated_at
    )
    VALUES (
        source.profile_id,
        source.salesforce_id,
        source.display_name,
        source.field_values,
        source.source_system,
        source.last_synced_at,
        'PENDING',
        TRUE,
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
    );
