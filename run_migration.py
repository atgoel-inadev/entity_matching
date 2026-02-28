import snowflake.connector
from pathlib import Path

# Connect to Snowflake
conn = snowflake.connector.connect(
    user='ATGOEL',
    password='LiveLife@456654',
    account='HLWDCFC-FD80923',
    database='SNOWFLAKE_LEARNING_DB',
    schema='ENTITY_MATCHING'
)

try:
    cursor = conn.cursor()
    
    print(f"\n🔧 Running migration: 20_case_insensitive_embeddings.sql")
    print(f"   Database: SNOWFLAKE_LEARNING_DB")
    print(f"   Schema: ENTITY_MATCHING\n")
    
    # Step 1: Delete existing embeddings
    print("[1/4] Deleting existing embeddings...")
    cursor.execute("DELETE FROM profile_entity_embeddings")
    rows_deleted = cursor.rowcount
    print(f"      ✓ Deleted {rows_deleted} old embeddings\n")
    
    # Step 2: Regenerate buyer embeddings with LOWER()
    print("[2/4] Regenerating buyer_name embeddings (with LOWER normalization)...")
    cursor.execute("""
        INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
        SELECT
            pe.entity_id,
            pe.profile_id,
            'buyer_name',
            LOWER(TRIM(pe.field_values:buyer_name::VARCHAR)) AS normalized_text,
            SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', LOWER(TRIM(pe.field_values:buyer_name::VARCHAR)))
        FROM profile_entities pe
        WHERE pe.profile_id = 'PROF-BUYER-B2B-001'
          AND pe.is_active = TRUE
          AND pe.field_values:buyer_name IS NOT NULL
    """)
    buyer_count = cursor.rowcount
    print(f"      ✓ Generated {buyer_count} buyer embeddings\n")
    
    # Step 3: Regenerate supplier embeddings with LOWER()
    print("[3/4] Regenerating supplier_name embeddings (with LOWER normalization)...")
    cursor.execute("""
        INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
        SELECT
            pe.entity_id,
            pe.profile_id,
            'supplier_name',
            LOWER(TRIM(pe.field_values:supplier_name::VARCHAR)) AS normalized_text,
            SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', LOWER(TRIM(pe.field_values:supplier_name::VARCHAR)))
        FROM profile_entities pe
        WHERE pe.profile_id = 'PROF-SUPPLIER-B2B-001'
          AND pe.is_active = TRUE
          AND pe.field_values:supplier_name IS NOT NULL
    """)
    supplier_count = cursor.rowcount
    print(f"      ✓ Generated {supplier_count} supplier embeddings\n")
    
    # Step 4: Verification
    print("[4/4] Verifying results...")
    cursor.execute("""
        SELECT 
            profile_id,
            field_name,
            COUNT(*) AS embedding_count,
            LEFT(source_text, 50) AS sample_text
        FROM profile_entity_embeddings
        GROUP BY profile_id, field_name, source_text
        ORDER BY profile_id, field_name
        LIMIT 5
    """)
    results = cursor.fetchall()
    print(f"      Sample embeddings:")
    for row in results:
        print(f"        - {row[0]} / {row[1]}: {row[2]} embeddings, text='{row[3]}'")
    
    print(f"\n✅ Migration completed successfully!")
    print(f"   Total: {buyer_count} buyers + {supplier_count} suppliers = {buyer_count + supplier_count} embeddings")
    print(f"   All embeddings now use LOWER(TRIM(...)) normalization for case-insensitive matching\n")
    
finally:
    cursor.close()
    conn.close()
