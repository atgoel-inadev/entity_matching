"""
Execute specific SQL statements for profile_fields migration
"""
import snowflake.connector

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
    
    # Statement 1: Add normalizer_options
    print("1. Adding normalizer_options column...")
    cursor.execute("ALTER TABLE profile_fields ADD COLUMN IF NOT EXISTS normalizer_options VARIANT")
    print("   ✓ Success")
    
    # Statement 2: Add strategy_options (already done, but safe with IF NOT EXISTS)
    print("2. Adding strategy_options column...")
    cursor.execute("ALTER TABLE profile_fields ADD COLUMN IF NOT EXISTS strategy_options VARIANT")
    print("   ✓ Success")
    
    # Statement 3: Migrate existing data
    print("3. Migrating existing strategy_config data...")
    result = cursor.execute("""
        UPDATE profile_fields
        SET strategy_options = strategy_config,
            normalizer_options = OBJECT_CONSTRUCT()
        WHERE strategy_config IS NOT NULL AND strategy_options IS NULL
    """)
    print(f"   ✓ Updated {result.rowcount} rows")
    
    # Statement 4: Add comments
    print("4. Adding column comments...")  
    cursor.execute("""
        COMMENT ON COLUMN profile_fields.normalizer_options IS 
        'JSON object for text normalization rules (e.g., lowercaseOnly, trimWhitespace, removeSpecialChars)'
    """)
    cursor.execute("""
        COMMENT ON COLUMN profile_fields.strategy_options IS 
        'JSON object for strategy-specific parameters (e.g., semantic blend ratios for HYBRID, fuzzy threshold)'
    """)
    print("   ✓ Comments added")
    
    # Statement 5: Verify
    print("5. Verifying changes...")
    cursor.execute("""
        SELECT COUNT(*) AS total_fields, 
               COUNT(normalizer_options) AS with_normalizer,
               COUNT(strategy_options) AS with_strategy
        FROM profile_fields
    """)
    row = cursor.fetchone()
    print(f"   Total fields: {row[0]}")
    print(f"   With normalizer_options: {row[1]}")
    print(f"   With strategy_options: {row[2]}")
    
    print("\n✅ Migration completed successfully!")
    
finally:
    cursor.close()
    conn.close()
