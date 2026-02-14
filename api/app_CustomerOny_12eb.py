"""
Entity Matching API - FastAPI + Snowpark + Redis
POST /match     - Single or batch entity matching
GET  /health    - Health check
GET  /stats     - Monitoring metrics
"""

import os
import json
import time
import hashlib
import logging
from typing import Optional
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

import setuptools
import redis
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from snowflake.snowpark import Session
from snowflake.snowpark.functions import call_udf, col, lit, sproc

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("entity_matching")

# ---------------------------------------------------------------------------
# Configuration (all from environment variables - NEVER hardcode credentials)
# ---------------------------------------------------------------------------
SNOWFLAKE_CONFIG = {
    "account":   os.environ["SNOWFLAKE_ACCOUNT"],
    "user":      os.environ["SNOWFLAKE_USER"],
    "password":  os.environ["SNOWFLAKE_PASSWORD"],
    "role":      os.environ.get("SNOWFLAKE_ROLE", "SNOWFLAKE_LEARNING_ROLE"),
    "warehouse": os.environ.get("SNOWFLAKE_WAREHOUSE", "SNOWFLAKE_LEARNING_WH"),
    "database":  os.environ.get("SNOWFLAKE_DATABASE", "SNOWFLAKE_LEARNING_DB"),
    "schema":    os.environ.get("SNOWFLAKE_SCHEMA", "ENTITY_MATCHING"),
}

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", "3600"))  # 1 hour
DEFAULT_THRESHOLD = float(os.environ.get("MATCH_THRESHOLD", "0.65"))

# ---------------------------------------------------------------------------
# Connection pool globals
# ---------------------------------------------------------------------------
_snowpark_session: Optional[Session] = None
_redis_client: Optional[redis.Redis] = None


def get_snowpark_session() -> Session:
    """Reuse a single Snowpark session (connection pooling built in)."""
    global _snowpark_session
    if _snowpark_session is None:
        logger.info("Creating Snowpark session...")
        _snowpark_session = Session.builder.configs(SNOWFLAKE_CONFIG).create()
        logger.info("Snowpark session created.")
    return _snowpark_session


def get_redis() -> Optional[redis.Redis]:
    """Get Redis client. Returns None if Redis is unavailable (graceful degradation)."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=2)
            _redis_client.ping()
            logger.info("Redis connected.")
        except Exception as e:
            logger.warning(f"Redis unavailable, running without cache layer: {e}")
            _redis_client = None
    return _redis_client


# ---------------------------------------------------------------------------
# Lifespan: setup / teardown
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: warm up connections
    get_snowpark_session()
    get_redis()
    yield
    # Shutdown: close session
    global _snowpark_session
    if _snowpark_session:
        _snowpark_session.close()
        _snowpark_session = None


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Entity Matching API",
    description="Hybrid fuzzy + semantic entity matching powered by Snowflake Cortex",
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------
class MatchRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=500, description="Entity name to match")
    threshold: float = Field(default=DEFAULT_THRESHOLD, ge=0.0, le=1.0)
    metadata: Optional[dict] = Field(default=None, description="Metadata for new entity creation")


class BatchMatchRequest(BaseModel):
    entities: list[MatchRequest] = Field(..., min_items=1, max_items=50)


class MatchResult(BaseModel):
    entity_id: Optional[str]
    canonical_name: Optional[str]
    matched_alias: Optional[str]
    match_score: Optional[float]
    match_type: Optional[str]
    is_new_entity: bool = False
    was_cached: bool = False
    execution_ms: int = 0


class BatchMatchResult(BaseModel):
    total_processed: int
    results: list[MatchResult]
    total_execution_ms: int


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------
def _cache_key(name: str, threshold: float) -> str:
    """Deterministic cache key matching Snowflake's cache_key logic."""
    normalized = name.strip().lower()
    raw = f"{normalized}|{threshold}"
    return f"em:{hashlib.sha256(raw.encode()).hexdigest()}"


def _get_cached(name: str, threshold: float) -> Optional[dict]:
    """Try to retrieve from Redis cache."""
    r = get_redis()
    if r is None:
        return None
    try:
        data = r.get(_cache_key(name, threshold))
        if data:
            return json.loads(data)
    except Exception as e:
        logger.warning(f"Redis read error: {e}")
    return None


def _set_cached(name: str, threshold: float, result: dict):
    """Store result in Redis with TTL."""
    r = get_redis()
    if r is None:
        return
    try:
        r.setex(
            _cache_key(name, threshold),
            CACHE_TTL_SECONDS,
            json.dumps(result),
        )
    except Exception as e:
        logger.warning(f"Redis write error: {e}")


# ---------------------------------------------------------------------------
# Core matching logic
# ---------------------------------------------------------------------------
def _match_entity(name: str, threshold: float, metadata: Optional[dict]) -> MatchResult:
    """Execute entity match via Snowflake stored procedure."""
    start = time.perf_counter()

    # 1. Check Redis cache
    cached = _get_cached(name, threshold)
    if cached:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return MatchResult(
            entity_id=cached.get("entity_id"),
            canonical_name=cached.get("canonical_name"),
            matched_alias=cached.get("matched_alias"),
            match_score=cached.get("match_score"),
            match_type=cached.get("match_type"),
            is_new_entity=False,
            was_cached=True,
            execution_ms=elapsed_ms,
        )

    # 2. Call Snowflake stored procedure
    session = get_snowpark_session()
    meta_json = json.dumps(metadata) if metadata else "{}"

    # Call procedure with proper type casting for VARIANT parameter
    result_df = session.sql(
        "CALL UPSERT_AND_MATCH(?, PARSE_JSON(?), ?)",
        params=[name, meta_json, threshold]
    ).collect()
    
    result_raw = result_df[0][0]

    # Parse VARIANT result from Snowflake
    if isinstance(result_raw, str):
        result_data = json.loads(result_raw)
    else:
        result_data = result_raw

    elapsed_ms = int((time.perf_counter() - start) * 1000)

    # Check for errors from the procedure
    if result_data.get("error"):
        raise HTTPException(
            status_code=500,
            detail=f"Snowflake error: {result_data.get('message', 'Unknown')}",
        )

    result = MatchResult(
        entity_id=result_data.get("entity_id"),
        canonical_name=result_data.get("canonical_name"),
        matched_alias=result_data.get("matched_alias"),
        match_score=result_data.get("match_score"),
        match_type=result_data.get("match_type"),
        is_new_entity=result_data.get("is_new_entity", False),
        was_cached=False,
        execution_ms=elapsed_ms,
    )

    # 3. Cache the result in Redis
    _set_cached(name, threshold, {
        "entity_id": result.entity_id,
        "canonical_name": result.canonical_name,
        "matched_alias": result.matched_alias,
        "match_score": result.match_score,
        "match_type": result.match_type,
    })

    return result


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.post("/match", response_model=MatchResult, summary="Match a single entity")
async def match_entity(req: MatchRequest):
    """
    Match an entity name against the knowledge base.
    If no match is found and metadata is provided, a new entity is created.

    Example:
        POST /match
        {"name": "Microsft", "threshold": 0.6}
    """
    return _match_entity(req.name, req.threshold, req.metadata)


@app.post("/match/batch", response_model=BatchMatchResult, summary="Match multiple entities")
async def match_entities_batch(req: BatchMatchRequest):
    """
    Match multiple entity names in a single request.
    Max 50 entities per batch to stay within latency targets.

    Example:
        POST /match/batch
        {"entities": [{"name": "IBM"}, {"name": "Gooogle", "threshold": 0.5}]}
    """
    start = time.perf_counter()
    results = []
    for entity in req.entities:
        result = _match_entity(entity.name, entity.threshold, entity.metadata)
        results.append(result)

    total_ms = int((time.perf_counter() - start) * 1000)
    return BatchMatchResult(
        total_processed=len(results),
        results=results,
        total_execution_ms=total_ms,
    )


@app.get("/health", summary="Health check")
async def health_check():
    """Check connectivity to Snowflake and Redis."""
    health = {"status": "healthy", "components": {}}

    # Snowflake check
    try:
        session = get_snowpark_session()
        session.sql("SELECT 1").collect()
        health["components"]["snowflake"] = "connected"
    except Exception as e:
        health["components"]["snowflake"] = f"error: {str(e)}"
        health["status"] = "degraded"

    # Redis check
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


@app.get("/stats", summary="Monitoring statistics")
async def get_stats():
    """Retrieve current monitoring metrics from Snowflake."""
    try:
        session = get_snowpark_session()
        result_df = session.sql("CALL GENERATE_MONITORING_REPORT()").collect()
        result = result_df[0][0]
        if isinstance(result, str):
            return json.loads(result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/cache", summary="Invalidate cache")
async def invalidate_cache(entity_id: Optional[str] = None):
    """Clear Redis and Snowflake caches. Optionally target a specific entity."""
    cleared = {"redis": False, "snowflake": False}

    # Clear Redis
    r = get_redis()
    if r:
        try:
            if entity_id:
                # Can't target specific entity in Redis without a reverse index,
                # so flush all entity matching keys
                keys = r.keys("em:*")
                if keys:
                    r.delete(*keys)
            else:
                keys = r.keys("em:*")
                if keys:
                    r.delete(*keys)
            cleared["redis"] = True
        except Exception as e:
            logger.warning(f"Redis cache clear error: {e}")

    # Clear Snowflake cache
    try:
        session = get_snowpark_session()
        if entity_id:
            session.sql("CALL INVALIDATE_CACHE(?)", params=[entity_id]).collect()
        else:
            session.sql("CALL INVALIDATE_CACHE(NULL)").collect()
        cleared["snowflake"] = True
    except Exception as e:
        logger.warning(f"Snowflake cache clear error: {e}")

    return {"message": "Cache invalidated", "details": cleared}


# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    logger.info(f"{request.method} {request.url.path} - {response.status_code} - {elapsed:.1f}ms")
    return response


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False, workers=1)
