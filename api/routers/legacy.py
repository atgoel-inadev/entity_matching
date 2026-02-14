"""
ResolveIQ — Legacy /match endpoints (backward compatible).
Internally adapts to the 'company' profile via resolve_entity.
"""

import json
import time
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from ..models import (
    MatchRequest, MatchResult, BatchMatchRequest, BatchMatchResult,
    ResolveRequest,
)
from ..services.snowflake import get_snowpark_session
from ..services.cache import get_redis

logger = logging.getLogger("resolveiq.legacy")
router = APIRouter(tags=["Legacy"])

# The legacy company profile slug
LEGACY_PROFILE_SLUG = "company"


def _get_legacy_profile_id() -> str:
    """Get the company profile_id for legacy adapter."""
    session = get_snowpark_session()
    rows = session.sql(
        "SELECT profile_id FROM resolution_profiles WHERE profile_slug = ? AND is_active = TRUE",
        params=[LEGACY_PROFILE_SLUG]
    ).collect()
    if rows:
        return rows[0]["PROFILE_ID"]
    # Fallback: try the original upsert_and_match if new profile doesn't exist
    return None


def _legacy_match(name: str, threshold: float, metadata: Optional[dict]) -> MatchResult:
    """Execute match via the new resolve engine, mapped to legacy response format."""
    start = time.perf_counter()
    session = get_snowpark_session()

    profile_id = _get_legacy_profile_id()

    if profile_id:
        # Route through new ResolveIQ engine
        fields_json = json.dumps({"name": name})
        meta_json = json.dumps(metadata) if metadata else "{}"

        result_df = session.sql(
            "CALL RESOLVE_AND_UPSERT(?, PARSE_JSON(?), PARSE_JSON(?), ?, TRUE)",
            params=[profile_id, fields_json, meta_json, threshold]
        ).collect()
    else:
        # Fallback to original procedure if company profile not migrated
        meta_json = json.dumps(metadata) if metadata else "{}"
        result_df = session.sql(
            "CALL UPSERT_AND_MATCH(?, PARSE_JSON(?), ?)",
            params=[name, meta_json, threshold]
        ).collect()

    result_raw = result_df[0][0]
    result_data = json.loads(result_raw) if isinstance(result_raw, str) else result_raw

    elapsed_ms = int((time.perf_counter() - start) * 1000)

    if result_data.get("error"):
        raise HTTPException(500, f"Snowflake error: {result_data.get('message', 'Unknown')}")

    return MatchResult(
        entity_id=result_data.get("entity_id"),
        canonical_name=result_data.get("display_name") or result_data.get("canonical_name"),
        matched_alias=result_data.get("matched_alias") or result_data.get("display_name"),
        match_score=result_data.get("match_score"),
        match_type=result_data.get("match_type"),
        is_new_entity=result_data.get("is_new_entity", False),
        was_cached=result_data.get("was_cached", False),
        execution_ms=elapsed_ms,
    )


# =============================================================================
# Legacy Endpoints
# =============================================================================

@router.post("/match", response_model=MatchResult, summary="Match entity (legacy)")
async def match_entity(req: MatchRequest):
    """
    Legacy endpoint — matches company names.
    Internally routes through the 'company' ResolveIQ profile.

    Example:
        POST /match
        {"name": "IBM", "threshold": 0.65}
    """
    return _legacy_match(req.name, req.threshold, req.metadata)


@router.post("/match/batch", response_model=BatchMatchResult, summary="Batch match (legacy)")
async def match_batch(req: BatchMatchRequest):
    """Legacy batch endpoint — matches multiple company names."""
    start = time.perf_counter()
    results = [_legacy_match(e.name, e.threshold, e.metadata) for e in req.entities]
    total_ms = int((time.perf_counter() - start) * 1000)
    return BatchMatchResult(total_processed=len(results), results=results, total_execution_ms=total_ms)


@router.get("/health", summary="Health check")
async def health_check():
    """Check Snowflake and Redis connectivity."""
    health = {"status": "healthy", "components": {}}

    try:
        session = get_snowpark_session()
        session.sql("SELECT 1").collect()
        health["components"]["snowflake"] = "connected"
    except Exception as e:
        health["components"]["snowflake"] = f"error: {str(e)}"
        health["status"] = "degraded"

    r = get_redis()
    if r:
        try:
            r.ping()
            health["components"]["redis"] = "connected"
        except Exception as e:
            health["components"]["redis"] = f"error: {str(e)}"
    else:
        health["components"]["redis"] = "unavailable (running without cache)"

    return health


@router.get("/stats", summary="Monitoring stats")
async def get_stats():
    """Aggregate monitoring report across all profiles."""
    try:
        session = get_snowpark_session()
        result_df = session.sql("CALL GENERATE_RIQ_MONITORING_REPORT(NULL)").collect()
        result = result_df[0][0]
        return json.loads(result) if isinstance(result, str) else result
    except Exception as e:
        # Fallback to legacy monitoring
        try:
            result_df = session.sql("CALL GENERATE_MONITORING_REPORT()").collect()
            result = result_df[0][0]
            return json.loads(result) if isinstance(result, str) else result
        except Exception:
            raise HTTPException(500, str(e))


@router.delete("/cache", summary="Invalidate all caches")
async def invalidate_all_cache(entity_id: Optional[str] = None):
    """Clear Redis and Snowflake caches."""
    from api.services.cache import clear_cache
    cleared = {"redis": False, "snowflake": False}

    deleted = clear_cache("riq:*")
    # Also clear legacy keys
    clear_cache("em:*")
    cleared["redis"] = True

    try:
        session = get_snowpark_session()
        session.sql("DELETE FROM profile_match_cache WHERE expires_at <= CURRENT_TIMESTAMP()").collect()
        if entity_id:
            session.sql("CALL INVALIDATE_CACHE(?)", params=[entity_id]).collect()
        else:
            session.sql("CALL INVALIDATE_CACHE(NULL)").collect()
        cleared["snowflake"] = True
    except Exception as e:
        logger.warning(f"Snowflake cache clear error: {e}")

    return {"message": "Cache invalidated", "details": cleared}
