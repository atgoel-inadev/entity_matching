-- =============================================================================
-- RESOLVEIQ: Profile-Aware Monitoring & Observability
-- Updated: v2.1 — uses resolution_scenario / confidence_score / error_code
--          instead of legacy match_type / match_score columns.
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- 1. Per-profile resolution scenario dashboard
--    Replaces old match_type breakdowns with the 4 v2 resolution scenarios.
--    error_code IS NOT NULL replaces the old match_type = 'ERROR' flag.
--    Fast-path hits: field_scores:_fastpath::BOOLEAN preserves the signal.
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_performance_dashboard AS
SELECT
    pml.profile_id,
    rp.profile_name,
    rp.entity_type,
    DATE_TRUNC('hour', pml.created_at)           AS hour_bucket,
    COUNT(*)                                     AS total_requests,

    -- Cache (Redis L0/L1 — was_cached flag set by engine)
    SUM(CASE WHEN pml.was_cached THEN 1 ELSE 0 END) AS cache_hits,
    ROUND(
        SUM(CASE WHEN pml.was_cached THEN 1 ELSE 0 END)::FLOAT
        / NULLIF(COUNT(*), 0) * 100, 2
    )                                            AS cache_hit_rate_pct,

    -- Latency
    ROUND(AVG(pml.execution_ms), 2)              AS avg_latency_ms,
    ROUND(MEDIAN(pml.execution_ms), 2)           AS p50_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY pml.execution_ms), 2) AS p95_latency_ms,
    MAX(pml.execution_ms)                        AS max_latency_ms,

    -- Errors (error_code IS NOT NULL replaces old match_type = 'ERROR')
    SUM(CASE WHEN pml.error_code IS NOT NULL THEN 1 ELSE 0 END) AS error_count,

    -- Resolution scenario breakdown (v2.1)
    SUM(CASE WHEN pml.resolution_scenario = 'EXACT_MATCH'     THEN 1 ELSE 0 END) AS exact_match_count,
    SUM(CASE WHEN pml.resolution_scenario = 'HIGH_CONFIDENCE' THEN 1 ELSE 0 END) AS high_confidence_count,
    SUM(CASE WHEN pml.resolution_scenario = 'LOW_CONFIDENCE'  THEN 1 ELSE 0 END) AS low_confidence_count,
    SUM(CASE WHEN pml.resolution_scenario = 'NO_MATCH'        THEN 1 ELSE 0 END) AS no_match_count,

    -- Fast-path signal (field_scores._fastpath set by FastPathChecker in Node.js)
    SUM(CASE WHEN pml.field_scores:_fastpath::BOOLEAN = TRUE THEN 1 ELSE 0 END) AS fastpath_hits,

    -- Confidence score distribution
    ROUND(AVG(CASE WHEN pml.error_code IS NULL THEN pml.confidence_score END), 4) AS avg_confidence_score,
    ROUND(MIN(CASE WHEN pml.error_code IS NULL THEN pml.confidence_score END), 4) AS min_confidence_score

FROM profile_match_log pml
JOIN resolution_profiles rp ON rp.profile_id = pml.profile_id
GROUP BY pml.profile_id, rp.profile_name, rp.entity_type, DATE_TRUNC('hour', pml.created_at)
ORDER BY hour_bucket DESC;


-- =============================================================================
-- 2. Cache effectiveness — Redis L1 / LRU L0 (via profile_match_log.was_cached)
--    profile_match_cache is deprecated in v2.1; this view derives cache stats
--    from the audit log rather than querying the removed cache table.
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_cache_stats AS
WITH hourly AS (
    SELECT
        pml.profile_id,
        DATE_TRUNC('hour', pml.created_at) AS hour_bucket,
        COUNT(*)                           AS total_requests,
        SUM(CASE WHEN pml.was_cached THEN 1 ELSE 0 END) AS cache_hits,
        SUM(CASE WHEN NOT pml.was_cached THEN 1 ELSE 0 END) AS cache_misses,
        ROUND(
            SUM(CASE WHEN pml.was_cached THEN 1 ELSE 0 END)::FLOAT
            / NULLIF(COUNT(*), 0) * 100, 2
        ) AS cache_hit_rate_pct,
        -- Cached latency vs. non-cached latency (shows cache value)
        ROUND(AVG(CASE WHEN     pml.was_cached THEN pml.execution_ms END), 2) AS avg_latency_cached_ms,
        ROUND(AVG(CASE WHEN NOT pml.was_cached THEN pml.execution_ms END), 2) AS avg_latency_uncached_ms
    FROM profile_match_log pml
    GROUP BY pml.profile_id, DATE_TRUNC('hour', pml.created_at)
)
SELECT
    h.profile_id,
    rp.profile_name,
    h.hour_bucket,
    h.total_requests,
    h.cache_hits,
    h.cache_misses,
    h.cache_hit_rate_pct,
    h.avg_latency_cached_ms,
    h.avg_latency_uncached_ms,
    -- Estimated latency savings (ms saved per hour by cache)
    ROUND(
        h.cache_hits * GREATEST(
            COALESCE(h.avg_latency_uncached_ms, 0) - COALESCE(h.avg_latency_cached_ms, 0),
            0
        ) / 1000.0,
    2) AS estimated_latency_saving_seconds
FROM hourly h
JOIN resolution_profiles rp ON rp.profile_id = h.profile_id
ORDER BY h.hour_bucket DESC;


-- =============================================================================
-- 3. Field effectiveness: which fields contribute most to successful matches
--    Filters: exclude NO_MATCH and error rows from contribution analysis.
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_field_effectiveness AS
WITH flattened_scores AS (
    SELECT
        pml.profile_id,
        pml.resolution_scenario,
        f.key   AS field_name,
        f.value::FLOAT AS field_score
    FROM profile_match_log pml,
    LATERAL FLATTEN(input => pml.field_scores, OUTER => TRUE) f
    WHERE pml.error_code         IS NULL
      AND pml.resolution_scenario != 'NO_MATCH'
      AND pml.field_scores        IS NOT NULL
      AND f.key != '_fastpath'    -- internal signal; not a real field score
)
SELECT
    fs.profile_id,
    rp.profile_name,
    fs.field_name,
    pf.match_strategy,
    pf.weight,
    COUNT(*)                                    AS match_count,
    ROUND(AVG(fs.field_score), 4)               AS avg_field_score,
    ROUND(MIN(fs.field_score), 4)               AS min_field_score,
    ROUND(MAX(fs.field_score), 4)               AS max_field_score,
    -- Weighted contribution = avg_score × weight (higher = more impactful)
    ROUND(AVG(fs.field_score) * pf.weight, 4)  AS weighted_contribution
FROM flattened_scores fs
JOIN resolution_profiles rp ON rp.profile_id = fs.profile_id
LEFT JOIN profile_fields pf
    ON  pf.profile_id = fs.profile_id
    AND pf.field_name = fs.field_name
GROUP BY fs.profile_id, rp.profile_name, fs.field_name, pf.match_strategy, pf.weight
ORDER BY weighted_contribution DESC;


-- =============================================================================
-- 4. Cost estimate per profile
--    Unchanged from v1 — embedding costs and warehouse compute are still valid.
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_cost_estimate AS
WITH daily_stats AS (
    SELECT
        pml.profile_id,
        DATE_TRUNC('day', pml.created_at) AS day_date,
        COUNT(*) AS total_queries,
        ROUND(SUM(pml.execution_ms) / 1000.0, 2) AS total_compute_seconds
    FROM profile_match_log pml
    GROUP BY pml.profile_id, DATE_TRUNC('day', pml.created_at)
),
embedding_costs AS (
    SELECT
        pee.profile_id,
        DATE_TRUNC('day', pee.created_at) AS day_date,
        COUNT(*) AS embeddings_generated,
        ROUND(COUNT(*) * 0.0001, 4) AS embedding_cost_usd
    FROM profile_entity_embeddings pee
    GROUP BY pee.profile_id, DATE_TRUNC('day', pee.created_at)
)
SELECT
    d.profile_id,
    rp.profile_name,
    d.day_date,
    d.total_queries,
    ROUND(CEIL(d.total_compute_seconds / 60.0) * (2.0 / 60.0), 4) AS warehouse_cost_usd,
    COALESCE(e.embedding_cost_usd, 0) AS embedding_cost_usd,
    ROUND(
        CEIL(d.total_compute_seconds / 60.0) * (2.0 / 60.0) + COALESCE(e.embedding_cost_usd, 0), 4
    ) AS total_cost_usd,
    CASE
        WHEN d.total_queries > 0 THEN ROUND(
            (CEIL(d.total_compute_seconds / 60.0) * (2.0 / 60.0) + COALESCE(e.embedding_cost_usd, 0))
            / d.total_queries, 6
        )
        ELSE 0
    END AS cost_per_query_usd
FROM daily_stats d
JOIN resolution_profiles rp ON rp.profile_id = d.profile_id
LEFT JOIN embedding_costs e ON d.profile_id = e.profile_id AND d.day_date = e.day_date
ORDER BY d.day_date DESC;


-- =============================================================================
-- 5. Profile summary (admin dashboard)
--    Adds: entity PENDING count, alias count, source_system breakdown.
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_profile_summary AS
SELECT
    rp.profile_id,
    rp.profile_name,
    rp.profile_slug,
    rp.entity_type,
    rp.source_system,
    rp.default_threshold,
    rp.is_active,
    (SELECT COUNT(*) FROM profile_fields pf
        WHERE pf.profile_id = rp.profile_id) AS field_count,
    (SELECT COUNT(*) FROM profile_entities pe
        WHERE pe.profile_id = rp.profile_id AND pe.is_active = TRUE) AS entity_count,
    (SELECT COUNT(*) FROM profile_entities pe
        WHERE pe.profile_id = rp.profile_id AND pe.embedding_status = 'PENDING') AS entities_pending_embedding,
    (SELECT COUNT(*) FROM profile_entity_embeddings pee
        WHERE pee.profile_id = rp.profile_id) AS embedding_count,
    (SELECT COUNT(*) FROM entity_alias ea
        WHERE ea.profile_id = rp.profile_id AND ea.is_active = TRUE) AS alias_count,
    (SELECT COUNT(*) FROM entity_alias ea
        WHERE ea.profile_id = rp.profile_id AND ea.embedding_status = 'PENDING') AS aliases_pending_embedding,
    (SELECT COUNT(*) FROM profile_match_log pml
        WHERE pml.profile_id = rp.profile_id AND pml.created_at >= CURRENT_DATE()) AS queries_today,
    (SELECT ROUND(AVG(pml.execution_ms), 2) FROM profile_match_log pml
        WHERE pml.profile_id = rp.profile_id AND pml.created_at >= CURRENT_DATE()) AS avg_latency_today_ms,
    rp.created_at
FROM resolution_profiles rp
ORDER BY rp.profile_name;


-- =============================================================================
-- 6. Alias health: track Manual Review alias creation and embedding pipeline
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_alias_health AS
SELECT
    ea.profile_id,
    rp.profile_name,
    DATE_TRUNC('day', ea.created_at)   AS day_created,
    COUNT(*)                           AS aliases_created,
    SUM(CASE WHEN ea.embedding_status = 'EMBEDDED' THEN 1 ELSE 0 END) AS embedded,
    SUM(CASE WHEN ea.embedding_status = 'PENDING'  THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN ea.is_active = FALSE THEN 1 ELSE 0 END)             AS deactivated,
    -- Distinct Salesforce IDs that gained aliases (breadth of alias coverage)
    COUNT(DISTINCT ea.salesforce_id)   AS unique_sf_records_with_alias,
    MIN(ea.created_at)                 AS earliest_alias,
    MAX(ea.created_at)                 AS latest_alias
FROM entity_alias ea
JOIN resolution_profiles rp ON rp.profile_id = ea.profile_id
GROUP BY ea.profile_id, rp.profile_name, DATE_TRUNC('day', ea.created_at)
ORDER BY day_created DESC;


-- =============================================================================
-- 7. Monitoring report procedure (v2.1)
--    Uses resolution_scenario and error_code; removes legacy match_type refs.
-- =============================================================================
CREATE OR REPLACE PROCEDURE generate_riq_monitoring_report(
    p_profile_id VARCHAR DEFAULT NULL  -- NULL = aggregate across all profiles
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_total_profiles      INTEGER;
    v_total_entities      INTEGER;
    v_total_embeddings    INTEGER;
    v_pending_embeddings  INTEGER;
    v_total_aliases       INTEGER;
    v_queries_today       INTEGER;
    v_cache_hit_rate      FLOAT;
    v_avg_latency         FLOAT;
    v_p95_latency         FLOAT;
    v_error_rate          FLOAT;
    v_exact_match_rate    FLOAT;
    v_no_match_rate       FLOAT;
BEGIN
    IF (:p_profile_id IS NULL) THEN
        SELECT COUNT(*) INTO :v_total_profiles FROM resolution_profiles WHERE is_active = TRUE;
        SELECT COUNT(*) INTO :v_total_entities FROM profile_entities WHERE is_active = TRUE;
        SELECT COUNT(*) INTO :v_total_embeddings FROM profile_entity_embeddings;
        SELECT COUNT(*) INTO :v_pending_embeddings FROM profile_entities WHERE embedding_status = 'PENDING';
        SELECT COUNT(*) INTO :v_total_aliases FROM entity_alias WHERE is_active = TRUE;

        SELECT
            COALESCE(COUNT(*), 0),
            COALESCE(ROUND(SUM(CASE WHEN was_cached     THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(AVG(execution_ms), 2), 0),
            COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_ms), 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN error_code IS NOT NULL              THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN resolution_scenario = 'EXACT_MATCH' THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN resolution_scenario = 'NO_MATCH'    THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0)
        INTO :v_queries_today, :v_cache_hit_rate, :v_avg_latency, :v_p95_latency,
             :v_error_rate, :v_exact_match_rate, :v_no_match_rate
        FROM profile_match_log
        WHERE created_at >= CURRENT_DATE();
    ELSE
        LET v_total_profiles := 1;
        SELECT COUNT(*) INTO :v_total_entities    FROM profile_entities WHERE profile_id = :p_profile_id AND is_active = TRUE;
        SELECT COUNT(*) INTO :v_total_embeddings  FROM profile_entity_embeddings WHERE profile_id = :p_profile_id;
        SELECT COUNT(*) INTO :v_pending_embeddings FROM profile_entities WHERE profile_id = :p_profile_id AND embedding_status = 'PENDING';
        SELECT COUNT(*) INTO :v_total_aliases     FROM entity_alias WHERE profile_id = :p_profile_id AND is_active = TRUE;

        SELECT
            COALESCE(COUNT(*), 0),
            COALESCE(ROUND(SUM(CASE WHEN was_cached     THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(AVG(execution_ms), 2), 0),
            COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_ms), 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN error_code IS NOT NULL              THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN resolution_scenario = 'EXACT_MATCH' THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN resolution_scenario = 'NO_MATCH'    THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0)
        INTO :v_queries_today, :v_cache_hit_rate, :v_avg_latency, :v_p95_latency,
             :v_error_rate, :v_exact_match_rate, :v_no_match_rate
        FROM profile_match_log
        WHERE profile_id = :p_profile_id AND created_at >= CURRENT_DATE();
    END IF;

    RETURN OBJECT_CONSTRUCT(
        'report_timestamp', CURRENT_TIMESTAMP()::VARCHAR,
        'scope', CASE WHEN :p_profile_id IS NULL THEN 'ALL_PROFILES' ELSE :p_profile_id END,
        'entity_stats', OBJECT_CONSTRUCT(
            'active_profiles',    v_total_profiles,
            'total_entities',     v_total_entities,
            'total_embeddings',   v_total_embeddings,
            'pending_embeddings', v_pending_embeddings,
            'total_aliases',      v_total_aliases
        ),
        'performance', OBJECT_CONSTRUCT(
            'queries_today',       v_queries_today,
            'cache_hit_rate_pct',  v_cache_hit_rate,
            'exact_match_rate_pct', v_exact_match_rate,
            'no_match_rate_pct',   v_no_match_rate,
            'avg_latency_ms',      v_avg_latency,
            'p95_latency_ms',      v_p95_latency,
            'error_rate_pct',      v_error_rate,
            'sla_target_ms',       1000
        ),
        'health', CASE
            WHEN v_error_rate   > 5    THEN 'DEGRADED'
            WHEN v_p95_latency  > 1000 THEN 'WARNING'
            ELSE                            'HEALTHY'
        END
    );
END;
$$;


-- =============================================================================
-- QUICK QUERIES
-- =============================================================================

-- Profile overview (includes pending embedding counts and alias counts)
SELECT * FROM v_riq_profile_summary;

-- Resolution scenario breakdown by hour
SELECT * FROM v_riq_performance_dashboard LIMIT 24;

-- Cache effectiveness (from audit log)
SELECT * FROM v_riq_cache_stats LIMIT 24;

-- Field effectiveness
SELECT * FROM v_riq_field_effectiveness;

-- Alias health
SELECT * FROM v_riq_alias_health LIMIT 30;

-- Cost tracking
SELECT * FROM v_riq_cost_estimate LIMIT 30;

-- Full monitoring report
CALL generate_riq_monitoring_report(NULL);

-- Single profile report
CALL generate_riq_monitoring_report('PROF-COMPANY-001');
