"""
Redis cache layer — optional, degrades gracefully if unavailable.
"""

import os
import json
import hashlib
import logging
from typing import Optional

import redis

logger = logging.getLogger("resolveiq.cache")

_client: Optional[redis.Redis] = None
CACHE_TTL = int(os.environ.get("CACHE_TTL_SECONDS", "3600"))


def get_redis() -> Optional[redis.Redis]:
    """Get Redis client. Returns None if unavailable."""
    global _client
    if _client is None:
        try:
            url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
            _client = redis.from_url(url, decode_responses=True, socket_timeout=2)
            _client.ping()
            logger.info("Redis connected.")
        except Exception as e:
            logger.warning(f"Redis unavailable, running without cache: {e}")
            _client = None
    return _client


def build_cache_key(profile_id: str, fields: dict, threshold: float) -> str:
    """Deterministic cache key for a resolve request."""
    # Sort fields for consistency regardless of input order
    sorted_fields = json.dumps(fields, sort_keys=True)
    raw = f"{profile_id}|{sorted_fields}|{threshold}"
    return f"riq:{hashlib.sha256(raw.encode()).hexdigest()}"


def get_cached(cache_key: str) -> Optional[dict]:
    """Retrieve from Redis. Returns None on miss or error."""
    r = get_redis()
    if r is None:
        return None
    try:
        data = r.get(cache_key)
        return json.loads(data) if data else None
    except Exception as e:
        logger.warning(f"Redis read error: {e}")
        return None


def set_cached(cache_key: str, result: dict):
    """Store in Redis with TTL."""
    r = get_redis()
    if r is None:
        return
    try:
        r.setex(cache_key, CACHE_TTL, json.dumps(result))
    except Exception as e:
        logger.warning(f"Redis write error: {e}")


def clear_cache(prefix: str = "riq:*"):
    """Delete all keys matching the prefix."""
    r = get_redis()
    if r is None:
        return 0
    try:
        keys = r.keys(prefix)
        if keys:
            return r.delete(*keys)
        return 0
    except Exception as e:
        logger.warning(f"Redis clear error: {e}")
        return 0
