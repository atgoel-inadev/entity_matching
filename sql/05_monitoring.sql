-- =============================================================================
-- SECTION F: MONITORING & OBSERVABILITY
-- Query performance metrics, cache hit rates, cost tracking
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- 1. VIEW: Real-time performance dashboard
-- =============================================================================
CREATE OR REPLACE VIEW v_performance_dashboard AS
SELECT
    DATE_TRUNC('hour', created_at)          AS hour_bucket,
    COUNT(*)                                AS total_requests,
    SUM(CASE WHEN was_cached THEN 1 ELSE 0 END) AS cache_hits,
    SUM(CASE WHEN NOT was_cached THEN 1 ELSE 0 END) AS cache_misses,
    ROUND(
        SUM(CASE WHEN was_cached THEN 1 ELSE 0 END)::FLOAT
        / NULLIF(COUNT(*), 0) * 100, 2
    )                                       AS cache_hit_rate_pct,
    ROUND(AVG(execution_ms), 2)             AS avg_latency_ms,
    ROUND(MEDIAN(execution_ms), 2)          AS p50_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_ms), 2) AS p95_latency_ms,
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY execution_ms), 2) AS p99_latency_ms,
    MAX(execution_ms)                       AS max_latency_ms,
    SUM(CASE WHEN match_type = 'ERROR' THEN 1 ELSE 0 END) AS error_count,
    SUM(CASE WHEN match_type = 'NEW_ENTITY' THEN 1 ELSE 0 END) AS new_entities_created,
    SUM(CASE WHEN match_type = 'EXACT' THEN 1 ELSE 0 END) AS exact_matches,
    SUM(CASE WHEN match_type LIKE 'FUZZY%' THEN 1 ELSE 0 END) AS fuzzy_matches,
    SUM(CASE WHEN match_type LIKE 'SEMANTIC%' THEN 1 ELSE 0 END) AS semantic_matches,
    SUM(CASE WHEN match_type LIKE 'HYBRID%' THEN 1 ELSE 0 END) AS hybrid_matches
FROM match_log
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour_bucket DESC;


-- =============================================================================
-- 2. VIEW: Cache effectiveness summary
-- =============================================================================
CREATE OR REPLACE VIEW v_cache_stats AS
SELECT
    COUNT(*)                                                AS total_cache_entries,
    SUM(CASE WHEN expires_at > CURRENT_TIMESTAMP() THEN 1 ELSE 0 END) AS active_entries,
    SUM(CASE WHEN expires_at <= CURRENT_TIMESTAMP() THEN 1 ELSE 0 END) AS expired_entries,
    SUM(hit_count)                                          AS total_cache_hits,
    ROUND(AVG(hit_count), 2)                                AS avg_hits_per_entry,
    MAX(hit_count)                                          AS max_hits_single_entry,
    ROUND(AVG(match_score), 4)                              AS avg_cached_match_score,
    MIN(created_at)                                         AS oldest_entry,
    MAX(created_at)                                         AS newest_entry
FROM match_cache;


-- =============================================================================
-- 3. VIEW: Match quality distribution
-- =============================================================================
CREATE OR REPLACE VIEW v_match_quality AS
SELECT
    match_type,
    COUNT(*)                        AS match_count,
    ROUND(AVG(match_score), 4)      AS avg_score,
    ROUND(MIN(match_score), 4)      AS min_score,
    ROUND(MAX(match_score), 4)      AS max_score,
    ROUND(STDDEV(match_score), 4)   AS stddev_score,
    ROUND(AVG(execution_ms), 2)     AS avg_latency_ms
FROM match_log
WHERE match_type != 'ERROR'
GROUP BY match_type
ORDER BY match_count DESC;


-- =============================================================================
-- 4. VIEW: Cost estimation per query
--    X-Small warehouse = 1 credit/hour = ~$2-3/hour
--    At <100 req/min, warehouse runs intermittently
-- =============================================================================
CREATE OR REPLACE VIEW v_cost_estimate AS
WITH daily_stats AS (
    SELECT
        DATE_TRUNC('day', created_at)   AS day_date,
        COUNT(*)                        AS total_queries,
        SUM(execution_ms)              AS total_execution_ms,
        -- X-Small = 1 credit/hour; credit cost ~$2-3 (standard edition)
        -- Approximate compute seconds used
        ROUND(SUM(execution_ms) / 1000.0, 2) AS total_compute_seconds
    FROM match_log
    GROUP BY DATE_TRUNC('day', created_at)
),
embedding_costs AS (
    SELECT
        DATE_TRUNC('day', created_at) AS day_date,
        COUNT(*) AS embeddings_generated,
        -- Cortex EMBED_TEXT_768: ~$0.0001 per call
        ROUND(COUNT(*) * 0.0001, 4) AS embedding_cost_usd
    FROM entity_embeddings
    GROUP BY DATE_TRUNC('day', created_at)
)
SELECT
    d.day_date,
    d.total_queries,
    d.total_compute_seconds,
    -- Warehouse cost: assume warehouse runs for at least 60s per resume
    -- Each resume = minimum 60s = 1/60 credit = ~$0.033
    -- Estimate resumes as: ceil(total_compute_seconds / 60)
    ROUND(CEIL(d.total_compute_seconds / 60.0) * (2.0 / 60.0), 4) AS warehouse_cost_usd,
    COALESCE(e.embeddings_generated, 0) AS embeddings_generated,
    COALESCE(e.embedding_cost_usd, 0) AS embedding_cost_usd,
    ROUND(
        CEIL(d.total_compute_seconds / 60.0) * (2.0 / 60.0) +
        COALESCE(e.embedding_cost_usd, 0),
        4
    ) AS total_estimated_cost_usd,
    CASE
        WHEN d.total_queries > 0 THEN
            ROUND(
                (CEIL(d.total_compute_seconds / 60.0) * (2.0 / 60.0) +
                 COALESCE(e.embedding_cost_usd, 0)) / d.total_queries,
                6
            )
        ELSE 0
    END AS cost_per_query_usd
FROM daily_stats d
LEFT JOIN embedding_costs e ON d.day_date = e.day_date
ORDER BY d.day_date DESC;


-- =============================================================================
-- 5. VIEW: Monthly cost projection
-- =============================================================================
CREATE OR REPLACE VIEW v_monthly_cost_projection AS
SELECT
    DATE_TRUNC('month', day_date)                           AS month,
    SUM(total_queries)                                      AS total_queries,
    SUM(total_estimated_cost_usd)                           AS actual_cost_to_date,
    -- Project cost for full month based on current rate
    ROUND(
        SUM(total_estimated_cost_usd) /
        NULLIF(DATEDIFF('day', DATE_TRUNC('month', CURRENT_DATE()), CURRENT_DATE()) + 1, 0)
        * DAY(LAST_DAY(CURRENT_DATE())),
        2
    )                                                       AS projected_monthly_cost_usd,
    CASE
        WHEN SUM(total_estimated_cost_usd) /
             NULLIF(DATEDIFF('day', DATE_TRUNC('month', CURRENT_DATE()), CURRENT_DATE()) + 1, 0)
             * DAY(LAST_DAY(CURRENT_DATE())) > 100
        THEN 'OVER_BUDGET'
        WHEN SUM(total_estimated_cost_usd) /
             NULLIF(DATEDIFF('day', DATE_TRUNC('month', CURRENT_DATE()), CURRENT_DATE()) + 1, 0)
             * DAY(LAST_DAY(CURRENT_DATE())) > 75
        THEN 'WARNING'
        ELSE 'ON_TRACK'
    END                                                     AS budget_status
FROM v_cost_estimate
GROUP BY DATE_TRUNC('month', day_date);


-- =============================================================================
-- 6. VIEW: Slow queries (above SLA threshold)
-- =============================================================================
CREATE OR REPLACE VIEW v_slow_queries AS
SELECT
    log_id,
    input_name,
    matched_entity_id,
    match_score,
    match_type,
    was_cached,
    execution_ms,
    created_at,
    CASE
        WHEN execution_ms > 500 THEN 'CRITICAL'
        WHEN execution_ms > 200 THEN 'WARNING'
        WHEN execution_ms > 100 THEN 'ABOVE_SLA'
        ELSE 'OK'
    END AS severity
FROM match_log
WHERE execution_ms > 100  -- SLA target: <100ms
ORDER BY execution_ms DESC;


-- =============================================================================
-- 7. VIEW: Entity growth tracking
-- =============================================================================
CREATE OR REPLACE VIEW v_entity_growth AS
SELECT
    DATE_TRUNC('day', created_at) AS day_date,
    COUNT(*) AS new_entities,
    SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('day', created_at)) AS cumulative_entities
FROM entities
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day_date DESC;


-- =============================================================================
-- 8. VIEW: Unmatched inputs (potential data quality issues)
-- =============================================================================
CREATE OR REPLACE VIEW v_unmatched_inputs AS
SELECT
    input_name,
    COUNT(*) AS attempt_count,
    MIN(created_at) AS first_seen,
    MAX(created_at) AS last_seen
FROM match_log
WHERE match_type = 'NEW_ENTITY'
GROUP BY input_name
ORDER BY attempt_count DESC;


-- =============================================================================
-- 9. STORED PROCEDURE: Generate monitoring report
-- =============================================================================
CREATE OR REPLACE PROCEDURE generate_monitoring_report()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    v_report VARIANT;
    v_total_entities INTEGER;
    v_total_aliases INTEGER;
    v_total_embeddings INTEGER;
    v_total_queries_today INTEGER;
    v_cache_hit_rate FLOAT;
    v_avg_latency FLOAT;
    v_p95_latency FLOAT;
    v_error_rate FLOAT;
    v_estimated_daily_cost FLOAT;
    v_projected_monthly FLOAT;
BEGIN
    -- Entity counts
    SELECT COUNT(*) INTO :v_total_entities FROM entities WHERE is_active = TRUE;
    SELECT COUNT(*) INTO :v_total_aliases FROM entity_aliases;
    SELECT COUNT(*) INTO :v_total_embeddings FROM entity_embeddings;

    -- Today's query stats
    SELECT
        COALESCE(COUNT(*), 0),
        COALESCE(
            ROUND(SUM(CASE WHEN was_cached THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2),
            0
        ),
        COALESCE(ROUND(AVG(execution_ms), 2), 0),
        COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_ms), 2), 0),
        COALESCE(
            ROUND(SUM(CASE WHEN match_type = 'ERROR' THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) * 100, 2),
            0
        )
    INTO :v_total_queries_today, :v_cache_hit_rate, :v_avg_latency, :v_p95_latency, :v_error_rate
    FROM match_log
    WHERE created_at >= CURRENT_DATE();

    -- Cost estimates
    SELECT
        COALESCE(SUM(total_estimated_cost_usd), 0),
        COALESCE(SUM(total_estimated_cost_usd) * 30, 0)
    INTO :v_estimated_daily_cost, :v_projected_monthly
    FROM v_cost_estimate
    WHERE day_date = CURRENT_DATE();

    v_report := OBJECT_CONSTRUCT(
        'report_timestamp',     CURRENT_TIMESTAMP()::VARCHAR,
        'entity_stats', OBJECT_CONSTRUCT(
            'total_entities',   v_total_entities,
            'total_aliases',    v_total_aliases,
            'total_embeddings', v_total_embeddings
        ),
        'performance', OBJECT_CONSTRUCT(
            'queries_today',    v_total_queries_today,
            'cache_hit_rate_pct', v_cache_hit_rate,
            'avg_latency_ms',   v_avg_latency,
            'p95_latency_ms',   v_p95_latency,
            'error_rate_pct',   v_error_rate,
            'sla_target_ms',    100
        ),
        'cost', OBJECT_CONSTRUCT(
            'estimated_today_usd',      v_estimated_daily_cost,
            'projected_monthly_usd',    v_projected_monthly,
            'budget_limit_usd',         100,
            'budget_remaining_usd',     100 - v_projected_monthly
        ),
        'health', CASE
            WHEN v_error_rate > 5 THEN 'DEGRADED'
            WHEN v_p95_latency > 200 THEN 'WARNING'
            WHEN v_projected_monthly > 100 THEN 'COST_ALERT'
            ELSE 'HEALTHY'
        END
    );

    RETURN v_report;
END;
$$;


-- =============================================================================
-- 10. ALERT TASK: Check health every hour and log warnings
-- =============================================================================
CREATE OR REPLACE TABLE monitoring_alerts (
    alert_id    VARCHAR(36) DEFAULT UUID_STRING(),
    alert_type  VARCHAR(50),   -- LATENCY, ERROR_RATE, COST, CACHE
    severity    VARCHAR(20),   -- INFO, WARNING, CRITICAL
    message     VARCHAR(1000),
    metric_value FLOAT,
    threshold    FLOAT,
    created_at  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE OR REPLACE TASK hourly_health_check
    WAREHOUSE = SNOWFLAKE_LEARNING_WH
    SCHEDULE = 'USING CRON 0 * * * * America/New_York'
AS
BEGIN
    -- Alert on high P95 latency
    INSERT INTO monitoring_alerts (alert_type, severity, message, metric_value, threshold)
    SELECT
        'LATENCY',
        CASE WHEN p95_latency_ms > 500 THEN 'CRITICAL' ELSE 'WARNING' END,
        'P95 latency ' || p95_latency_ms || 'ms exceeds threshold',
        p95_latency_ms,
        100
    FROM v_performance_dashboard
    WHERE hour_bucket >= DATEADD('hour', -1, CURRENT_TIMESTAMP())
      AND p95_latency_ms > 100;

    -- Alert on high error rate
    INSERT INTO monitoring_alerts (alert_type, severity, message, metric_value, threshold)
    SELECT
        'ERROR_RATE',
        CASE WHEN error_count::FLOAT / NULLIF(total_requests, 0) > 0.1 THEN 'CRITICAL' ELSE 'WARNING' END,
        error_count || ' errors out of ' || total_requests || ' requests in the last hour',
        error_count::FLOAT / NULLIF(total_requests, 0),
        0.05
    FROM v_performance_dashboard
    WHERE hour_bucket >= DATEADD('hour', -1, CURRENT_TIMESTAMP())
      AND error_count > 0;

    -- Alert on low cache hit rate
    INSERT INTO monitoring_alerts (alert_type, severity, message, metric_value, threshold)
    SELECT
        'CACHE',
        'INFO',
        'Cache hit rate ' || cache_hit_rate_pct || '% is below 50%',
        cache_hit_rate_pct,
        50
    FROM v_performance_dashboard
    WHERE hour_bucket >= DATEADD('hour', -1, CURRENT_TIMESTAMP())
      AND cache_hit_rate_pct < 50
      AND total_requests >= 10;
END;

ALTER TASK hourly_health_check RESUME;


-- =============================================================================
-- QUICK MONITORING QUERIES (run ad-hoc)
-- =============================================================================

-- Overall dashboard
SELECT * FROM v_performance_dashboard LIMIT 24;

-- Cache stats
SELECT * FROM v_cache_stats;

-- Match quality breakdown
SELECT * FROM v_match_quality;

-- Cost tracking
SELECT * FROM v_cost_estimate LIMIT 30;

-- Monthly projection
SELECT * FROM v_monthly_cost_projection;

-- Slow queries
SELECT * FROM v_slow_queries LIMIT 20;

-- Full health report
CALL generate_monitoring_report();

-- Recent alerts
SELECT * FROM monitoring_alerts ORDER BY created_at DESC LIMIT 20;
