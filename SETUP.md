# Entity Matching System - Setup Guide

## Architecture

```
Client -> FastAPI (/match) -> Redis Cache (1hr TTL)
                           -> Snowflake Cortex
                              ├── EDITDISTANCE (40% weight)
                              └── EMBED_TEXT_768 cosine similarity (60% weight)
                           -> Upsert new entity if no match
```

## Prerequisites

- Snowflake account with Cortex AI enabled
- Python 3.10+
- Redis (optional - API works without it)

## Step 1: Snowflake Setup

Run the SQL scripts in order in Snowflake Worksheets (or SnowSQL):

```bash
# Option A: Via SnowSQL CLI
snowsql -a HLWDCFC-FD80923 -u ATGOEL -f sql/01_setup_tables.sql
snowsql -a HLWDCFC-FD80923 -u ATGOEL -f sql/02_matching_udf.sql
snowsql -a HLWDCFC-FD80923 -u ATGOEL -f sql/03_upsert_procedure.sql
snowsql -a HLWDCFC-FD80923 -u ATGOEL -f sql/04_performance_optimization.sql
snowsql -a HLWDCFC-FD80923 -u ATGOEL -f sql/05_monitoring.sql

# Option B: Copy-paste each file into a Snowflake Worksheet and run
```

**Expected output after 01_setup_tables.sql:**
- ~200 entities in `entities` table
- ~1200 aliases in `entity_aliases` table (200 canonical + 1000 variations)
- ~1200 embeddings in `entity_embeddings` table

## Step 2: Verify Snowflake Setup

```sql
-- Quick verification
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- Check row counts
SELECT 'entities' AS tbl, COUNT(*) AS cnt FROM entities
UNION ALL SELECT 'aliases', COUNT(*) FROM entity_aliases
UNION ALL SELECT 'embeddings', COUNT(*) FROM entity_embeddings;

-- Test matching
SELECT * FROM TABLE(hybrid_entity_match('IBM', 0.5));
SELECT * FROM TABLE(hybrid_entity_match('Microsft', 0.5));
CALL upsert_and_match('Google', NULL, 0.65);
```

## Step 3: Python API Setup

```bash
cd entity_matching

# Create virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r api/requirements.txt

# Configure environment
copy .env.example .env
# Edit .env with your actual password
```

## Step 4: Start Redis (Optional)

```bash
# Docker (easiest)
docker run -d --name redis -p 6379:6379 redis:alpine

# Or install locally: https://redis.io/download
```

## Step 5: Run the API

```bash
# Load env vars and start
# Windows PowerShell:
Get-Content .env | ForEach-Object { if ($_ -match '^([^#].+?)=(.+)$') { [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }
python -m api.app

# Or use python-dotenv (already in requirements):
# Add `from dotenv import load_dotenv; load_dotenv()` at top of app.py
```

API runs at: http://localhost:8000
Docs at: http://localhost:8000/docs (Swagger UI)

## Step 6: Test the API

```bash
# Health check
curl http://localhost:8000/health

# Single match - exact
curl -X POST http://localhost:8000/match \
  -H "Content-Type: application/json" \
  -d '{"name": "IBM", "threshold": 0.65}'

# Single match - fuzzy (typo)
curl -X POST http://localhost:8000/match \
  -H "Content-Type: application/json" \
  -d '{"name": "Microsft", "threshold": 0.5}'

# Single match - semantic (alias)
curl -X POST http://localhost:8000/match \
  -H "Content-Type: application/json" \
  -d '{"name": "Big Blue", "threshold": 0.5}'

# New entity (no match -> creates it)
curl -X POST http://localhost:8000/match \
  -H "Content-Type: application/json" \
  -d '{"name": "My Startup Inc", "threshold": 0.9, "metadata": {"industry": "Tech", "country": "USA"}}'

# Batch match
curl -X POST http://localhost:8000/match/batch \
  -H "Content-Type: application/json" \
  -d '{"entities": [{"name": "Apple"}, {"name": "Gooogle"}, {"name": "JP Morgan"}]}'

# Monitoring stats
curl http://localhost:8000/stats

# Clear cache
curl -X DELETE http://localhost:8000/cache
```

## Step 7: Run Tests

```bash
pytest tests/test_api.py -v

# Integration tests (requires real Snowflake connection)
RUN_INTEGRATION=1 pytest tests/test_api.py -v -k integration
```

## Cost Estimate

| Component | Monthly Cost |
|-----------|-------------|
| X-Small warehouse (auto-suspend 60s, ~2 hrs/day active) | ~$60 |
| Cortex embeddings (~1200 initial + ~100 new/month) | ~$0.15 |
| Storage (< 1GB) | ~$1 |
| **Total** | **~$61** |

With caching, actual warehouse time drops significantly at <100 req/min.

## File Structure

```
entity_matching/
├── sql/
│   ├── 01_setup_tables.sql       # Schema + 1000 test entities
│   ├── 02_matching_udf.sql       # hybrid_entity_match() UDF
│   ├── 03_upsert_procedure.sql   # upsert_and_match() procedure
│   ├── 04_performance_optimization.sql  # Caching, tasks, warehouse config
│   └── 05_monitoring.sql         # Views, alerts, cost tracking
├── api/
│   ├── app.py                    # FastAPI application
│   └── requirements.txt          # Python dependencies
├── tests/
│   └── test_api.py               # Unit + integration tests
├── .env.example                  # Environment template
├── .gitignore
└── SETUP.md                      # This file
```
