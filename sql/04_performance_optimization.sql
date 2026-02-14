-- =============================================================================
-- SECTION E: PERFORMANCE OPTIMIZATION
-- Warehouse config, caching, clustering, materialized views
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- 1. WAREHOUSE CONFIGURATION (X-Small, auto-suspend for cost control)
-- =============================================================================
-- NOTE: These may require ACCOUNTADMIN or SYSADMIN role.
-- If SNOWFLAKE_LEARNING_ROLE lacks permissions, ask your admin to run these.

-- Auto-suspend after 60 seconds of inactivity (saves credits)
ALTER WAREHOUSE SNOWFLAKE_LEARNING_WH SET
    AUTO_SUSPEND = 60
    AUTO_RESUME = TRUE
    WAREHOUSE_SIZE = 'X-SMALL'
    MIN_CLUSTER_COUNT = 1
    MAX_CLUSTER_COUNT = 1
    STATEMENT_TIMEOUT_IN_SECONDS = 30;   -- Kill slow queries after 30s

-- Enable query result caching at warehouse level
ALTER WAREHOUSE SNOWFLAKE_LEARNING_WH SET
    ENABLE_QUERY_ACCELERATION = FALSE;   -- Not needed for X-Small workload


-- =============================================================================
-- 2. QUERY RESULT CACHE: Snowflake caches results for 24h automatically
--    if the underlying data hasn't changed. We leverage this by:
--    - Using deterministic queries
--    - Minimizing DML on lookup tables during read operations
-- =============================================================================

-- Enable result caching at session level (on by default, but be explicit)
ALTER SESSION SET USE_CACHED_RESULT = TRUE;


-- =============================================================================
-- 3. MATERIALIZED VIEW: Common/frequent matches
--    Pre-computes top matches for the most common entity lookups
-- =============================================================================

-- Track which names are queried most frequently
CREATE OR REPLACE TABLE frequent_queries AS
SELECT
    input_name,
    COUNT(*) AS query_count,
    MAX(created_at) AS last_queried
FROM match_log
WHERE match_type != 'ERROR'
GROUP BY input_name
HAVING COUNT(*) >= 3
ORDER BY query_count DESC
LIMIT 500;

-- Pre-compute matches for frequent queries (run on schedule)
-- Note: LATERAL with TABLE functions not supported in CTAS. 
-- Use a procedure or insert matches iteratively, or pre-join via a view.

CREATE OR REPLACE TABLE materialized_matches (
    input_name VARCHAR,
    query_count NUMBER,
    entity_id VARCHAR,
    canonical_name VARCHAR,
    matched_alias VARCHAR,
    hybrid_score FLOAT,
    match_type VARCHAR
);

-- Procedure to populate materialized_matches using JavaScript
CREATE OR REPLACE PROCEDURE populate_materialized_matches()
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
AS
$$
    snowflake.execute({sqlText: "TRUNCATE TABLE materialized_matches"});
    
    var stmt = snowflake.createStatement({sqlText: "SELECT input_name, query_count FROM frequent_queries"});
    var rs = stmt.execute();
    
    while (rs.next()) {
        var input_name = rs.getColumnValue(1);
        var query_count = rs.getColumnValue(2);
        
        var insertStmt = snowflake.createStatement({
            sqlText: `INSERT INTO materialized_matches (input_name, query_count, entity_id, canonical_name, matched_alias, hybrid_score, match_type)
                      SELECT ?, ?, entity_id, canonical_name, matched_alias, hybrid_score, match_type
                      FROM TABLE(hybrid_entity_match(?, 0.5::FLOAT))`,
            binds: [input_name, query_count, input_name]
        });
        insertStmt.execute();
    }
    
    return 'Materialized matches refreshed';
$$;

-- Run it once to populate
CALL populate_materialized_matches();


-- Procedure called by the task (must be created before task)
CREATE OR REPLACE PROCEDURE refresh_materialized_matches_proc()
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
AS
$$
    // Rebuild frequent queries
    snowflake.execute({sqlText: `
        CREATE OR REPLACE TABLE frequent_queries AS
        SELECT
            input_name,
            COUNT(*) AS query_count,
            MAX(created_at) AS last_queried
        FROM match_log
        WHERE match_type != 'ERROR'
          AND created_at >= DATEADD('day', -7, CURRENT_TIMESTAMP())
        GROUP BY input_name
        HAVING COUNT(*) >= 3
        ORDER BY query_count DESC
        LIMIT 500
    `});
    
    // Truncate and rebuild materialized matches
    snowflake.execute({sqlText: "TRUNCATE TABLE materialized_matches"});
    
    var stmt = snowflake.createStatement({sqlText: "SELECT input_name, query_count FROM frequent_queries"});
    var rs = stmt.execute();
    
    while (rs.next()) {
        var input_name = rs.getColumnValue(1);
        var query_count = rs.getColumnValue(2);
        
        var insertStmt = snowflake.createStatement({
            sqlText: `INSERT INTO materialized_matches (input_name, query_count, entity_id, canonical_name, matched_alias, hybrid_score, match_type)
                      SELECT ?, ?, entity_id, canonical_name, matched_alias, hybrid_score, match_type
                      FROM TABLE(hybrid_entity_match(?, 0.5::FLOAT))`,
            binds: [input_name, query_count, input_name]
        });
        insertStmt.execute();
    }
    
    return 'Materialized matches refreshed';
$$;

-- Task to refresh materialized matches every 4 hours
CREATE OR REPLACE TASK refresh_materialized_matches
    WAREHOUSE = SNOWFLAKE_LEARNING_WH
    SCHEDULE = 'USING CRON 0 */4 * * * America/New_York'
AS
CALL refresh_materialized_matches_proc();

-- Enable the task
ALTER TASK refresh_materialized_matches RESUME;


-- =============================================================================
-- 4. CACHE CLEANUP TASK: Purge expired cache entries daily
-- =============================================================================
CREATE OR REPLACE TASK cleanup_expired_cache
    WAREHOUSE = SNOWFLAKE_LEARNING_WH
    SCHEDULE = 'USING CRON 0 2 * * * America/New_York'  -- 2 AM daily
AS
    DELETE FROM match_cache WHERE expires_at <= CURRENT_TIMESTAMP();

ALTER TASK cleanup_expired_cache RESUME;


-- =============================================================================
-- 5. MATCH LOG RETENTION: Keep only 30 days of logs
-- =============================================================================
CREATE OR REPLACE TASK cleanup_old_logs
    WAREHOUSE = SNOWFLAKE_LEARNING_WH
    SCHEDULE = 'USING CRON 0 3 * * 0 America/New_York'  -- 3 AM Sundays
AS
    DELETE FROM match_log
    WHERE created_at < DATEADD('day', -30, CURRENT_TIMESTAMP());

ALTER TASK cleanup_old_logs RESUME;


-- =============================================================================
-- 6. OPTIMIZED MATCH FUNCTION: Check materialized table first
-- =============================================================================
CREATE OR REPLACE FUNCTION fast_entity_match(
    input_name VARCHAR,
    threshold  FLOAT DEFAULT 0.65
)
RETURNS TABLE (
    entity_id      VARCHAR,
    canonical_name VARCHAR,
    matched_alias  VARCHAR,
    match_score    FLOAT,
    match_type     VARCHAR
)
LANGUAGE SQL
AS
$$
    SELECT
        entity_id,
        canonical_name,
        matched_alias,
        hybrid_score AS match_score,
        match_type || '_CACHED' AS match_type
    FROM materialized_matches mm
    WHERE mm.input_name = input_name
      AND mm.hybrid_score >= threshold
    ORDER BY mm.hybrid_score DESC
    LIMIT 5
$$;


-- =============================================================================
-- 7. RESOURCE MONITOR: Alert if spending exceeds budget
-- =============================================================================
-- NOTE: Requires ACCOUNTADMIN role

-- CREATE OR REPLACE RESOURCE MONITOR entity_matching_monitor
--     WITH
--         CREDIT_QUOTA = 50  -- ~$100/month at $2/credit for X-Small
--         FREQUENCY = MONTHLY
--         START_TIMESTAMP = IMMEDIATELY
--         TRIGGERS
--             ON 75 PERCENT DO NOTIFY
--             ON 90 PERCENT DO NOTIFY
--             ON 100 PERCENT DO SUSPEND;
--
-- ALTER WAREHOUSE SNOWFLAKE_LEARNING_WH SET RESOURCE_MONITOR = entity_matching_monitor;


-- =============================================================================
-- VERIFICATION
-- =============================================================================
SHOW TASKS IN SCHEMA ENTITY_MATCHING;
SELECT * FROM materialized_matches LIMIT 5;








