"""
Snowpark session management — single reusable session with lazy initialization.
"""

import os
import logging
from typing import Optional
from snowflake.snowpark import Session

logger = logging.getLogger("resolveiq.snowflake")

_session: Optional[Session] = None


def get_snowpark_session() -> Session:
    """Get or create a Snowpark session (connection pooling built-in)."""
    global _session
    if _session is None:
        config = {
            "account":   os.environ["SNOWFLAKE_ACCOUNT"],
            "user":      os.environ["SNOWFLAKE_USER"],
            "password":  os.environ["SNOWFLAKE_PASSWORD"],
            "role":      os.environ.get("SNOWFLAKE_ROLE", "SNOWFLAKE_LEARNING_ROLE"),
            "warehouse": os.environ.get("SNOWFLAKE_WAREHOUSE", "SNOWFLAKE_LEARNING_WH"),
            "database":  os.environ.get("SNOWFLAKE_DATABASE", "SNOWFLAKE_LEARNING_DB"),
            "schema":    os.environ.get("SNOWFLAKE_SCHEMA", "ENTITY_MATCHING"),
        }
        logger.info("Creating Snowpark session...")
        _session = Session.builder.configs(config).create()
        logger.info("Snowpark session created.")
    return _session


def close_session():
    """Close the Snowpark session (called on shutdown)."""
    global _session
    if _session:
        _session.close()
        _session = None
        logger.info("Snowpark session closed.")
