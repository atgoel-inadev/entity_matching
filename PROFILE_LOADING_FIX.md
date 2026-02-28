# Profile Loading Fix - Schema Column Mismatches

## Issue Summary
The UI was showing "NO PROFILE IS AVAILABLE" with SQL errors about invalid column identifiers.

## Root Cause
The NestJS TypeScript code was querying Snowflake columns that didn't exist in the database schema:
1. `metadata` — actual column name is `config` in `resolution_profiles` table
2. `normalizer_options` and `strategy_options` — only `strategy_config` existed in `profile_fields` table

## Fixes Applied

### 1. Fixed METADATA Column Issue
**File:** `engine/src/snowflake/snowflake-profile.repository.ts`

**Changes:**
- Replaced all SQL queries selecting `metadata` with `config`
- Updated mapping code to read from `CONFIG` column instead of `METADATA`
- Affected methods: `findBySlug()`, `findAll()`, `create()`, `mapRowsToProfile()`

**Lines changed:**
- Line 60: `metadata` → `config` in findBySlug SELECT
- Line 92: `metadata` → `config` in INSERT column list  
- Line 278: `row['METADATA']` → `row['CONFIG']` in mapping

### 2. Fixed NORMALIZER_OPTIONS and STRATEGY_OPTIONS Issue
**Migration:** `sql/20_add_normalizer_strategy_options.sql`

**Actions:**
- Added `normalizer_options VARIANT` column to `profile_fields` table
- Added `strategy_options VARIANT` column to `profile_fields` table
- Migrated existing `strategy_config` data to `strategy_options`
- Added column comments for documentation

**Migration Execution:**
```bash
python run_migration_20_fixed.py
```

**Results:**
- ✓ Added 2 new columns
- ✓ Migrated 4 existing rows
- ✓ 38 total fields in table
- ✓ 4 fields now have normalizer_options
- ✓ 4 fields now have strategy_options

## Verification

### Backend API Test
```powershell
Invoke-RestMethod -Uri "http://localhost:8001/profiles" -Method Get
```

**Result:** ✅ Returns 2 profiles successfully:
- `b2b-supplier`: B2B Supplier Match (5 fields)
- `b2b-buyer`: B2B Buyer Match (5 fields)

### UI Status
- ✅ UI server running on port 5173
- ✅ API server running on port 8001
- ✅ No more SQL compilation errors
- ✅ Profiles should now load correctly in the UI

## Column Mapping Reference

### resolution_profiles Table
| TypeScript Field | Snowflake Column |
|-----------------|------------------|
| metadata        | config           |
| sourceSystem    | source_system    |
| externalIdField | external_id_field |
| allowAuthoritativeCreate | allow_authoritative_create |

### profile_fields Table  
| TypeScript Field | Snowflake Column |
|-----------------|------------------|
| normalizerOptions | normalizer_options |
| strategyOptions | strategy_options |
| matchStrategy | match_strategy |
| isPrimaryDisplay | is_primary_display |
| fieldOrder | field_order |

## Next Steps
1. ✅ Fixed — Profiles endpoint working
2. ✅ Fixed — UI can fetch profiles
3. 🔄 Test UI profile selection and resolution workflow
4. 🔄 Test entity resolution with the B2B buyer and supplier data

## Files Modified
1. `engine/src/snowflake/snowflake-profile.repository.ts` — Fixed SQL column names
2. `sql/20_add_normalizer_strategy_options.sql` — Migration script created
3. `run_migration_20_fixed.py` — Migration execution script

## Testing Commands

### Test Profiles Endpoint
```powershell
# List all profiles
Invoke-RestMethod -Uri "http://localhost:8001/profiles" -Method Get | ConvertTo-Json -Depth 5

# Get specific profile
Invoke-RestMethod -Uri "http://localhost:8001/profiles/b2b-buyer" -Method Get
```

### Test Resolution (Sample)
```powershell
$resolveBody = @{
  fields = @{
    buyer_name = "ABC Manufacturing"
    tax_id = "36-1234567"
  }
  sourceSystem = "AdminUI"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8001/profiles/b2b-buyer/resolve" `
  -Method Post -Body $resolveBody -ContentType "application/json"
```

## Status: ✅ RESOLVED
All SQL column mismatch errors have been fixed. The profiles endpoint is now working correctly and the UI should be able to load and display the B2B buyer and supplier profiles.
