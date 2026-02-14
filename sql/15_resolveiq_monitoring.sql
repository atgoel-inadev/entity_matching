-- =============================================================================
-- RESOLVEIQ: Profile-Aware Monitoring & Observability
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- 1. Per-profile performance dashboard
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_performance_dashboard AS
SELECT
    pml.profile_id,
    rp.profile_name,
    rp.entity_type,
    DATE_TRUNC('hour', pml.created_at)          AS hour_bucket,
    COUNT(*)                                    AS total_requests,
    SUM(CASE WHEN pml.was_cached THEN 1 ELSE 0 END) AS cache_hits,
    ROUND(SUM(CASE WHEN pml.was_cached THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2) AS cache_hit_rate_pct,
    ROUND(AVG(pml.execution_ms), 2)             AS avg_latency_ms,
    ROUND(MEDIAN(pml.execution_ms), 2)          AS p50_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY pml.execution_ms), 2) AS p95_latency_ms,
    MAX(pml.execution_ms)                       AS max_latency_ms,
    SUM(CASE WHEN pml.match_type = 'ERROR' THEN 1 ELSE 0 END)        AS error_count,
    SUM(CASE WHEN pml.match_type = 'NEW_ENTITY' THEN 1 ELSE 0 END)   AS new_entities,
    SUM(CASE WHEN pml.match_type = 'EXACT_FASTPATH' THEN 1 ELSE 0 END) AS fastpath_hits,
    SUM(CASE WHEN pml.match_type LIKE 'EXACT%' THEN 1 ELSE 0 END)    AS exact_matches,
    SUM(CASE WHEN pml.match_type = 'SEMANTIC' THEN 1 ELSE 0 END)     AS semantic_matches,
    SUM(CASE WHEN pml.match_type = 'FUZZY' THEN 1 ELSE 0 END)        AS fuzzy_matches,
    SUM(CASE WHEN pml.match_type = 'COMPOSITE' THEN 1 ELSE 0 END)    AS composite_matches
FROM profile_match_log pml
JOIN resolution_profiles rp ON rp.profile_id = pml.profile_id
GROUP BY pml.profile_id, rp.profile_name, rp.entity_type, DATE_TRUNC('hour', pml.created_at)
ORDER BY hour_bucket DESC;

-- =============================================================================
-- 2. Cache effectiveness per profile
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_cache_stats AS
SELECT
    pmc.profile_id,
    rp.profile_name,
    COUNT(*)                                                                     AS total_entries,
    SUM(CASE WHEN pmc.expires_at > CURRENT_TIMESTAMP() THEN 1 ELSE 0 END)       AS active_entries,
    SUM(pmc.hit_count)                                                           AS total_hits,
    ROUND(AVG(pmc.hit_count), 2)                                                 AS avg_hits_per_entry,
    ROUND(AVG(pmc.match_score), 4)                                               AS avg_cached_score
FROM profile_match_cache pmc
JOIN resolution_profiles rp ON rp.profile_id = pmc.profile_id
GROUP BY pmc.profile_id, rp.profile_name;

-- =============================================================================
-- 3. Field effectiveness: which fields contribute most to successful matches
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_field_effectiveness AS
WITH flattened_scores AS (
    SELECT
        pml.profile_id,
        pml.match_type,
        f.key AS field_name,
        f.value::FLOAT AS field_score
    FROM profile_match_log pml,
    LATERAL FLATTEN(input => pml.field_scores, OUTER => TRUE) f
    WHERE pml.match_type NOT IN ('ERROR', 'NEW_ENTITY')
      AND pml.field_scores IS NOT NULL
      AND f.key != '_fastpath'
)
SELECT
    fs.profile_id,
    rp.profile_name,
    fs.field_name,
    pf.match_strategy,
    pf.weight,
    COUNT(*) AS match_count,
    ROUND(AVG(fs.field_score), 4) AS avg_field_score,
    ROUND(MIN(fs.field_score), 4) AS min_field_score,
    ROUND(MAX(fs.field_score), 4) AS max_field_score,
    -- Contribution = avg_score * weight (higher = more impactful)
    ROUND(AVG(fs.field_score) * pf.weight, 4) AS weighted_contribution
FROM flattened_scores fs
JOIN resolution_profiles rp ON rp.profile_id = fs.profile_id
LEFT JOIN profile_fields pf ON pf.profile_id = fs.profile_id AND pf.field_name = fs.field_name
GROUP BY fs.profile_id, rp.profile_name, fs.field_name, pf.match_strategy, pf.weight
ORDER BY weighted_contribution DESC;

-- =============================================================================
-- 4. Cost estimate per profile
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
            (CEIL(d.total_compute_seconds / 60.0) * (2.0 / 60.0) + COALESCE(e.embedding_cost_usd, 0)) / d.total_queries, 6
        )
        ELSE 0
    END AS cost_per_query_usd
FROM daily_stats d
JOIN resolution_profiles rp ON rp.profile_id = d.profile_id
LEFT JOIN embedding_costs e ON d.profile_id = e.profile_id AND d.day_date = e.day_date
ORDER BY d.day_date DESC;

-- =============================================================================
-- 5. Profile summary (admin dashboard)
-- =============================================================================
CREATE OR REPLACE VIEW v_riq_profile_summary AS
SELECT
    rp.profile_id,
    rp.profile_name,
    rp.profile_slug,
    rp.entity_type,
    rp.default_threshold,
    rp.is_active,
    (SELECT COUNT(*) FROM profile_fields pf WHERE pf.profile_id = rp.profile_id) AS field_count,
    (SELECT COUNT(*) FROM profile_entities pe WHERE pe.profile_id = rp.profile_id AND pe.is_active = TRUE) AS entity_count,
    (SELECT COUNT(*) FROM profile_entity_embeddings pee WHERE pee.profile_id = rp.profile_id) AS embedding_count,
    (SELECT COUNT(*) FROM profile_match_log pml WHERE pml.profile_id = rp.profile_id AND pml.created_at >= CURRENT_DATE()) AS queries_today,
    (SELECT ROUND(AVG(pml.execution_ms), 2) FROM profile_match_log pml WHERE pml.profile_id = rp.profile_id AND pml.created_at >= CURRENT_DATE()) AS avg_latency_today_ms,
    rp.created_at
FROM resolution_profiles rp
ORDER BY rp.profile_name;

-- =============================================================================
-- 6. Monitoring report procedure (profile-aware)
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
    v_total_profiles   INTEGER;
    v_total_entities   INTEGER;
    v_total_embeddings INTEGER;
    v_queries_today    INTEGER;
    v_cache_hit_rate   FLOAT;
    v_avg_latency      FLOAT;
    v_p95_latency      FLOAT;
    v_error_rate       FLOAT;
    v_fastpath_rate    FLOAT;
BEGIN
    IF (:p_profile_id IS NULL) THEN
        SELECT COUNT(*) INTO :v_total_profiles FROM resolution_profiles WHERE is_active = TRUE;
        SELECT COUNT(*) INTO :v_total_entities FROM profile_entities WHERE is_active = TRUE;
        SELECT COUNT(*) INTO :v_total_embeddings FROM profile_entity_embeddings;

        SELECT
            COALESCE(COUNT(*), 0),
            COALESCE(ROUND(SUM(CASE WHEN was_cached THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(AVG(execution_ms), 2), 0),
            COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_ms), 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN match_type = 'ERROR' THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN match_type = 'EXACT_FASTPATH' THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0)
        INTO :v_queries_today, :v_cache_hit_rate, :v_avg_latency, :v_p95_latency, :v_error_rate, :v_fastpath_rate
        FROM profile_match_log
        WHERE created_at >= CURRENT_DATE();
    ELSE
        LET v_total_profiles := 1;
        SELECT COUNT(*) INTO :v_total_entities FROM profile_entities WHERE profile_id = :p_profile_id AND is_active = TRUE;
        SELECT COUNT(*) INTO :v_total_embeddings FROM profile_entity_embeddings WHERE profile_id = :p_profile_id;

        SELECT
            COALESCE(COUNT(*), 0),
            COALESCE(ROUND(SUM(CASE WHEN was_cached THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(AVG(execution_ms), 2), 0),
            COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_ms), 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN match_type = 'ERROR' THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0),
            COALESCE(ROUND(SUM(CASE WHEN match_type = 'EXACT_FASTPATH' THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2), 0)
        INTO :v_queries_today, :v_cache_hit_rate, :v_avg_latency, :v_p95_latency, :v_error_rate, :v_fastpath_rate
        FROM profile_match_log
        WHERE profile_id = :p_profile_id AND created_at >= CURRENT_DATE();
    END IF;

    RETURN OBJECT_CONSTRUCT(
        'report_timestamp', CURRENT_TIMESTAMP()::VARCHAR,
        'scope', CASE WHEN :p_profile_id IS NULL THEN 'ALL_PROFILES' ELSE :p_profile_id END,
        'entity_stats', OBJECT_CONSTRUCT(
            'active_profiles', v_total_profiles,
            'total_entities', v_total_entities,
            'total_embeddings', v_total_embeddings
        ),
        'performance', OBJECT_CONSTRUCT(
            'queries_today', v_queries_today,
            'cache_hit_rate_pct', v_cache_hit_rate,
            'fastpath_rate_pct', v_fastpath_rate,
            'avg_latency_ms', v_avg_latency,
            'p95_latency_ms', v_p95_latency,
            'error_rate_pct', v_error_rate,
            'sla_target_ms', 1000
        ),
        'health', CASE
            WHEN v_error_rate > 5 THEN 'DEGRADED'
            WHEN v_p95_latency > 1000 THEN 'WARNING'
            ELSE 'HEALTHY'
        END
    );
END;
$$;


-- =============================================================================
-- QUICK QUERIES
-- =============================================================================

-- Profile overview
SELECT * FROM v_riq_profile_summary;

-- Performance by profile
SELECT * FROM v_riq_performance_dashboard LIMIT 24;

-- Field effectiveness
SELECT * FROM v_riq_field_effectiveness;

-- Cost tracking
SELECT * FROM v_riq_cost_estimate LIMIT 30;

-- Full report
CALL generate_riq_monitoring_report(NULL);

-- Single profile report
CALL generate_riq_monitoring_report('PROF-COMPANY-001');
