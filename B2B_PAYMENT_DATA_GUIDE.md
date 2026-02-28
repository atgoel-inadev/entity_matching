# B2B Payment Domain Seed Data Guide

## Overview

This guide explains the B2B payment domain seed data created for the ResolveIQ entity matching engine. The data models realistic buyer-supplier relationships in payment processing scenarios.

## Files Created

- **`19_b2b_payment_seed_data.sql`** - Complete seed data with 50 entities (25 buyers + 25 suppliers)

## Profiles Created

### 1. B2B Buyer Profile (`b2b-buyer`)
**Purpose**: Match companies making payments (Accounts Payable perspective)

**Fields** (weighted for matching):
- `buyer_name` (SEMANTIC, weight 5.0) - Primary company name match
- `tax_id` (EXACT, weight 4.0) - Tax ID/VAT number (fast-path eligible)
- `duns_number` (EXACT, weight 3.0) - D&B DUNS identifier
- `billing_address` (FUZZY, weight 2.0) - Street address
- `city` (FUZZY, weight 1.5) - City name
- `state` (EXACT, weight 1.0) - State/province code
- `country` (EXACT, weight 1.5) - Country
- `postal_code` (EXACT, weight 1.0) - Zip/postal code
- `bank_account_last4` (EXACT, weight 2.0) - Bank account identifier
- `payment_email` (EXACT, weight 2.5) - AP contact email

**Metadata** (stored but not matched):
- `payment_terms` - e.g., "Net 30", "Net 45", "Net 60"
- `credit_limit` - Dollar amount
- `industry` - Industry classification
- `salesforce_id` - External Salesforce Account ID

### 2. B2B Supplier Profile (`b2b-supplier`)
**Purpose**: Match companies receiving payments (Accounts Receivable perspective)

**Fields** (weighted for matching):
- `supplier_name` (SEMANTIC, weight 5.0) - Primary company name match
- `tax_id` (EXACT, weight 4.0) - Tax ID/VAT number (fast-path eligible)
- `vendor_id` (EXACT, weight 3.5) - Internal vendor identifier
- `remittance_address` (FUZZY, weight 2.0) - Payment mailing address
- `city` (FUZZY, weight 1.5) - City name
- `country` (EXACT, weight 1.5) - Country
- `bank_name` (FUZZY, weight 2.0) - Supplier's bank
- `iban` (EXACT, weight 3.0) - International bank account number
- `swift_code` (EXACT, weight 2.5) - Bank routing code
- `payment_contact` (EXACT, weight 2.0) - AR contact email

**Metadata** (stored but not matched):
- `category` - Supplier category (e.g., "IT Services", "Manufacturing")
- `payment_terms_offered` - Supplier's standard terms
- `annual_revenue` - Company size indicator
- `salesforce_id` - External Salesforce Account ID

## How to Load the Data

```bash
# Option 1: Via Snowflake SQL
snowsql -a YOUR_ACCOUNT -u YOUR_USER -f sql/19_b2b_payment_seed_data.sql

# Option 2: Via SnowSQL CLI
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;
!source sql/19_b2b_payment_seed_data.sql

# Option 3: Copy-paste in Snowflake UI
# Open Snowflake worksheet and run the entire script
```

## Sample Usage Scenarios

### Scenario 1: Match Buyer by Tax ID (Exact Match)
```bash
POST http://localhost:8001/profiles/b2b-buyer/resolve
Content-Type: application/json

{
  "fields": {
    "buyer_name": "Acme Manufacturing",
    "tax_id": "36-1234567"
  },
  "sourceSystem": "Gen3"
}
```
**Expected**: EXACT_MATCH on tax_id (weight 4.0 ≥ 3.0 fast-path threshold)

### Scenario 2: Match Supplier by Name Variation
```bash
POST http://localhost:8001/profiles/b2b-supplier/resolve
Content-Type: application/json

{
  "fields": {
    "supplier_name": "Global Tech Industries",
    "city": "San Jose",
    "country": "USA"
  },
  "sourceSystem": "Salesforce"
}
```
**Expected**: HIGH_CONFIDENCE semantic match (name similarity + geographic confirmation)

### Scenario 3: Match Buyer with Missing Data
```bash
POST http://localhost:8001/profiles/b2b-buyer/resolve
Content-Type: application/json

{
  "fields": {
    "buyer_name": "Deutsche Bank",
    "country": "Germany",
    "city": "Frankfurt"
  },
  "sourceSystem": "AdminUI"
}
```
**Expected**: HIGH_CONFIDENCE (semantic name match + location confirmation)

### Scenario 4: Match Supplier by Bank Details
```bash
POST http://localhost:8001/profiles/b2b-supplier/resolve
Content-Type: application/json

{
  "fields": {
    "supplier_name": "Premier Office Supplies",
    "swift_code": "BOFAUS3N",
    "iban": "US29BOFAUS3NXXX9876543210"
  },
  "sourceSystem": "Gen3"
}
```
**Expected**: HIGH_CONFIDENCE (name + financial identifier confirmation)

### Scenario 5: No Match - New Entity
```bash
POST http://localhost:8001/profiles/b2b-buyer/resolve
Content-Type: application/json

{
  "fields": {
    "buyer_name": "Nonexistent Company XYZ",
    "tax_id": "99-9999999",
    "country": "USA"
  },
  "sourceSystem": "Salesforce"
}
```
**Expected**: NO_MATCH (score < 0.75 threshold)

## Testing Payment Reconciliation Flows

### Use Case 1: Invoice Matching
When processing an invoice from "GlobalTech Industries Inc":
1. Extract supplier name, tax ID, bank details from invoice
2. Call `/profiles/b2b-supplier/resolve` with extracted fields
3. If EXACT_MATCH or HIGH_CONFIDENCE → link invoice to known supplier
4. If LOW_CONFIDENCE → route to manual review queue
5. If NO_MATCH → create new supplier record

### Use Case 2: Payment Processing
When initiating a payment to a buyer:
1. Extract buyer name, bank account last 4, payment email
2. Call `/profiles/b2b-buyer/resolve` with buyer details
3. Retrieve matched entity's full banking details from Snowflake
4. Validate payment destination before executing transfer

### Use Case 3: Vendor Master Deduplication
When importing vendors from external system (ERP, procurement):
1. For each vendor record:
   - Call `/profiles/b2b-supplier/resolve` 
   - If HIGH_CONFIDENCE match exists → merge with existing
   - If multiple LOW_CONFIDENCE → manual review with candidates
   - If NO_MATCH → create new supplier

## Data Statistics

```sql
-- Buyer entities by country
SELECT 
    field_values:country::VARCHAR AS country,
    COUNT(*) AS buyer_count
FROM profile_entities
WHERE profile_id = 'PROF-BUYER-B2B-001'
GROUP BY field_values:country::VARCHAR
ORDER BY buyer_count DESC;

-- Supplier entities by category
SELECT 
    metadata:category::VARCHAR AS category,
    COUNT(*) AS supplier_count
FROM profile_entities
WHERE profile_id = 'PROF-SUPPLIER-B2B-001'
GROUP BY metadata:category::VARCHAR
ORDER BY supplier_count DESC;

-- Average credit limit by industry (buyers)
SELECT 
    metadata:industry::VARCHAR AS industry,
    AVG(metadata:credit_limit::NUMBER) AS avg_credit_limit,
    COUNT(*) AS entity_count
FROM profile_entities
WHERE profile_id = 'PROF-BUYER-B2B-001'
GROUP BY metadata:industry::VARCHAR
ORDER BY avg_credit_limit DESC;
```

## PowerShell Test Commands

```powershell
# Test Buyer Resolution
$buyerRequest = @{
    fields = @{
        buyer_name = "Acme Manufacturing Inc"
        tax_id = "36-1234567"
        country = "USA"
    }
    sourceSystem = "Gen3"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8001/profiles/b2b-buyer/resolve" `
    -Method Post -Body $buyerRequest -ContentType "application/json"

# Test Supplier Resolution
$supplierRequest = @{
    fields = @{
        supplier_name = "GlobalTech Industries"
        tax_id = "94-3210987"
        city = "San Jose"
    }
    sourceSystem = "Salesforce"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8001/profiles/b2b-supplier/resolve" `
    -Method Post -Body $supplierRequest -ContentType "application/json"

# Batch test - find all buyers in Germany
$buyers = @("Deutsche Bank AG", "Volkswagen AG", "Siemens AG")
$results = $buyers | ForEach-Object {
    $req = @{ fields = @{ buyer_name = $_; country = "Germany" }; sourceSystem = "AdminUI" } | ConvertTo-Json
    Invoke-RestMethod -Uri "http://localhost:8001/profiles/b2b-buyer/resolve" -Method Post -Body $req -ContentType "application/json"
}
$results | Format-Table
```

## Data Coverage

### Geographic Distribution
- **North America**: 40% (USA, Canada)
- **Europe**: 30% (Germany, UK, Switzerland, Sweden, Netherlands, Spain, Poland, Italy)
- **Asia**: 20% (Japan, China, South Korea, India, Singapore, Thailand)
- **Other**: 10% (Brazil, Australia, UAE, South Africa)

### Industry Coverage
**Buyers**:
- Manufacturing, Technology, Retail, Healthcare, Logistics, Energy, Food Distribution, Financial Services, Electronics, Telecommunications, Banking, Airlines, Automotive, Consumer Goods, Oil & Gas, E-commerce, Pharmaceuticals, Conglomerate, Mining

**Suppliers**:
- IT Services, Office Supplies, Manufacturing, Software/SaaS, Chemicals, Logistics, Technology, Electronics, Paper & Packaging, Raw Materials, Industrial Services, Engineering Services, Steel Distribution, Mining Equipment, Energy Services, Precision Manufacturing, Construction Materials, Pharmaceuticals, Semiconductors, Food Distribution, Energy Equipment, Textiles, Petrochemicals, Fashion & Textiles, Mining Services

## Payment-Specific Field Strategies

### Fast-Path Fields (weight ≥ 3.0)
These fields trigger immediate EXACT_MATCH if matched:
- `tax_id` (weight 4.0) - Unique tax identifier
- `duns_number` (weight 3.0) - D&B universal numbering
- `vendor_id` (weight 3.5) - Internal vendor ID
- `iban` (weight 3.0) - Bank account number

### Verification Fields (weight 2.0-2.5)
These provide strong confirmation:
- `payment_email` / `payment_contact` - Contact verification
- `bank_account_last4` - Partial account match
- `swift_code` - Bank routing verification
- `bank_name` - Financial institution match

### Fuzzy Fields (weight 1.5-2.0)
These handle variations:
- `billing_address` / `remittance_address` - Address fuzzy match
- `city` - Location fuzzy match

### Exact Fields (weight 1.0-1.5)
These provide geographic/structural confirmation:
- `country` - Must match exactly
- `state` - State/province exact match
- `postal_code` - Zip exact match

## Integration with Salesforce

All entities include `salesforce_id` in metadata for bi-directional sync:

```typescript
// After matching, retrieve Salesforce ID
const result = await resolveEntity('b2b-buyer', request);
if (result.matchType === 'EXACT_MATCH' || result.matchType === 'HIGH_CONFIDENCE') {
    const salesforceId = result.metadata?.salesforce_id;
    // Use salesforceId to update Salesforce account
}
```

## Next Steps

1. **Load the data**: Run `19_b2b_payment_seed_data.sql` in Snowflake
2. **Verify**: Check profile and entity counts
3. **Test**: Use PowerShell commands above to test resolution
4. **Extend**: Add more entities as needed for your specific payment flows

## Support

For questions or issues:
- Check [ARCHITECTURE_PROPOSAL_NODEJS.md](../ARCHITECTURE_PROPOSAL_NODEJS.md) for system design
- Review [CLAUDE.md](../CLAUDE.md) for coding standards
- Test via Swagger UI: `http://localhost:8001/api`
