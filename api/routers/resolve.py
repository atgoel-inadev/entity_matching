"""
ResolveIQ — Resolution + Entity management endpoints.
"""

import json
import time
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from ..models import (
    ResolveRequest, ResolveResult, BatchResolveRequest, BatchResolveResult,
    BulkLoadRequest, BulkLoadResult, EntityResponse, EntityRecord,
)
from ..services.snowflake import get_snowpark_session
from ..services.cache import build_cache_key, get_cached, set_cached, clear_cache

logger = logging.getLogger("resolveiq.resolve")
router = APIRouter(prefix="/profiles", tags=["Resolution"])


def _get_profile_id(slug: str) -> str:
    """Look up profile_id by slug. Raises 404 if not found."""
    session = get_snowpark_session()
    rows = session.sql(
        "SELECT profile_id, default_threshold FROM resolution_profiles WHERE profile_slug = ? AND is_active = TRUE",
        params=[slug]
    ).collect()
    if not rows:
        raise HTTPException(404, f"Profile '{slug}' not found")
    return rows[0]["PROFILE_ID"], float(rows[0]["DEFAULT_THRESHOLD"])


def _resolve_single(profile_id: str, default_threshold: float, req: ResolveRequest) -> ResolveResult:
    """Core resolution logic for a single entity."""
    start = time.perf_counter()
    threshold = req.threshold if req.threshold is not None else default_threshold

    # 1. Check Redis cache
    cache_key = build_cache_key(profile_id, req.fields, threshold)
    cached = get_cached(cache_key)
    if cached:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return ResolveResult(**cached, was_cached=True, execution_ms=elapsed_ms)

    # 2. Call Snowflake procedure
    session = get_snowpark_session()
    fields_json = json.dumps(req.fields)
    meta_json = json.dumps(req.metadata) if req.metadata else "{}"

    result_df = session.sql(
        "CALL RESOLVE_AND_UPSERT(?, PARSE_JSON(?), PARSE_JSON(?), ?, ?)",
        params=[profile_id, fields_json, meta_json, threshold, req.create_if_missing]
    ).collect()

    result_raw = result_df[0][0]
    result_data = json.loads(result_raw) if isinstance(result_raw, str) else result_raw

    elapsed_ms = int((time.perf_counter() - start) * 1000)

    if result_data.get("error"):
        raise HTTPException(500, f"Snowflake error: {result_data.get('message', 'Unknown')}")

    # Parse field_scores from VARIANT
    field_scores = result_data.get("field_scores")
    if isinstance(field_scores, str):
        field_scores = json.loads(field_scores)
    
    # Handle non-numeric values in field_scores (e.g., fast-path markers)
    if field_scores and isinstance(field_scores, dict):
        field_scores = {k: v for k, v in field_scores.items() if isinstance(v, (int, float))}

    result = ResolveResult(
        entity_id=result_data.get("entity_id"),
        display_name=result_data.get("display_name"),
        match_score=result_data.get("match_score"),
        match_type=result_data.get("match_type"),
        field_scores=field_scores,
        is_new_entity=result_data.get("is_new_entity", False),
        was_cached=False,
        execution_ms=elapsed_ms,
    )

    # 3. Cache the result
    set_cached(cache_key, {
        "entity_id": result.entity_id,
        "display_name": result.display_name,
        "match_score": result.match_score,
        "match_type": result.match_type,
        "field_scores": result.field_scores,
        "is_new_entity": result.is_new_entity,
    })

    return result


# =============================================================================
# Resolution Endpoints
# =============================================================================

@router.post("/{slug}/resolve", response_model=ResolveResult, summary="Resolve single entity")
async def resolve_entity(slug: str, req: ResolveRequest):
    """
    Match input fields against entities in the profile.
    If no match is found and create_if_missing=true, a new entity is created.

    Example:
        POST /profiles/supplier-dedup/resolve
        {"fields": {"name": "Acme Corp", "tax_id": "12-3456789"}, "threshold": 0.7}
    """
    profile_id, default_threshold = _get_profile_id(slug)
    return _resolve_single(profile_id, default_threshold, req)


@router.post("/{slug}/find-similar", response_model=list[ResolveResult], summary="Find all similar entities")
async def find_similar_entities(
    slug: str,
    req: ResolveRequest,
    limit: int = Query(default=10, ge=1, le=100, description="Max number of matches to return")
):
    """
    Find all entities matching the input above the threshold, sorted by match score.
    Unlike /resolve which returns only the best match, this returns TOP N matches.
    
    Use cases:
    - View all similar entities before deciding which to merge
    - Search for potential duplicates across all entities
    - Browse entities matching certain criteria with scores
    
    Example:
        POST /profiles/customer/find-similar?limit=5
        {"fields": {"name": "Ishaan"}, "threshold": 0.5}
    """
    profile_id, default_threshold = _get_profile_id(slug)
    threshold = req.threshold if req.threshold is not None else default_threshold
    
    session = get_snowpark_session()
    fields_json = json.dumps(req.fields)
    
    # Call resolve_entity function but return TOP N instead of just 1
    rows = session.sql(
        "SELECT entity_id, display_name, match_score, match_type, field_scores "
        "FROM TABLE(resolve_entity(?, PARSE_JSON(?), ?)) "
        "ORDER BY match_score DESC "
        "LIMIT ?",
        params=[profile_id, fields_json, threshold, limit]
    ).collect()
    
    results = []
    for r in rows:
        field_scores = r["FIELD_SCORES"]
        if isinstance(field_scores, str):
            field_scores = json.loads(field_scores)
        if field_scores and isinstance(field_scores, dict):
            field_scores = {k: v for k, v in field_scores.items() if isinstance(v, (int, float))}
        
        results.append(ResolveResult(
            entity_id=r["ENTITY_ID"],
            display_name=r["DISPLAY_NAME"],
            match_score=float(r["MATCH_SCORE"]),
            match_type=r["MATCH_TYPE"],
            field_scores=field_scores,
            is_new_entity=False,
            was_cached=False,
            execution_ms=0,
        ))
    
    return results


@router.post("/{slug}/resolve/batch", response_model=BatchResolveResult, summary="Resolve batch")
async def resolve_batch(slug: str, req: BatchResolveRequest):
    """
    Resolve multiple entities in a single request (max 50).

    Example:
        POST /profiles/person-match/resolve/batch
        {"entities": [{"fields": {"first_name": "Jon", "last_name": "Smith"}}, ...]}
    """
    profile_id, default_threshold = _get_profile_id(slug)
    start = time.perf_counter()

    results = [_resolve_single(profile_id, default_threshold, entity) for entity in req.entities]

    total_ms = int((time.perf_counter() - start) * 1000)
    return BatchResolveResult(
        total_processed=len(results),
        results=results,
        total_execution_ms=total_ms,
    )


# =============================================================================
# Entity Management
# =============================================================================

@router.post("/{slug}/entities", response_model=BulkLoadResult, status_code=201, summary="Bulk load entities")
async def bulk_load(slug: str, req: BulkLoadRequest):
    """
    Load entities into a profile without matching (insert-only).
    Generates embeddings for SEMANTIC fields automatically.

    Example:
        POST /profiles/supplier-dedup/entities
        {"entities": [{"fields": {"name": "Acme", "city": "Chicago"}, "display_name": "Acme Corp"}]}
    """
    profile_id, _ = _get_profile_id(slug)
    session = get_snowpark_session()

    entities_json = json.dumps([e.model_dump() for e in req.entities])

    result_df = session.sql(
        "CALL BULK_LOAD_ENTITIES(?, PARSE_JSON(?))",
        params=[profile_id, entities_json]
    ).collect()

    result_raw = result_df[0][0]
    result_data = json.loads(result_raw) if isinstance(result_raw, str) else result_raw

    return BulkLoadResult(
        total_loaded=result_data.get("total_loaded", 0),
        embeddings_generated=result_data.get("embeddings_generated", 0),
        execution_ms=result_data.get("execution_ms", 0),
    )


@router.get("/{slug}/entities", response_model=list[EntityResponse], summary="List entities")
async def list_entities(
    slug: str,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    profile_id, _ = _get_profile_id(slug)
    session = get_snowpark_session()

    rows = session.sql("""
        SELECT entity_id, profile_id, display_name, field_values, metadata, is_active,
               created_at::VARCHAR AS created_at
        FROM profile_entities
        WHERE profile_id = ? AND is_active = TRUE
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    """, params=[profile_id, limit, offset]).collect()

    return [
        EntityResponse(
            entity_id=r["ENTITY_ID"],
            profile_id=r["PROFILE_ID"],
            display_name=r["DISPLAY_NAME"],
            field_values=json.loads(r["FIELD_VALUES"]) if isinstance(r["FIELD_VALUES"], str) else r["FIELD_VALUES"],
            metadata=json.loads(r["METADATA"]) if r["METADATA"] and isinstance(r["METADATA"], str) else r["METADATA"],
            is_active=bool(r["IS_ACTIVE"]),
            created_at=r["CREATED_AT"],
        )
        for r in rows
    ]


@router.delete("/{slug}/entities/{entity_id}", summary="Soft-delete entity")
async def delete_entity(slug: str, entity_id: str):
    profile_id, _ = _get_profile_id(slug)
    session = get_snowpark_session()

    session.sql(
        "UPDATE profile_entities SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP() WHERE entity_id = ? AND profile_id = ?",
        params=[entity_id, profile_id]
    ).collect()

    # Invalidate cache for this entity
    session.sql("CALL INVALIDATE_PROFILE_CACHE(?, ?)", params=[profile_id, entity_id]).collect()

    return {"message": f"Entity '{entity_id}' deactivated"}


@router.put("/{slug}/entities/{entity_id}", response_model=EntityResponse, summary="Update entity")
async def update_entity(slug: str, entity_id: str, data: EntityRecord):
    """
    Update an entity's field values. Regenerates embeddings for SEMANTIC/HYBRID fields.
    
    Example:
        PUT /profiles/company/entities/abc123
        {"field_values": {"name": "Updated Corp", "industry": "Tech"}, "display_name": "Updated Corp"}
    """
    profile_id, _ = _get_profile_id(slug)
    session = get_snowpark_session()
    
    # Update entity
    display_name = data.display_name or list(data.fields.values())[0] if data.fields else "Unknown"
    fields_json = json.dumps(data.fields)
    metadata_json = json.dumps(data.metadata) if data.metadata else None
    
    session.sql("""
        UPDATE profile_entities 
        SET field_values = PARSE_JSON(?),
            display_name = ?,
            metadata = PARSE_JSON(?),
            updated_at = CURRENT_TIMESTAMP()
        WHERE entity_id = ? AND profile_id = ?
    """, params=[fields_json, display_name, metadata_json, entity_id, profile_id]).collect()
    
    # Regenerate embeddings for SEMANTIC/HYBRID fields
    session.sql(
        "DELETE FROM profile_entity_embeddings WHERE entity_id = ?",
        params=[entity_id]
    ).collect()
    
    session.sql("""
        INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
        SELECT
            ?,
            ?,
            pf.field_name,
            PARSE_JSON(?)[pf.field_name]::VARCHAR,
            SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', PARSE_JSON(?)[pf.field_name]::VARCHAR)
        FROM profile_fields pf
        WHERE pf.profile_id = ?
          AND pf.match_strategy IN ('SEMANTIC', 'HYBRID')
          AND PARSE_JSON(?)[pf.field_name] IS NOT NULL
    """, params=[entity_id, profile_id, fields_json, fields_json, profile_id, fields_json]).collect()
    
    # Invalidate cache
    session.sql("CALL INVALIDATE_PROFILE_CACHE(?, ?)", params=[profile_id, entity_id]).collect()
    
    # Fetch and return updated entity
    rows = session.sql("""
        SELECT entity_id, profile_id, display_name, field_values, metadata, is_active, created_at::VARCHAR AS created_at
        FROM profile_entities
        WHERE entity_id = ? AND profile_id = ?
    """, params=[entity_id, profile_id]).collect()
    
    if not rows:
        raise HTTPException(404, "Entity not found")
    
    r = rows[0]
    return EntityResponse(
        entity_id=r["ENTITY_ID"],
        profile_id=r["PROFILE_ID"],
        display_name=r["DISPLAY_NAME"],
        field_values=json.loads(r["FIELD_VALUES"]) if isinstance(r["FIELD_VALUES"], str) else r["FIELD_VALUES"],
        metadata=json.loads(r["METADATA"]) if r["METADATA"] and isinstance(r["METADATA"], str) else r["METADATA"],
        is_active=bool(r["IS_ACTIVE"]),
        created_at=r["CREATED_AT"],
    )


# =============================================================================
# Per-profile stats
# =============================================================================

@router.get("/{slug}/stats", summary="Profile monitoring stats")
async def profile_stats(slug: str):
    profile_id, _ = _get_profile_id(slug)
    session = get_snowpark_session()

    result_df = session.sql(
        "CALL GENERATE_RIQ_MONITORING_REPORT(?)", params=[profile_id]
    ).collect()

    result = result_df[0][0]
    return json.loads(result) if isinstance(result, str) else result


# =============================================================================
# Profile-scoped cache invalidation
# =============================================================================

@router.delete("/{slug}/cache", summary="Invalidate profile cache")
async def invalidate_profile_cache(slug: str):
    profile_id, _ = _get_profile_id(slug)
    cleared = {"redis": False, "snowflake": False}

    # Redis
    deleted = clear_cache(f"riq:*")
    cleared["redis"] = deleted > 0 if deleted else False

    # Snowflake
    try:
        session = get_snowpark_session()
        session.sql("CALL INVALIDATE_PROFILE_CACHE(?)", params=[profile_id]).collect()
        cleared["snowflake"] = True
    except Exception as e:
        logger.warning(f"Snowflake cache clear error: {e}")

    return {"message": "Profile cache invalidated", "details": cleared}
