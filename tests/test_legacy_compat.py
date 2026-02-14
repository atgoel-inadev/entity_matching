"""
Tests for Legacy endpoint backward compatibility.
Ensures /match, /health, /stats, /cache still work after ResolveIQ refactor.
Run: pytest tests/test_legacy_compat.py -v
"""

import os
import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

os.environ.setdefault("SNOWFLAKE_ACCOUNT", "test")
os.environ.setdefault("SNOWFLAKE_USER", "test")
os.environ.setdefault("SNOWFLAKE_PASSWORD", "test")

mock_session = MagicMock()


@pytest.fixture(autouse=True)
def mock_deps():
    with patch("api.services.snowflake.get_snowpark_session", return_value=mock_session), \
         patch("api.services.snowflake.close_session"), \
         patch("api.services.cache.get_redis", return_value=None):
        yield
    mock_session.reset_mock()


from api.app import app
client = TestClient(app)


def _mock_legacy_result(**overrides):
    """Standard legacy match result."""
    result = {
        "entity_id": "abc-123",
        "display_name": "International Business Machines Corporation",
        "canonical_name": "International Business Machines Corporation",
        "matched_alias": "IBM",
        "match_score": 1.0,
        "match_type": "EXACT",
        "is_new_entity": False,
        "was_cached": False,
        "execution_ms": 45,
    }
    result.update(overrides)
    return result


class TestLegacyMatch:
    def test_match_existing(self):
        mock_session.sql.return_value.collect.side_effect = [
            [{"PROFILE_ID": "PROF-001"}],  # Profile lookup
            [[json.dumps(_mock_legacy_result())]],  # CALL result
        ]

        resp = client.post("/match", json={"name": "IBM", "threshold": 0.65})
        assert resp.status_code == 200
        data = resp.json()
        assert data["canonical_name"] == "International Business Machines Corporation"
        assert data["match_score"] == 1.0

    def test_match_fuzzy(self):
        mock_session.sql.return_value.collect.side_effect = [
            [{"PROFILE_ID": "PROF-001"}],
            [[json.dumps(_mock_legacy_result(
                display_name="Microsoft Corporation",
                match_score=0.89,
                match_type="FUZZY",
            ))]],
        ]

        resp = client.post("/match", json={"name": "Microsft", "threshold": 0.5})
        assert resp.status_code == 200
        assert resp.json()["match_type"] == "FUZZY"

    def test_match_creates_new(self):
        mock_session.sql.return_value.collect.side_effect = [
            [{"PROFILE_ID": "PROF-001"}],
            [[json.dumps(_mock_legacy_result(
                entity_id="new-999",
                display_name="Brand New Corp",
                match_score=1.0,
                match_type="NEW_ENTITY",
                is_new_entity=True,
            ))]],
        ]

        resp = client.post("/match", json={
            "name": "Brand New Corp",
            "threshold": 0.95,
            "metadata": {"industry": "Tech"},
        })
        assert resp.status_code == 200
        assert resp.json()["is_new_entity"] is True

    def test_match_empty_name_rejected(self):
        resp = client.post("/match", json={"name": ""})
        assert resp.status_code == 422

    def test_match_invalid_threshold(self):
        resp = client.post("/match", json={"name": "Test", "threshold": 1.5})
        assert resp.status_code == 422


class TestLegacyBatch:
    def test_batch_match(self):
        result = json.dumps(_mock_legacy_result())
        mock_session.sql.return_value.collect.side_effect = [
            [{"PROFILE_ID": "PROF-001"}], [[result]],
            [{"PROFILE_ID": "PROF-001"}], [[result]],
        ]

        resp = client.post("/match/batch", json={
            "entities": [
                {"name": "IBM"},
                {"name": "Microsoft"},
            ]
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_processed"] == 2

    def test_batch_empty_rejected(self):
        resp = client.post("/match/batch", json={"entities": []})
        assert resp.status_code == 422


class TestLegacyHealth:
    def test_health(self):
        mock_session.sql.return_value.collect.return_value = [{"1": 1}]

        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "components" in data
        assert data["components"]["snowflake"] == "connected"


class TestLegacyStats:
    def test_stats(self):
        mock_session.sql.return_value.collect.return_value = [
            [json.dumps({
                "report_timestamp": "2025-01-01",
                "entity_stats": {"total_entities": 200},
                "performance": {"avg_latency_ms": 45},
                "health": "HEALTHY",
            })]
        ]

        resp = client.get("/stats")
        assert resp.status_code == 200


class TestLegacyCache:
    def test_cache_invalidation(self):
        mock_session.sql.return_value.collect.return_value = None

        resp = client.delete("/cache")
        assert resp.status_code == 200
        assert "invalidated" in resp.json()["message"].lower()
