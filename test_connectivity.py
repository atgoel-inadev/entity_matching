#!/usr/bin/env python3
"""
Test Snowflake connectivity using .env credentials.
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import after loading env
from snowflake.snowpark import Session

def test_snowflake_connectivity():
    """Test connection to Snowflake and run a simple query."""
    print("Testing Snowflake connectivity...")

    # Configuration from environment
    config = {
        "account": os.environ.get("SNOWFLAKE_ACCOUNT"),
        "user": os.environ.get("SNOWFLAKE_USER"),
        "password": os.environ.get("SNOWFLAKE_PASSWORD"),
        "role": os.environ.get("SNOWFLAKE_ROLE", "SNOWFLAKE_LEARNING_ROLE"),
        "warehouse": os.environ.get("SNOWFLAKE_WAREHOUSE", "SNOWFLAKE_LEARNING_WH"),
        "database": os.environ.get("SNOWFLAKE_DATABASE", "SNOWFLAKE_LEARNING_DB"),
        "schema": os.environ.get("SNOWFLAKE_SCHEMA", "ENTITY_MATCHING"),
    }

    # Check if required env vars are set
    required = ["account", "user", "password"]
    missing = [k for k in required if not config.get(k)]
    if missing:
        print(f"ERROR: Missing required environment variables: {missing}")
        print("Please set them in your .env file.")
        return False

    try:
        # Create session
        print(f"Connecting to Snowflake account: {config['account']}")
        session = Session.builder.configs(config).create()
        print("✓ Connection successful")

        # Test basic query
        print("Running test query...")
        result = session.sql("SELECT CURRENT_ACCOUNT() as account, CURRENT_USER() as user").collect()
        print(f"✓ Query successful: Account={result[0]['ACCOUNT']}, User={result[0]['USER']}")

        # Test schema access
        print("Testing schema access...")
        tables_result = session.sql("SHOW TABLES").collect()
        print(f"✓ Found {len(tables_result)} tables in schema")

        # Check for specific tables
        expected_tables = ["ENTITIES", "ENTITY_ALIASES", "ENTITY_EMBEDDINGS"]
        existing_tables = [row['name'].upper() for row in tables_result]
        missing_tables = [t for t in expected_tables if t not in existing_tables]
        if missing_tables:
            print(f"⚠️  Missing tables: {missing_tables}")
            print("You may need to run the SQL setup scripts.")
        else:
            print("✓ All expected tables found")

        # Test procedure existence
        print("Testing procedure existence...")
        try:
            procs_result = session.sql("SHOW PROCEDURES LIKE 'UPSERT_AND_MATCH'").collect()
            if procs_result:
                print("✓ UPSERT_AND_MATCH procedure found")
            else:
                print("⚠️  UPSERT_AND_MATCH procedure not found")
                print("You need to run sql/03_upsert_procedure.sql")
        except Exception as e:
            print(f"⚠️  Error checking procedures: {e}")

        session.close()
        print("✓ All tests completed successfully")
        return True

    except Exception as e:
        print(f"ERROR: Connection failed: {e}")
        return False

if __name__ == "__main__":
    success = test_snowflake_connectivity()
    sys.exit(0 if success else 1)