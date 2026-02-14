"""
Tests for Entity Matching API.
Run: pytest tests/test_api.py -v
"""

import os
import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Set env vars before importing app
os.environ.setdefault("SNOWFLAKE_ACCOUNT", "test_account")
os.environ.setdefault("SNOWFLAKE_USER", "test_user")
os.environ.setdefault("SNOWFLAKE_PASSWORD", "test_password")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

# Mock Snowpark session before import
mock_session = MagicMock()


@pytest.fixture(autouse=True)
def mock_connections():
    """Mock Snowflake and Redis connections for all tests."""
    with patch("api.app.get_snowpark_session", return_value=mock_session), \
         patch("api.app.get_redis", return_value=None):
        yield


# Import after mocking
from api.app import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------
class TestHealthCheck:
    def test_health_endpoint(self):
        mock_session.sql.return_value.collect.return_value = [{"1": 1}]
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("healthy", "degraded")
        assert "components" in data


# ---------------------------------------------------------------------------
# Single Match
# ---------------------------------------------------------------------------
class TestSingleMatch:
    def test_match_existing_entity(self):
        mock_session.call.return_value = json.dumps({
            "entity_id": "abc-123",
            "canonical_name": "International Business Machines Corporation",
            "matched_alias": "IBM",
            "match_score": 1.0,
            "match_type": "EXACT",
            "is_new_entity": False,
            "was_cached": False,
            "execution_ms": 45,
        })

        resp = client.post("/match", json={"name": "IBM", "threshold": 0.65})
        assert resp.status_code == 200
        data = resp.json()
        assert data["canonical_name"] == "International Business Machines Corporation"
        assert data["match_score"] == 1.0
        assert data["match_type"] == "EXACT"

    def test_match_fuzzy(self):
        mock_session.call.return_value = json.dumps({
            "entity_id": "def-456",
            "canonical_name": "Microsoft Corporation",
            "matched_alias": "Microsoft",
            "match_score": 0.89,
            "match_type": "FUZZY",
            "is_new_entity": False,
            "was_cached": False,
            "execution_ms": 78,
        })

        resp = client.post("/match", json={"name": "Microsft", "threshold": 0.5})
        assert resp.status_code == 200
        data = resp.json()
        assert data["match_type"] == "FUZZY"
        assert data["match_score"] > 0.5

    def test_match_creates_new_entity(self):
        mock_session.call.return_value = json.dumps({
            "entity_id": "new-789",
            "canonical_name": "Brand New Corp",
            "matched_alias": "Brand New Corp",
            "match_score": 1.0,
            "match_type": "NEW_ENTITY",
            "is_new_entity": True,
            "was_cached": False,
            "execution_ms": 120,
        })

        resp = client.post("/match", json={
            "name": "Brand New Corp",
            "threshold": 0.9,
            "metadata": {"industry": "Tech", "country": "USA"},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_new_entity"] is True
        assert data["match_type"] == "NEW_ENTITY"

    def test_match_empty_name_rejected(self):
        resp = client.post("/match", json={"name": "", "threshold": 0.5})
        assert resp.status_code == 422  # Validation error

    def test_match_invalid_threshold(self):
        resp = client.post("/match", json={"name": "Test", "threshold": 1.5})
        assert resp.status_code == 422

    def test_match_snowflake_error(self):
        mock_session.call.return_value = json.dumps({
            "error": True,
            "message": "Something went wrong",
            "sqlcode": "99999",
        })

        resp = client.post("/match", json={"name": "ErrorCase"})
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# Batch Match
# ---------------------------------------------------------------------------
class TestBatchMatch:
    def test_batch_match(self):
        mock_session.call.return_value = json.dumps({
            "entity_id": "abc-123",
            "canonical_name": "Test Corp",
            "matched_alias": "Test",
            "match_score": 0.95,
            "match_type": "HYBRID",
            "is_new_entity": False,
            "was_cached": False,
            "execution_ms": 50,
        })

        resp = client.post("/match/batch", json={
            "entities": [
                {"name": "IBM"},
                {"name": "Microsoft"},
                {"name": "Google", "threshold": 0.7},
            ]
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_processed"] == 3
        assert len(data["results"]) == 3

    def test_batch_empty_rejected(self):
        resp = client.post("/match/batch", json={"entities": []})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
class TestCache:
    def test_cache_invalidation(self):
        resp = client.delete("/cache")
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
class TestStats:
    def test_stats_endpoint(self):
        mock_session.call.return_value = json.dumps({
            "report_timestamp": "2025-01-01T00:00:00",
            "entity_stats": {"total_entities": 200},
            "performance": {"avg_latency_ms": 45},
            "cost": {"projected_monthly_usd": 25},
            "health": "HEALTHY",
        })

        resp = client.get("/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["health"] == "HEALTHY"


# ---------------------------------------------------------------------------
# Integration test helpers (run against real Snowflake)
# ---------------------------------------------------------------------------
class TestIntegration:
    """
    These tests require a real Snowflake connection.
    Run with: pytest tests/test_api.py -v -k integration --no-header

    Set environment variables:
        SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PASSWORD
        RUN_INTEGRATION=1
    """

    @pytest.mark.skipif(
        os.environ.get("RUN_INTEGRATION") != "1",
        reason="Set RUN_INTEGRATION=1 to run integration tests",
    )
    def test_end_to_end_match(self):
        """Full round-trip: API -> Snowflake -> match -> response."""
        # Uses the real app without mocks
        resp = client.post("/match", json={"name": "IBM", "threshold": 0.5})
        assert resp.status_code == 200
        data = resp.json()
        assert data["entity_id"] is not None
        assert data["match_score"] > 0.5
