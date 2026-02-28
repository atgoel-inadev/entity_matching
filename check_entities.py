"""
Check profile and entity counts in Snowflake
"""
import snowflake.connector
import json

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
    
    print("=" * 80)
    print("PROFILES IN DATABASE")
    print("=" * 80)
    cursor.execute("""
        SELECT profile_id, profile_slug, profile_name, 
               (SELECT COUNT(*) FROM profile_entities pe WHERE pe.profile_id = rp.profile_id) as entity_count
        FROM resolution_profiles rp
        WHERE is_active = TRUE
        ORDER BY profile_name
    """)
    
    profiles = cursor.fetchall()
    for row in profiles:
        print(f"\nProfile ID:    {row[0]}")
        print(f"Slug:          {row[1]}")
        print(f"Name:          {row[2]}")
        print(f"Entity Count:  {row[3]}")
    
    print("\n" + "=" * 80)
    print("ENTITIES BY PROFILE")
    print("=" * 80)
    cursor.execute("""
        SELECT profile_id, COUNT(*) as cnt, 
               MIN(display_name) as example_entity
        FROM profile_entities
        GROUP BY profile_id
        ORDER BY cnt DESC
    """)
    
    entity_groups = cursor.fetchall()
    for row in entity_groups:
        print(f"\nProfile ID: {row[0]}")
        print(f"Count:      {row[1]}")
        print(f"Example:    {row[2]}")
    
    print("\n" + "=" * 80)
    print("CHECKING FOR ORPHANED ENTITIES")
    print("=" * 80)
    cursor.execute("""
        SELECT pe.profile_id, COUNT(*) as orphan_count
        FROM profile_entities pe
        WHERE NOT EXISTS (
            SELECT 1 FROM resolution_profiles rp 
            WHERE rp.profile_id = pe.profile_id
        )
        GROUP BY pe.profile_id
    """)
    
    orphans = cursor.fetchall()
    if orphans:
        print("\n⚠️ Found orphaned entities (entities with non-existent profile_ids):")
        for row in orphans:
            print(f"   Profile ID: {row[0]} → {row[1]} entities")
    else:
        print("\n✓ No orphaned entities found")
    
finally:
    cursor.close()
    conn.close()
