"""
Execute Snowflake migration to add normalizer_options and strategy_options columns
"""
import snowflake.connector
import os
from pathlib import Path

# Read the SQL migration file
sql_file = Path("sql/20_add_normalizer_strategy_options.sql")
with open(sql_file, "r", encoding="utf-8") as f:
    sql_content = f.read()

# Create connection
conn = snowflake.connector.connect(
    account='HLWDCFC-FD80923',
    user='ATGOEL',
    password='LiveLife@456654',
    warehouse='SNOWFLAKE_LEARNING_WH',
    database='SNOWFLAKE_LEARNING_DB',
    schema='ENTITY_MATCHING',
    role='SNOWFLAKE_LEARNING_ROLE'
)

try:
    cursor = conn.cursor()
    
    # Execute each statement separately (split by semicolon, excluding comments)
    statements = [stmt.strip() for stmt in sql_content.split(';') if stmt.strip() and '--' not in stmt[:2]]
    
    for stmt in statements:
        if stmt and not stmt.startswith('--'):
            print(f"Executing: {stmt[:80]}...")
            try:
                cursor.execute(stmt)
                print("✓ Success")
            except Exception as e:
                print(f"Error: {e}")
                # Continue with other statements
    
    print("\nMigration completed!")
    
finally:
    cursor.close()
    conn.close()
