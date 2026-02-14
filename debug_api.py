"""
Debug script to test the match function directly
"""

import os
import json
from dotenv import load_dotenv
load_dotenv()

from snowflake.snowpark import Session

# Configuration
config = {
    "account": os.environ["SNOWFLAKE_ACCOUNT"],
    "user": os.environ["SNOWFLAKE_USER"],
    "password": os.environ["SNOWFLAKE_PASSWORD"],
    "role": os.environ.get("SNOWFLAKE_ROLE", "SNOWFLAKE_LEARNING_ROLE"),
    "warehouse": os.environ.get("SNOWFLAKE_WAREHOUSE", "SNOWFLAKE_LEARNING_WH"),
    "database": os.environ.get("SNOWFLAKE_DATABASE", "SNOWFLAKE_LEARNING_DB"),
    "schema": os.environ.get("SNOWFLAKE_SCHEMA", "ENTITY_MATCHING"),
}

print("Creating session...")
session = Session.builder.configs(config).create()
print("✓ Session created")

# Test calling the procedure
print("\nTesting UPSERT_AND_MATCH procedure...")
try:
    # Use SQL CALL with PARSE_JSON for VARIANT parameter
    result_df = session.sql(
        "CALL UPSERT_AND_MATCH(?, PARSE_JSON(?), ?)",
        params=["IBM", "{}", 0.65]
    ).collect()
    
    result = result_df[0][0]
    print(f"✓ Procedure call successful")
    print(f"Result type: {type(result)}")
    print(f"Result: {result}")
    
    if isinstance(result, str):
        result_data = json.loads(result)
        print(f"Parsed result: {json.dumps(result_data, indent=2)}")
except Exception as e:
    print(f"✗ Error calling procedure: {e}")
    import traceback
    traceback.print_exc()

session.close()
print("\n✓ Test complete")
