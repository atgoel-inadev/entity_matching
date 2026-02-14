# Seed Data Management System - Setup Guide

## Overview
This seed data management system provides comprehensive CSV upload, validation, and CRUD operations for entity data across all configured profiles. It automatically generates embeddings for SEMANTIC and HYBRID match strategy fields.

## Features

### ✅ Completed Features
1. **Profile-Based Data Management**
   - View all active profiles with entity counts
   - Switch between profiles dynamically
   - View profile configuration and field definitions

2. **CSV Upload with Validation**
   - Upload CSV files matching profile field configuration
   - Real-time validation of required fields
   - Preview data before upload
   - Error reporting for invalid rows
   - Support for up to 1000 entities per upload

3. **Entity Data Grid with CRUD Operations**
   - View all entities in a sortable/searchable grid
   - Edit entity field values inline
   - Delete entities (soft-delete)
   - Display match strategy for each field

4. **Automatic Embedding Generation**
   - Auto-generates embeddings for SEMANTIC fields
   - Auto-generates embeddings for HYBRID fields (40% fuzzy + 60% semantic)
   - Regenerates embeddings on entity update

## Installation

### Frontend Setup

1. **Install Dependencies**
   ```bash
   cd ui
   npm install
   ```

   This will install the new `papaparse` library for CSV processing.

2. **Start Development Server**
   ```bash
   npm run dev
   ```

### Backend Setup

The backend has been updated with a new endpoint:
- **PUT /profiles/{slug}/entities/{entity_id}** - Update entity with embedding regeneration

**No database migration needed** - the update uses existing tables and procedures.

## Usage Guide

### Step 1: Navigate to Seed Data Page
- From the main menu, go to **Seed Data**
- You'll see all configured profiles in the left sidebar

### Step 2: Select a Profile
- Click on any profile card to view its entities
- The profile configuration tab shows:
  - Field definitions
  - Match strategies (EXACT, FUZZY, SEMANTIC, PHONETIC, NUMERIC, HYBRID)
  - Required fields
  - Display fields

### Step 3: Prepare Your CSV File

Your CSV must match the profile's field configuration. Example for a "Company" profile:

**Required columns** (marked in the UI):
```csv
name,industry,country
Apple Inc.,Technology,USA
Microsoft Corporation,Technology,USA
Amazon.com Inc.,E-Commerce,USA
```

**Important Rules:**
- Column headers must match field names exactly (case-sensitive)
- Required fields must not be empty
- Extra columns are ignored
- Missing optional fields are allowed

### Step 4: Upload CSV

1. Click **Upload CSV** button
2. Select your CSV file
3. Review the validation results:
   - ✓ Green rows = valid entities
   - ✗ Red rows = validation errors with details
4. Click **Upload** to import valid entities

The system will:
- Insert entities into `profile_entities` table
- Generate embeddings for SEMANTIC/HYBRID fields
- Display success message with stats (entities loaded, embeddings generated, execution time)

### Step 5: Manage Entities

**View Entities:**
- All entities displayed in a grid with field values
- Shows match strategy for each field
- Entity ID and display name prominently shown

**Edit Entity:**
1. Click the **Edit** icon (pencil)
2. Modify field values inline
3. Click **Save** (checkmark) or **Cancel** (X)
- Embeddings automatically regenerate for SEMANTIC/HYBRID fields
- Cache is invalidated

**Delete Entity:**
1. Click the **Delete** icon (trash)
2. Confirm deletion in the dialog
- Soft-delete: sets `is_active = FALSE`
- Cache is invalidated

## CSV Format Examples

### Company Profile
```csv
name,industry,country
Alphabet Inc.,Technology,USA
Meta Platforms Inc.,Technology,USA
JPMorgan Chase & Co.,Banking,USA
```

### Supplier Profile
```csv
name,tax_id,city,country
Acme Supply Co,36-1234567,Chicago,USA
Global Parts Mfg,13-9876543,Detroit,USA
Precision Components Ltd,GB987654321,Manchester,UK
```

### Person Profile
```csv
first_name,last_name,email,phone
John,Smith,john.smith@acme.com,15550101
Maria,Garcia,maria.garcia@example.com,525512345678
Wei,Zhang,wei.zhang@tech.cn,8613800138000
```

## Technical Details

### Component Architecture

**Frontend Components:**
- `SeedDataPage.jsx` - Main page with profile selection and data management
- `CsvUploadDialog.jsx` - CSV upload, parsing, and validation
- `EntityDataGrid.jsx` - Entity CRUD grid component

**API Endpoints:**
- `GET /profiles` - List all profiles
- `GET /profiles/{slug}/entities` - List entities for a profile
- `POST /profiles/{slug}/entities` - Bulk load entities
- `PUT /profiles/{slug}/entities/{entity_id}` - Update entity (regenerates embeddings)
- `DELETE /profiles/{slug}/entities/{entity_id}` - Soft-delete entity

**Database Tables:**
- `profile_entities` - Entity data storage
- `profile_entity_embeddings` - SEMANTIC/HYBRID field embeddings
- `profile_match_cache` - Resolution cache (auto-invalidated on updates)

### Embedding Generation Logic

Embeddings are generated for fields with these match strategies:
- **SEMANTIC**: Pure embedding-based matching
- **HYBRID**: Combination of fuzzy (40%) + semantic (60%)

**On Insert:**
```sql
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
SELECT entity_id, profile_id, field_name, field_value,
       SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', field_value)
WHERE match_strategy IN ('SEMANTIC', 'HYBRID')
```

**On Update:**
1. Delete old embeddings for the entity
2. Regenerate embeddings for all SEMANTIC/HYBRID fields with values

### Validation Rules

**CSV Validation:**
1. ✓ File must be valid CSV format
2. ✓ Column headers must match configured field names
3. ✓ Required fields must have values
4. ✓ Optional fields can be empty or missing
5. ✓ Extra columns are ignored

**Entity Validation:**
- At least one field must have a value
- Field names must match profile configuration
- Display name auto-generated from primary_display field or first field

## Troubleshooting

### CSV Upload Fails
- **Check field names**: Column headers must match exactly (case-sensitive)
- **Check required fields**: All required fields must have values in every row
- **Check file encoding**: Use UTF-8 encoding
- **Check file size**: Max 1000 entities per upload

### Embeddings Not Generated
- Verify field match_strategy is 'SEMANTIC' or 'HYBRID'
- Check field has a value (not NULL or empty)
- Check Snowflake Cortex is available in your account

### Entity Update Fails
- Ensure entity exists and is active
- Check required fields are not being cleared
- Verify profile slug is correct

## Performance Notes

- **Bulk Upload**: ~100-500ms per entity (includes embedding generation)
- **Update**: ~500-1000ms (includes embedding regeneration)
- **Delete**: ~50-100ms (soft-delete)
- **Embeddings**: ~200-400ms per field (Cortex API call)

**Optimization Tips:**
- Upload entities in batches of 100-500 for best performance
- Profile cache is invalidated after updates automatically
- Use semantic/hybrid strategies selectively (embedding generation is slower than exact/fuzzy)

## Next Steps

After loading seed data:
1. Test entity resolution via the **Resolve** page
2. View match statistics on the **Dashboard**
3. Create custom profiles via the **Profiles** page
4. Monitor performance via the **Stats** endpoints

---

**Need Help?** Check the API documentation at http://localhost:8001/docs
