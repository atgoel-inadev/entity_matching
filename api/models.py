"""
ResolveIQ - Pydantic models for all API endpoints.
"""

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# =============================================================================
# Profile Models
# =============================================================================

class FieldConfig(BaseModel):
    field_name: str = Field(..., min_length=1, max_length=100, pattern=r'^[a-z_][a-z0-9_]*$')
    field_label: Optional[str] = None
    match_strategy: Literal['EXACT', 'FUZZY', 'SEMANTIC', 'PHONETIC', 'NUMERIC', 'HYBRID', 'NONE']
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    is_required: bool = False
    is_primary_display: bool = False
    strategy_config: Optional[dict] = None


class FieldUpdate(BaseModel):
    field_label: Optional[str] = None
    match_strategy: Optional[Literal['EXACT', 'FUZZY', 'SEMANTIC', 'PHONETIC', 'NUMERIC', 'HYBRID', 'NONE']] = None
    weight: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    is_required: Optional[bool] = None


class ProfileCreate(BaseModel):
    profile_name: str = Field(..., min_length=1, max_length=100)
    entity_type: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = None
    default_threshold: float = Field(default=0.65, ge=0.0, le=1.0)
    fields: list[FieldConfig] = Field(..., min_length=1, max_length=20)


class ProfileUpdate(BaseModel):
    profile_name: Optional[str] = None
    description: Optional[str] = None
    default_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    is_active: Optional[bool] = None


class ProfileResponse(BaseModel):
    profile_id: str
    profile_name: str
    profile_slug: str
    entity_type: str
    description: Optional[str] = None
    default_threshold: float
    is_active: bool
    fields: list[FieldConfig] = []
    entity_count: Optional[int] = None
    created_at: Optional[str] = None


# =============================================================================
# Resolve Models
# =============================================================================

class ResolveRequest(BaseModel):
    fields: dict[str, Any] = Field(..., min_length=1)
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    metadata: Optional[dict] = None
    create_if_missing: bool = Field(default=False)


class ResolveResult(BaseModel):
    entity_id: Optional[str] = None
    display_name: Optional[str] = None
    match_score: Optional[float] = None
    match_type: Optional[str] = None
    field_scores: Optional[dict[str, float]] = None
    is_new_entity: bool = False
    was_cached: bool = False
    execution_ms: int = 0


class BatchResolveRequest(BaseModel):
    entities: list[ResolveRequest] = Field(..., min_length=1, max_length=50)


class BatchResolveResult(BaseModel):
    total_processed: int
    results: list[ResolveResult]
    total_execution_ms: int


# =============================================================================
# Entity Models
# =============================================================================

class EntityRecord(BaseModel):
    fields: dict[str, Any] = Field(..., min_length=1)
    display_name: Optional[str] = None
    metadata: Optional[dict] = None


class BulkLoadRequest(BaseModel):
    entities: list[EntityRecord] = Field(..., min_length=1, max_length=1000)


class BulkLoadResult(BaseModel):
    total_loaded: int
    embeddings_generated: int
    execution_ms: int


class EntityResponse(BaseModel):
    entity_id: str
    profile_id: str
    display_name: str
    field_values: dict[str, Any]
    metadata: Optional[dict] = None
    is_active: bool = True
    created_at: Optional[str] = None


# =============================================================================
# Legacy Models (backward compatible with /match endpoint)
# =============================================================================

class MatchRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=500)
    threshold: float = Field(default=0.65, ge=0.0, le=1.0)
    metadata: Optional[dict] = None


class BatchMatchRequest(BaseModel):
    entities: list[MatchRequest] = Field(..., min_length=1, max_length=50)


class MatchResult(BaseModel):
    entity_id: Optional[str] = None
    canonical_name: Optional[str] = None
    matched_alias: Optional[str] = None
    match_score: Optional[float] = None
    match_type: Optional[str] = None
    is_new_entity: bool = False
    was_cached: bool = False
    execution_ms: int = 0


class BatchMatchResult(BaseModel):
    total_processed: int
    results: list[MatchResult]
    total_execution_ms: int
