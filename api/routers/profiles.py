"""
ResolveIQ — Profile CRUD endpoints.
"""

import re
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from ..models import (
    ProfileCreate, ProfileUpdate, ProfileResponse,
    FieldConfig, FieldUpdate,
)
from ..services.snowflake import get_snowpark_session

logger = logging.getLogger("resolveiq.profiles")
router = APIRouter(prefix="/profiles", tags=["Profiles"])


def _slugify(name: str) -> str:
    """Convert profile name to URL-safe slug."""
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower().strip())
    return slug.strip('-')


# =============================================================================
# Profile CRUD
# =============================================================================

@router.get("", response_model=list[ProfileResponse], summary="List all profiles")
async def list_profiles(active_only: bool = True):
    session = get_snowpark_session()
    query = """
        SELECT rp.profile_id, rp.profile_name, rp.profile_slug, rp.entity_type,
               rp.description, rp.default_threshold, rp.is_active, rp.created_at::VARCHAR AS created_at,
               (SELECT COUNT(*) FROM profile_entities pe WHERE pe.profile_id = rp.profile_id AND pe.is_active = TRUE) AS entity_count
        FROM resolution_profiles rp
    """
    if active_only:
        query += " WHERE rp.is_active = TRUE"
    query += " ORDER BY rp.profile_name"

    rows = session.sql(query).collect()
    results = []
    for r in rows:
        # Fetch fields for each profile
        fields_rows = session.sql(
            "SELECT field_name, field_label, match_strategy, weight, is_required, is_primary_display, strategy_config "
            "FROM profile_fields WHERE profile_id = ? ORDER BY field_order",
            params=[r["PROFILE_ID"]]
        ).collect()

        fields = [
            FieldConfig(
                field_name=f["FIELD_NAME"],
                field_label=f["FIELD_LABEL"],
                match_strategy=f["MATCH_STRATEGY"],
                weight=float(f["WEIGHT"]),
                is_required=bool(f["IS_REQUIRED"]),
                is_primary_display=bool(f["IS_PRIMARY_DISPLAY"]),
                strategy_config=json.loads(f["STRATEGY_CONFIG"]) if f["STRATEGY_CONFIG"] else None,
            )
            for f in fields_rows
        ]

        results.append(ProfileResponse(
            profile_id=r["PROFILE_ID"],
            profile_name=r["PROFILE_NAME"],
            profile_slug=r["PROFILE_SLUG"],
            entity_type=r["ENTITY_TYPE"],
            description=r["DESCRIPTION"],
            default_threshold=float(r["DEFAULT_THRESHOLD"]),
            is_active=bool(r["IS_ACTIVE"]),
            fields=fields,
            entity_count=int(r["ENTITY_COUNT"]),
            created_at=r["CREATED_AT"],
        ))
    return results


@router.post("", response_model=ProfileResponse, status_code=201, summary="Create profile")
async def create_profile(req: ProfileCreate):
    session = get_snowpark_session()
    slug = _slugify(req.profile_name)

    # Check uniqueness
    existing = session.sql(
        "SELECT 1 FROM resolution_profiles WHERE profile_slug = ?", params=[slug]
    ).collect()
    if existing:
        raise HTTPException(409, f"Profile slug '{slug}' already exists")

    # Validate at least one required field
    if not any(f.is_required for f in req.fields):
        raise HTTPException(422, "At least one field must be marked as required")

    # Insert profile
    profile_id_row = session.sql(
        "SELECT UUID_STRING() AS id"
    ).collect()
    profile_id = profile_id_row[0]["ID"]

    session.sql("""
        INSERT INTO resolution_profiles (profile_id, profile_name, profile_slug, entity_type, description, default_threshold)
        VALUES (?, ?, ?, ?, ?, ?)
    """, params=[profile_id, req.profile_name, slug, req.entity_type, req.description, req.default_threshold]).collect()

    # Insert fields
    for i, f in enumerate(req.fields):
        # Convert strategy_config to JSON string, handling None
        config_json = json.dumps(f.strategy_config) if f.strategy_config else None
        
        if config_json is not None:
            session.sql("""
                INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?))
            """, params=[
                profile_id, f.field_name, f.field_label or f.field_name, i + 1,
                f.is_required, f.is_primary_display, f.match_strategy, f.weight,
                config_json,
            ]).collect()
        else:
            session.sql("""
                INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """, params=[
                profile_id, f.field_name, f.field_label or f.field_name, i + 1,
                f.is_required, f.is_primary_display, f.match_strategy, f.weight,
            ]).collect()

    return ProfileResponse(
        profile_id=profile_id,
        profile_name=req.profile_name,
        profile_slug=slug,
        entity_type=req.entity_type,
        description=req.description,
        default_threshold=req.default_threshold,
        is_active=True,
        fields=req.fields,
        entity_count=0,
    )


@router.get("/{slug}", response_model=ProfileResponse, summary="Get profile by slug")
async def get_profile(slug: str):
    session = get_snowpark_session()
    rows = session.sql("""
        SELECT rp.profile_id, rp.profile_name, rp.profile_slug, rp.entity_type,
               rp.description, rp.default_threshold, rp.is_active, rp.created_at::VARCHAR AS created_at,
               (SELECT COUNT(*) FROM profile_entities pe WHERE pe.profile_id = rp.profile_id AND pe.is_active = TRUE) AS entity_count
        FROM resolution_profiles rp
        WHERE rp.profile_slug = ?
    """, params=[slug]).collect()

    if not rows:
        raise HTTPException(404, f"Profile '{slug}' not found")

    r = rows[0]
    fields_rows = session.sql(
        "SELECT field_name, field_label, match_strategy, weight, is_required, is_primary_display, strategy_config "
        "FROM profile_fields WHERE profile_id = ? ORDER BY field_order",
        params=[r["PROFILE_ID"]]
    ).collect()

    fields = [
        FieldConfig(
            field_name=f["FIELD_NAME"],
            field_label=f["FIELD_LABEL"],
            match_strategy=f["MATCH_STRATEGY"],
            weight=float(f["WEIGHT"]),
            is_required=bool(f["IS_REQUIRED"]),
            is_primary_display=bool(f["IS_PRIMARY_DISPLAY"]),
            strategy_config=json.loads(f["STRATEGY_CONFIG"]) if f["STRATEGY_CONFIG"] else None,
        )
        for f in fields_rows
    ]

    return ProfileResponse(
        profile_id=r["PROFILE_ID"],
        profile_name=r["PROFILE_NAME"],
        profile_slug=r["PROFILE_SLUG"],
        entity_type=r["ENTITY_TYPE"],
        description=r["DESCRIPTION"],
        default_threshold=float(r["DEFAULT_THRESHOLD"]),
        is_active=bool(r["IS_ACTIVE"]),
        fields=fields,
        entity_count=int(r["ENTITY_COUNT"]),
        created_at=r["CREATED_AT"],
    )


@router.put("/{slug}", response_model=ProfileResponse, summary="Update profile")
async def update_profile(slug: str, req: ProfileUpdate):
    session = get_snowpark_session()

    # Build dynamic SET clause
    updates = []
    params = []
    if req.profile_name is not None:
        updates.append("profile_name = ?")
        params.append(req.profile_name)
    if req.description is not None:
        updates.append("description = ?")
        params.append(req.description)
    if req.default_threshold is not None:
        updates.append("default_threshold = ?")
        params.append(req.default_threshold)
    if req.is_active is not None:
        updates.append("is_active = ?")
        params.append(req.is_active)

    if not updates:
        raise HTTPException(422, "No fields to update")

    updates.append("updated_at = CURRENT_TIMESTAMP()")
    params.append(slug)

    session.sql(
        f"UPDATE resolution_profiles SET {', '.join(updates)} WHERE profile_slug = ?",
        params=params
    ).collect()

    return await get_profile(slug)


@router.delete("/{slug}", summary="Soft-delete profile")
async def delete_profile(slug: str):
    session = get_snowpark_session()
    result = session.sql(
        "UPDATE resolution_profiles SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP() WHERE profile_slug = ?",
        params=[slug]
    ).collect()
    return {"message": f"Profile '{slug}' deactivated"}


# =============================================================================
# Field Management
# =============================================================================

@router.post("/{slug}/fields", status_code=201, summary="Add field to profile")
async def add_field(slug: str, field: FieldConfig):
    session = get_snowpark_session()
    profile = await get_profile(slug)

    # Check field name uniqueness
    existing = session.sql(
        "SELECT 1 FROM profile_fields WHERE profile_id = ? AND field_name = ?",
        params=[profile.profile_id, field.field_name]
    ).collect()
    if existing:
        raise HTTPException(409, f"Field '{field.field_name}' already exists in this profile")

    max_order = session.sql(
        "SELECT COALESCE(MAX(field_order), 0) + 1 AS next_order FROM profile_fields WHERE profile_id = ?",
        params=[profile.profile_id]
    ).collect()[0]["NEXT_ORDER"]

    # Convert strategy_config to JSON string, handling None
    config_json = json.dumps(field.strategy_config) if field.strategy_config else None
    
    if config_json is not None:
        session.sql("""
            INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?))
        """, params=[
            profile.profile_id, field.field_name, field.field_label or field.field_name, max_order,
            field.is_required, field.is_primary_display, field.match_strategy, field.weight,
            config_json,
        ]).collect()
    else:
        session.sql("""
            INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        """, params=[
            profile.profile_id, field.field_name, field.field_label or field.field_name, max_order,
            field.is_required, field.is_primary_display, field.match_strategy, field.weight,
        ]).collect()

    return {"message": f"Field '{field.field_name}' added to profile '{slug}'"}


@router.put("/{slug}/fields/{field_name}", summary="Update field config")
async def update_field(slug: str, field_name: str, req: FieldUpdate):
    session = get_snowpark_session()
    profile = await get_profile(slug)

    updates = []
    params = []
    if req.field_label is not None:
        updates.append("field_label = ?")
        params.append(req.field_label)
    if req.match_strategy is not None:
        updates.append("match_strategy = ?")
        params.append(req.match_strategy)
    if req.weight is not None:
        updates.append("weight = ?")
        params.append(req.weight)
    if req.is_required is not None:
        updates.append("is_required = ?")
        params.append(req.is_required)

    if not updates:
        raise HTTPException(422, "No fields to update")

    params.extend([profile.profile_id, field_name])
    session.sql(
        f"UPDATE profile_fields SET {', '.join(updates)} WHERE profile_id = ? AND field_name = ?",
        params=params
    ).collect()

    return {"message": f"Field '{field_name}' updated in profile '{slug}'"}


@router.delete("/{slug}/fields/{field_name}", summary="Remove field from profile")
async def delete_field(slug: str, field_name: str):
    session = get_snowpark_session()
    profile = await get_profile(slug)

    session.sql(
        "DELETE FROM profile_fields WHERE profile_id = ? AND field_name = ?",
        params=[profile.profile_id, field_name]
    ).collect()

    return {"message": f"Field '{field_name}' removed from profile '{slug}'"}
