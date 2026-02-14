"""
Tests for Profile CRUD endpoints.
Run: pytest tests/test_profiles.py -v
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


class TestListProfiles:
    def test_list_profiles(self):
        mock_session.sql.return_value.collect.side_effect = [
            # Profile rows
            [{"PROFILE_ID": "p1", "PROFILE_NAME": "Company", "PROFILE_SLUG": "company",
              "ENTITY_TYPE": "COMPANY", "DESCRIPTION": "Test", "DEFAULT_THRESHOLD": 0.65,
              "IS_ACTIVE": True, "CREATED_AT": "2025-01-01", "ENTITY_COUNT": 10}],
            # Field rows for p1
            [{"FIELD_NAME": "name", "FIELD_LABEL": "Name", "MATCH_STRATEGY": "SEMANTIC",
              "WEIGHT": 6.0, "IS_REQUIRED": True, "IS_PRIMARY_DISPLAY": True, "STRATEGY_CONFIG": None}],
        ]

        resp = client.get("/profiles")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["profile_slug"] == "company"
        assert len(data[0]["fields"]) == 1


class TestCreateProfile:
    def test_create_profile(self):
        mock_session.sql.return_value.collect.side_effect = [
            [],  # No existing slug
            [{"ID": "new-profile-123"}],  # UUID generation
            None,  # INSERT profile
            None,  # INSERT field 1
            None,  # INSERT field 2
        ]

        resp = client.post("/profiles", json={
            "profile_name": "Test Profile",
            "entity_type": "SUPPLIER",
            "description": "A test profile",
            "default_threshold": 0.7,
            "fields": [
                {"field_name": "name", "match_strategy": "SEMANTIC", "weight": 5.0, "is_required": True},
                {"field_name": "tax_id", "match_strategy": "EXACT", "weight": 3.0},
            ]
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["profile_slug"] == "test-profile"
        assert data["entity_type"] == "SUPPLIER"
        assert len(data["fields"]) == 2

    def test_create_profile_no_required_field(self):
        mock_session.sql.return_value.collect.return_value = []

        resp = client.post("/profiles", json={
            "profile_name": "Bad Profile",
            "entity_type": "TEST",
            "fields": [
                {"field_name": "name", "match_strategy": "FUZZY", "weight": 1.0},
            ]
        })
        assert resp.status_code == 422

    def test_create_profile_invalid_strategy(self):
        resp = client.post("/profiles", json={
            "profile_name": "Bad",
            "entity_type": "TEST",
            "fields": [
                {"field_name": "name", "match_strategy": "INVALID", "weight": 1.0, "is_required": True},
            ]
        })
        assert resp.status_code == 422

    def test_create_profile_weight_out_of_range(self):
        resp = client.post("/profiles", json={
            "profile_name": "Bad",
            "entity_type": "TEST",
            "fields": [
                {"field_name": "name", "match_strategy": "FUZZY", "weight": 15.0, "is_required": True},
            ]
        })
        assert resp.status_code == 422


class TestGetProfile:
    def test_get_profile(self):
        mock_session.sql.return_value.collect.side_effect = [
            [{"PROFILE_ID": "p1", "PROFILE_NAME": "Company", "PROFILE_SLUG": "company",
              "ENTITY_TYPE": "COMPANY", "DESCRIPTION": None, "DEFAULT_THRESHOLD": 0.65,
              "IS_ACTIVE": True, "CREATED_AT": "2025-01-01", "ENTITY_COUNT": 30}],
            [{"FIELD_NAME": "name", "FIELD_LABEL": "Name", "MATCH_STRATEGY": "SEMANTIC",
              "WEIGHT": 6.0, "IS_REQUIRED": True, "IS_PRIMARY_DISPLAY": True, "STRATEGY_CONFIG": None}],
        ]

        resp = client.get("/profiles/company")
        assert resp.status_code == 200
        assert resp.json()["entity_count"] == 30

    def test_get_profile_not_found(self):
        mock_session.sql.return_value.collect.return_value = []

        resp = client.get("/profiles/nonexistent")
        assert resp.status_code == 404


class TestUpdateProfile:
    def test_update_threshold(self):
        # First call: UPDATE, second call chain: get_profile re-query
        mock_session.sql.return_value.collect.side_effect = [
            None,  # UPDATE
            [{"PROFILE_ID": "p1", "PROFILE_NAME": "Company", "PROFILE_SLUG": "company",
              "ENTITY_TYPE": "COMPANY", "DESCRIPTION": None, "DEFAULT_THRESHOLD": 0.80,
              "IS_ACTIVE": True, "CREATED_AT": "2025-01-01", "ENTITY_COUNT": 30}],
            [],  # fields
        ]

        resp = client.put("/profiles/company", json={"default_threshold": 0.80})
        assert resp.status_code == 200

    def test_update_no_fields(self):
        resp = client.put("/profiles/company", json={})
        assert resp.status_code == 422


class TestDeleteProfile:
    def test_soft_delete(self):
        mock_session.sql.return_value.collect.return_value = None

        resp = client.delete("/profiles/company")
        assert resp.status_code == 200
        assert "deactivated" in resp.json()["message"]
