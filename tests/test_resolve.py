"""
Tests for Resolution and Entity Management endpoints.
Run: pytest tests/test_resolve.py -v
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


def _mock_profile_lookup():
    """Standard mock: profile exists with threshold 0.65."""
    return [{"PROFILE_ID": "PROF-001", "DEFAULT_THRESHOLD": 0.65}]


class TestResolveSingle:
    def test_resolve_exact_match(self):
        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),  # Profile lookup
            [  # CALL resolve_and_upsert result
                [json.dumps({
                    "entity_id": "ent-123",
                    "display_name": "ACME Corporation",
                    "match_score": 0.95,
                    "match_type": "EXACT",
                    "field_scores": {"name": 0.95, "tax_id": 1.0},
                    "is_new_entity": False,
                    "was_cached": False,
                    "execution_ms": 45,
                })]
            ],
        ]

        resp = client.post("/profiles/supplier-dedup/resolve", json={
            "fields": {"name": "ACME Corp", "tax_id": "36-1234567"},
            "threshold": 0.7,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["display_name"] == "ACME Corporation"
        assert data["match_score"] == 0.95
        assert "tax_id" in data["field_scores"]

    def test_resolve_creates_new_entity(self):
        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),
            [[json.dumps({
                "entity_id": "new-789",
                "display_name": "Brand New Supplier",
                "match_score": 1.0,
                "match_type": "NEW_ENTITY",
                "field_scores": {},
                "is_new_entity": True,
                "was_cached": False,
                "execution_ms": 120,
            })]],
        ]

        resp = client.post("/profiles/supplier-dedup/resolve", json={
            "fields": {"name": "Brand New Supplier", "city": "Seattle"},
            "threshold": 0.95,
            "create_if_missing": True,
            "metadata": {"source": "manual"},
        })
        assert resp.status_code == 200
        assert resp.json()["is_new_entity"] is True

    def test_resolve_profile_not_found(self):
        mock_session.sql.return_value.collect.return_value = []

        resp = client.post("/profiles/nonexistent/resolve", json={
            "fields": {"name": "Test"},
        })
        assert resp.status_code == 404

    def test_resolve_empty_fields_rejected(self):
        resp = client.post("/profiles/company/resolve", json={
            "fields": {},
        })
        assert resp.status_code == 422

    def test_resolve_snowflake_error(self):
        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),
            [[json.dumps({
                "error": True,
                "message": "Something failed",
                "sqlcode": "99999",
            })]],
        ]

        resp = client.post("/profiles/company/resolve", json={
            "fields": {"name": "Error Case"},
        })
        assert resp.status_code == 500


class TestResolveBatch:
    def test_batch_resolve(self):
        resolve_result = json.dumps({
            "entity_id": "ent-1",
            "display_name": "Test Corp",
            "match_score": 0.9,
            "match_type": "COMPOSITE",
            "field_scores": {"name": 0.9},
            "is_new_entity": False,
            "was_cached": False,
            "execution_ms": 50,
        })

        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),
            [[resolve_result]],
            _mock_profile_lookup(),
            [[resolve_result]],
            _mock_profile_lookup(),
            [[resolve_result]],
        ]

        resp = client.post("/profiles/person-match/resolve/batch", json={
            "entities": [
                {"fields": {"first_name": "John", "last_name": "Smith"}},
                {"fields": {"first_name": "Jane", "last_name": "Doe"}},
                {"fields": {"first_name": "Bob", "last_name": "Jones"}},
            ]
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_processed"] == 3
        assert len(data["results"]) == 3

    def test_batch_empty_rejected(self):
        resp = client.post("/profiles/company/resolve/batch", json={
            "entities": [],
        })
        assert resp.status_code == 422


class TestBulkLoad:
    def test_bulk_load_entities(self):
        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),
            [[json.dumps({
                "total_loaded": 2,
                "embeddings_generated": 2,
                "execution_ms": 300,
            })]],
        ]

        resp = client.post("/profiles/supplier-dedup/entities", json={
            "entities": [
                {"fields": {"name": "Supplier A", "city": "NYC"}, "display_name": "Supplier A"},
                {"fields": {"name": "Supplier B", "city": "LA"}, "display_name": "Supplier B"},
            ]
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["total_loaded"] == 2
        assert data["embeddings_generated"] == 2


class TestListEntities:
    def test_list_entities(self):
        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),
            [
                {"ENTITY_ID": "e1", "PROFILE_ID": "PROF-001", "DISPLAY_NAME": "Test Corp",
                 "FIELD_VALUES": '{"name":"Test Corp"}', "METADATA": None,
                 "IS_ACTIVE": True, "CREATED_AT": "2025-01-01"},
            ],
        ]

        resp = client.get("/profiles/company/entities?limit=10&offset=0")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["display_name"] == "Test Corp"


class TestDeleteEntity:
    def test_soft_delete_entity(self):
        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),
            None,  # UPDATE
            None,  # CALL invalidate
        ]

        resp = client.delete("/profiles/company/entities/ent-123")
        assert resp.status_code == 200
        assert "deactivated" in resp.json()["message"]


class TestProfileStats:
    def test_profile_stats(self):
        mock_session.sql.return_value.collect.side_effect = [
            _mock_profile_lookup(),
            [[json.dumps({
                "report_timestamp": "2025-01-01",
                "scope": "PROF-001",
                "entity_stats": {"total_entities": 50},
                "performance": {"avg_latency_ms": 45},
                "health": "HEALTHY",
            })]],
        ]

        resp = client.get("/profiles/company/stats")
        assert resp.status_code == 200
        assert resp.json()["health"] == "HEALTHY"
