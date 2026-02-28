import snowflake.connector
import json

conn = snowflake.connector.connect(
    user='ATGOEL',
    password='LiveLife@456654',
    account='HLWDCFC-FD80923',
    database='SNOWFLAKE_LEARNING_DB',
    schema='ENTITY_MATCHING'
)

cur = conn.cursor()

# Check if Shanghai entity has embeddings
print("=" * 80)
print("Checking Shanghai entity embeddings...")
print("=" * 80)

cur.execute("""
    SELECT 
        e.entity_id,
        e.display_name,
        emb.field_name,
        emb.model_version
    FROM profile_entities e
    LEFT JOIN profile_entity_embeddings emb ON e.entity_id = emb.entity_id
    WHERE e.display_name ILIKE '%Shanghai%'
""")

rows = cur.fetchall()
print(f"\nFound {len(rows)} entries:")
for row in rows:
    print(f"  Entity: {row[1]}")
    print(f"  ID: {row[0]}")
    print(f"  Field: {row[2]}")
    print(f"  Model: {row[3]}")
    print()

# Generate an embedding for "Shanghai" and search
print("=" * 80)
print("Testing semantic search for 'Shanghai'...")
print("=" * 80)

cur.execute("SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', 'Shanghai')")
shanghai_embedding = cur.fetchone()[0]
shanghai_embedding_json = json.dumps(shanghai_embedding)
print(f"\nGenerated embedding for 'Shanghai' (dimension: {len(shanghai_embedding)})")

# Search for similar entities
cur.execute(f"""
    SELECT 
        e.entity_id,
        e.display_name,
        e.field_values:supplier_name::VARCHAR as supplier_name,
        VECTOR_COSINE_SIMILARITY(emb.embedding, PARSE_JSON('{shanghai_embedding_json}')::VECTOR(FLOAT, 768)) as similarity
    FROM profile_entity_embeddings emb
    JOIN profile_entities e ON e.entity_id = emb.entity_id
    WHERE emb.profile_id = 'PROF-SUPPLIER-B2B-001'
        AND emb.field_name = 'supplier_name'
        AND e.is_active = TRUE
    ORDER BY similarity DESC
    LIMIT 10
""")

print("\nTop 10 similar suppliers:")
print(f"{'Score':<8} {'Display Name':<40} {'Supplier Name':<40}")
print("-" * 90)
for row in cur.fetchall():
    print(f"{row[3]:<8.4f} {row[1]:<40} {(row[2] or ''):<40}")

cur.close()
conn.close()
