-- =============================================================================
-- SECTION A: SNOWFLAKE SETUP - Schema, Tables, and Test Data
-- Entity Matching System with Cortex AI
-- =============================================================================
-- Run this script in Snowflake as SNOWFLAKE_LEARNING_ROLE
-- Warehouse: SNOWFLAKE_LEARNING_WH (X-Small)
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;

-- Create dedicated schema for entity matching
CREATE SCHEMA IF NOT EXISTS ENTITY_MATCHING;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- TABLE 1: ENTITIES - Master entity store
-- =============================================================================
CREATE OR REPLACE TABLE entities (
    entity_id       VARCHAR(36) DEFAULT UUID_STRING(),
    canonical_name  VARCHAR(500) NOT NULL,          -- Primary/official name
    entity_type     VARCHAR(50) DEFAULT 'COMPANY',  -- COMPANY, PERSON, ORG
    industry        VARCHAR(100),
    country         VARCHAR(100),
    metadata        VARIANT,                        -- Flexible JSON metadata
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    is_active       BOOLEAN DEFAULT TRUE,
    CONSTRAINT pk_entities PRIMARY KEY (entity_id)
);

-- =============================================================================
-- TABLE 2: ENTITY_ALIASES - Name variations for each entity
-- =============================================================================
CREATE OR REPLACE TABLE entity_aliases (
    alias_id        VARCHAR(36) DEFAULT UUID_STRING(),
    entity_id       VARCHAR(36) NOT NULL,
    alias_name      VARCHAR(500) NOT NULL,           -- Variation/alias
    alias_type      VARCHAR(50) DEFAULT 'VARIATION', -- VARIATION, ABBREVIATION, LEGAL, TRADE
    name_normalized VARCHAR(500),                     -- Lowered, trimmed, no punctuation
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_aliases PRIMARY KEY (alias_id),
    CONSTRAINT fk_aliases_entity FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
);

-- =============================================================================
-- TABLE 3: ENTITY_EMBEDDINGS - Vector embeddings for semantic search
-- =============================================================================
CREATE OR REPLACE TABLE entity_embeddings (
    embedding_id    VARCHAR(36) DEFAULT UUID_STRING(),
    entity_id       VARCHAR(36) NOT NULL,
    alias_id        VARCHAR(36),                      -- NULL = canonical name embedding
    source_text     VARCHAR(500) NOT NULL,            -- Text that was embedded
    embedding       VECTOR(FLOAT, 768),               -- Cortex 768-dim vector
    model_version   VARCHAR(50) DEFAULT 'e5-base-v2', -- Track model used
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_embeddings PRIMARY KEY (embedding_id),
    CONSTRAINT fk_embeddings_entity FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
);

-- =============================================================================
-- TABLE 4: MATCH_CACHE - Query result cache (reduces compute cost)
-- =============================================================================
CREATE OR REPLACE TABLE match_cache (
    cache_key       VARCHAR(64) NOT NULL,             -- SHA256 of normalized input
    input_name      VARCHAR(500) NOT NULL,
    matched_entity_id VARCHAR(36),
    matched_name    VARCHAR(500),
    match_score     FLOAT,
    match_type      VARCHAR(20),                      -- EXACT, FUZZY, SEMANTIC, HYBRID
    threshold_used  FLOAT,
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    expires_at      TIMESTAMP_NTZ,                    -- TTL for cache entry
    hit_count       INTEGER DEFAULT 0,
    CONSTRAINT pk_cache PRIMARY KEY (cache_key)
);

-- =============================================================================
-- TABLE 5: MATCH_LOG - Audit trail for all match requests
-- =============================================================================
CREATE OR REPLACE TABLE match_log (
    log_id          VARCHAR(36) DEFAULT UUID_STRING(),
    input_name      VARCHAR(500),
    matched_entity_id VARCHAR(36),
    match_score     FLOAT,
    match_type      VARCHAR(20),
    was_cached      BOOLEAN DEFAULT FALSE,
    execution_ms    INTEGER,
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- =============================================================================
-- INDEXES & CLUSTERING for performance
-- =============================================================================

-- Cluster entities by type for filtered queries
ALTER TABLE entities CLUSTER BY (entity_type);

-- Cluster aliases by normalized name prefix for fast fuzzy lookups
ALTER TABLE entity_aliases CLUSTER BY (SUBSTRING(name_normalized, 1, 3));

-- Search optimization on alias names for LIKE/fuzzy queries
ALTER TABLE entity_aliases ADD SEARCH OPTIMIZATION ON EQUALITY(name_normalized);
ALTER TABLE entity_aliases ADD SEARCH OPTIMIZATION ON EQUALITY(alias_name);

-- Cache lookup optimization
ALTER TABLE match_cache ADD SEARCH OPTIMIZATION ON EQUALITY(cache_key);


-- =============================================================================
-- HELPER FUNCTION: Normalize entity names consistently
-- =============================================================================
CREATE OR REPLACE FUNCTION normalize_name(raw_name VARCHAR)
RETURNS VARCHAR
LANGUAGE SQL
IMMUTABLE
AS
$$
    TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                LOWER(TRIM(raw_name)),
                '[^a-z0-9\\s]', ''   -- Remove punctuation
            ),
            '\\s+', ' '              -- Collapse multiple spaces
        )
    )
$$;


-- =============================================================================
-- TEST DATA: 1000 companies with realistic name variations
-- =============================================================================

-- Step 1: Insert 200 canonical entities (each will get ~5 aliases = 1000 variations)
CREATE OR REPLACE TEMPORARY TABLE seed_companies (
    company_name VARCHAR(500),
    industry VARCHAR(100),
    country VARCHAR(100),
    aliases VARIANT  -- Array of name variations
);

INSERT INTO seed_companies (company_name, industry, country, aliases)
SELECT column1, column2, column3,PARSE_JSON (column4)
FROM VALUES
-- Tech Giants
('International Business Machines Corporation', 'Technology', 'USA', ('["IBM", "IBM Corp", "IBM Corporation", "Big Blue", "Intl Business Machines"]')),
('Microsoft Corporation', 'Technology', 'USA', ('["Microsoft", "MSFT", "Microsoft Corp", "MS Corporation", "Micro Soft"]')),
('Apple Inc', 'Technology', 'USA', ('["Apple", "Apple Inc.", "Apple Computer", "AAPL", "Apple Incorporated"]')),
('Alphabet Inc', 'Technology', 'USA', ('["Google", "Alphabet", "Google LLC", "GOOGL", "Google Inc"]')),
('Amazon.com Inc', 'Technology', 'USA', ('["Amazon", "AMZN", "Amazon.com", "Amazon Inc", "Amazon Web Services"]')),
('Meta Platforms Inc', 'Technology', 'USA', ('["Facebook", "Meta", "FB", "Meta Platforms", "Facebook Inc"]')),
('Tesla Inc', 'Automotive', 'USA', ('["Tesla", "TSLA", "Tesla Motors", "Tesla Inc.", "Tesla Incorporated"]')),
('NVIDIA Corporation', 'Technology', 'USA', ('["NVIDIA", "Nvidia Corp", "NVDA", "nVidia", "Nvidia Corporation"]')),
('Samsung Electronics Co Ltd', 'Technology', 'South Korea', ('["Samsung", "Samsung Electronics", "Samsung Corp", "Samsung Co", "SSNLF"]')),
('Taiwan Semiconductor Manufacturing Company', 'Semiconductors', 'Taiwan', ('["TSMC", "Taiwan Semi", "TSM", "Taiwan Semiconductor", "TSMC Ltd"]')),
-- Retail
('Walmart Inc', 'Retail', 'USA', ('["Walmart", "Wal-Mart", "WMT", "Wal Mart", "Walmart Stores"]')),
('The Home Depot Inc', 'Retail', 'USA', ('["Home Depot", "HomeDepot", "HD", "The Home Depot", "Home Depot Inc"]')),
('Costco Wholesale Corporation', 'Retail', 'USA', ('["Costco", "COST", "Costco Wholesale", "CostCo", "Costco Corp"]')),
('Target Corporation', 'Retail', 'USA', ('["Target", "TGT", "Target Corp", "Target Stores", "Target Inc"]')),
('The Kroger Co', 'Retail', 'USA', ('["Kroger", "KR", "Kroger Co", "The Kroger Company", "Kroger Stores"]')),
-- Finance
('JPMorgan Chase & Co', 'Finance', 'USA', ('["JPMorgan", "JP Morgan", "Chase", "JPM", "J.P. Morgan"]')),
('Bank of America Corporation', 'Finance', 'USA', ('["Bank of America", "BofA", "BAC", "BoA", "BankOfAmerica"]')),
('Goldman Sachs Group Inc', 'Finance', 'USA', ('["Goldman Sachs", "GS", "Goldman", "Goldman Sachs Group", "GoldmanSachs"]')),
('Morgan Stanley', 'Finance', 'USA', ('["Morgan Stanley", "MS", "MorganStanley", "Morgan Stanley & Co", "Morgan Stanley Inc"]')),
('Visa Inc', 'Finance', 'USA', ('["Visa", "V", "Visa International", "Visa Inc.", "VISA"]')),
-- Healthcare
('Johnson & Johnson', 'Healthcare', 'USA', ('["J&J", "JNJ", "Johnson and Johnson", "J & J", "JohnsonJohnson"]')),
('UnitedHealth Group Incorporated', 'Healthcare', 'USA', ('["UnitedHealth", "UNH", "United Health Group", "UHG", "UnitedHealth Group"]')),
('Pfizer Inc', 'Healthcare', 'USA', ('["Pfizer", "PFE", "Pfizer Inc.", "Pfizer Corporation", "Pfizer Pharmaceuticals"]')),
('AbbVie Inc', 'Healthcare', 'USA', ('["AbbVie", "ABBV", "Abbvie Inc", "AbbVie Corporation", "Abb Vie"]')),
('Merck & Co Inc', 'Healthcare', 'USA', ('["Merck", "MRK", "Merck & Co", "Merck and Co", "Merck Sharp Dohme"]')),
-- Energy
('Exxon Mobil Corporation', 'Energy', 'USA', ('["ExxonMobil", "Exxon", "XOM", "Exxon Mobil", "Esso"]')),
('Chevron Corporation', 'Energy', 'USA', ('["Chevron", "CVX", "Chevron Corp", "Chevron USA", "ChevronTexaco"]')),
('Shell plc', 'Energy', 'UK', ('["Shell", "Royal Dutch Shell", "SHEL", "Shell Oil", "RDS"]')),
('BP plc', 'Energy', 'UK', ('["BP", "British Petroleum", "BP PLC", "B.P.", "BP Oil"]')),
('TotalEnergies SE', 'Energy', 'France', ('["TotalEnergies", "Total", "TTE", "Total SA", "Total Energies"]')),
-- Automotive
('Toyota Motor Corporation', 'Automotive', 'Japan', ('["Toyota", "TM", "Toyota Motor", "Toyota Corp", "Toyota Motors"]')),
('Volkswagen AG', 'Automotive', 'Germany', ('["Volkswagen", "VW", "VWAGY", "Volks Wagen", "VW AG"]')),
('General Motors Company', 'Automotive', 'USA', ('["GM", "General Motors", "Gen Motors", "GMC", "General Motors Co"]')),
('Ford Motor Company', 'Automotive', 'USA', ('["Ford", "F", "Ford Motor", "Ford Motors", "Ford Motor Co"]')),
('BMW AG', 'Automotive', 'Germany', ('["BMW", "Bayerische Motoren Werke", "BMWYY", "B.M.W.", "BMW Group"]')),
-- Telecom
('AT&T Inc', 'Telecom', 'USA', ('["AT&T", "ATT", "T", "AT and T", "American Telephone Telegraph"]')),
('Verizon Communications Inc', 'Telecom', 'USA', ('["Verizon", "VZ", "Verizon Communications", "Verizon Corp", "Verizon Wireless"]')),
('T-Mobile US Inc', 'Telecom', 'USA', ('["T-Mobile", "TMobile", "TMUS", "T Mobile", "T-Mobile USA"]')),
('Deutsche Telekom AG', 'Telecom', 'Germany', ('["Deutsche Telekom", "DT", "DTEGY", "Deutsche Tel", "DeutscheTelekom"]')),
('Comcast Corporation', 'Telecom', 'USA', ('["Comcast", "CMCSA", "Comcast Corp", "Xfinity", "Comcast Cable"]')),
-- Consumer Goods
('The Procter & Gamble Company', 'Consumer Goods', 'USA', ('["P&G", "Procter Gamble", "PG", "Procter & Gamble", "Proctor Gamble"]')),
('The Coca-Cola Company', 'Beverages', 'USA', ('["Coca-Cola", "Coke", "KO", "CocaCola", "Coca Cola"]')),
('PepsiCo Inc', 'Beverages', 'USA', ('["PepsiCo", "Pepsi", "PEP", "Pepsi Co", "PepsiCo Inc."]')),
('Nestle SA', 'Consumer Goods', 'Switzerland', ('["Nestle", "NSRGY", "Nestlé", "Nestle SA", "Nestle Group"]')),
('Unilever plc', 'Consumer Goods', 'UK', ('["Unilever", "UL", "Unilever PLC", "Unilever Group", "Uni Lever"]')),
-- Aerospace & Defense
('The Boeing Company', 'Aerospace', 'USA', ('["Boeing", "BA", "Boeing Co", "Boeing Corporation", "Boeing Aerospace"]')),
('Lockheed Martin Corporation', 'Defense', 'USA', ('["Lockheed Martin", "LMT", "Lockheed", "LockheedMartin", "Lockheed Martin Corp"]')),
('Raytheon Technologies Corporation', 'Defense', 'USA', ('["Raytheon", "RTX", "Raytheon Technologies", "Raytheon Corp", "RaytheonTech"]')),
('Airbus SE', 'Aerospace', 'France', ('["Airbus", "EADSY", "Airbus Group", "Airbus SE", "Air Bus"]')),
('Northrop Grumman Corporation', 'Defense', 'USA', ('["Northrop Grumman", "NOC", "Northrop", "NorthropGrumman", "Northrop Grumman Corp"]')),
-- Additional Tech
('Oracle Corporation', 'Technology', 'USA', ('["Oracle", "ORCL", "Oracle Corp", "Oracle Inc", "Oracle Systems"]')),
('Salesforce Inc', 'Technology', 'USA', ('["Salesforce", "CRM", "SFDC", "Salesforce.com", "Sales Force"]')),
('Adobe Inc', 'Technology', 'USA', ('["Adobe", "ADBE", "Adobe Systems", "Adobe Inc.", "Adobe Corp"]')),
('Intel Corporation', 'Semiconductors', 'USA', ('["Intel", "INTC", "Intel Corp", "Intel Inc", "Intel Semiconductor"]')),
('Cisco Systems Inc', 'Technology', 'USA', ('["Cisco", "CSCO", "Cisco Systems", "Cisco Corp", "CiscoSystems"]')),
('Netflix Inc', 'Entertainment', 'USA', ('["Netflix", "NFLX", "Netflix Inc.", "NetFlix", "Netflix Corporation"]')),
('Uber Technologies Inc', 'Transportation', 'USA', ('["Uber", "UBER", "Uber Technologies", "Uber Tech", "Uber Inc"]')),
('Airbnb Inc', 'Travel', 'USA', ('["Airbnb", "ABNB", "AirBnB", "Air BnB", "Airbnb Inc."]')),
('Snap Inc', 'Technology', 'USA', ('["Snapchat", "SNAP", "Snap", "Snap Inc.", "SnapChat"]')),
('Twitter Inc', 'Technology', 'USA', ('["Twitter", "X Corp", "TWTR", "X", "Twitter Inc."]')),
-- Consulting & Services
('Accenture plc', 'Consulting', 'Ireland', ('["Accenture", "ACN", "Accenture PLC", "Accenture Ltd", "Accenture Consulting"]')),
('Deloitte Touche Tohmatsu Limited', 'Consulting', 'UK', ('["Deloitte", "Deloitte & Touche", "Deloitte Touche", "DTT", "Deloitte Consulting"]')),
('McKinsey & Company', 'Consulting', 'USA', ('["McKinsey", "McK", "McKinsey and Company", "McKinsey & Co", "McKinseyCompany"]')),
('PricewaterhouseCoopers', 'Consulting', 'UK', ('["PwC", "PWC", "PricewaterhouseCoopers", "Price Waterhouse", "PriceWaterhouse Coopers"]')),
('Ernst & Young Global Limited', 'Consulting', 'UK', ('["EY", "Ernst Young", "Ernst & Young", "E&Y", "EY Global"]')),
-- Pharma
('Roche Holding AG', 'Pharmaceuticals', 'Switzerland', ('["Roche", "RHHBY", "Roche Holding", "Roche Group", "F. Hoffmann-La Roche"]')),
('Novartis AG', 'Pharmaceuticals', 'Switzerland', ('["Novartis", "NVS", "Novartis AG", "Novartis Pharma", "Novartis International"]')),
('Eli Lilly and Company', 'Pharmaceuticals', 'USA', ('["Eli Lilly", "LLY", "Lilly", "Eli Lilly & Co", "EliLilly"]')),
('AstraZeneca plc', 'Pharmaceuticals', 'UK', ('["AstraZeneca", "AZN", "Astra Zeneca", "AstraZeneca PLC", "AZ"]')),
('Sanofi SA', 'Pharmaceuticals', 'France', ('["Sanofi", "SNY", "Sanofi-Aventis", "Sanofi SA", "Sanofi Group"]')),
-- Industrial
('3M Company', 'Industrial', 'USA', ('["3M", "MMM", "3M Co", "Minnesota Mining", "Three M"]')),
('General Electric Company', 'Industrial', 'USA', ('["GE", "General Electric", "GenElectric", "GE Company", "G.E."]')),
('Siemens AG', 'Industrial', 'Germany', ('["Siemens", "SIEGY", "Siemens AG", "Siemens Corp", "Siemens Group"]')),
('Honeywell International Inc', 'Industrial', 'USA', ('["Honeywell", "HON", "Honeywell International", "Honeywell Inc", "Honeywell Corp"]')),
('Caterpillar Inc', 'Industrial', 'USA', ('["Caterpillar", "CAT", "Caterpillar Inc.", "Cat Inc", "Caterpillar Corp"]')),
-- Media
('The Walt Disney Company', 'Entertainment', 'USA', ('["Disney", "DIS", "Walt Disney", "The Walt Disney Co", "Disney Corp"]')),
('Warner Bros Discovery Inc', 'Entertainment', 'USA', ('["Warner Bros", "WBD", "Warner Brothers", "WarnerMedia", "Warner Discovery"]')),
('Sony Group Corporation', 'Entertainment', 'Japan', ('["Sony", "SONY", "Sony Corp", "Sony Group", "Sony Electronics"]')),
('Spotify Technology SA', 'Entertainment', 'Sweden', ('["Spotify", "SPOT", "Spotify Tech", "Spotify AB", "Spotify Technology"]')),
('Nintendo Co Ltd', 'Entertainment', 'Japan', ('["Nintendo", "NTDOY", "Nintendo Co", "Nintendo Corp", "Nintendo Ltd"]')),
-- Food & Agriculture
('Archer-Daniels-Midland Company', 'Agriculture', 'USA', ('["ADM", "Archer Daniels", "Archer-Daniels-Midland", "ADM Co", "Archer Daniels Midland"]')),
('Cargill Incorporated', 'Agriculture', 'USA', ('["Cargill", "Cargill Inc", "Cargill Corp", "Cargill Incorporated", "Cargill Group"]')),
('Tyson Foods Inc', 'Food', 'USA', ('["Tyson", "TSN", "Tyson Foods", "Tyson Inc", "Tyson Food"]')),
('General Mills Inc', 'Food', 'USA', ('["General Mills", "GIS", "Gen Mills", "GeneralMills", "General Mills Inc."]')),
('Kellogg Company', 'Food', 'USA', ('["Kellogg", "K", "Kelloggs", "Kellogg Co", "Kellogg Company"]')),
-- Logistics
('United Parcel Service Inc', 'Logistics', 'USA', ('["UPS", "United Parcel Service", "UPS Inc", "U.P.S.", "UPS Freight"]')),
('FedEx Corporation', 'Logistics', 'USA', ('["FedEx", "FDX", "Federal Express", "FedEx Corp", "Fed Ex"]')),
('DHL International GmbH', 'Logistics', 'Germany', ('["DHL", "DHL Express", "DHL International", "DHL Group", "D.H.L."]')),
('Maersk', 'Logistics', 'Denmark', ('["Maersk", "AP Moller-Maersk", "A.P. Moller Maersk", "Maersk Line", "AMKBY"]')),
('XPO Logistics Inc', 'Logistics', 'USA', ('["XPO", "XPO Logistics", "XPO Inc", "XPO Corp", "XPO Logistics Inc."]')),
-- Insurance
('Berkshire Hathaway Inc', 'Insurance', 'USA', ('["Berkshire Hathaway", "BRK", "Berkshire", "BerkshireHathaway", "BRK.A"]')),
('UnitedHealth Group', 'Insurance', 'USA', ('["UnitedHealthcare", "United Healthcare", "UHC", "United Health", "UnitedHealthGroup"]')),
('Cigna Group', 'Insurance', 'USA', ('["Cigna", "CI", "Cigna Corp", "The Cigna Group", "Cigna Health"]')),
('Anthem Inc', 'Insurance', 'USA', ('["Anthem", "Elevance Health", "ANTM", "Anthem Inc.", "Anthem Blue Cross"]')),
('Aetna Inc', 'Insurance', 'USA', ('["Aetna", "CVS Health", "AET", "Aetna Insurance", "Aetna Inc."]')),
-- Real Estate
('CBRE Group Inc', 'Real Estate', 'USA', ('["CBRE", "CBRE Group", "CB Richard Ellis", "CBRE Inc", "C.B.R.E."]')),
('Prologis Inc', 'Real Estate', 'USA', ('["Prologis", "PLD", "Prologis Inc.", "ProLogis", "Prologis REIT"]')),
('Simon Property Group Inc', 'Real Estate', 'USA', ('["Simon Property", "SPG", "Simon Property Group", "Simon Properties", "SimonProperty"]')),
('American Tower Corporation', 'Real Estate', 'USA', ('["American Tower", "AMT", "American Tower Corp", "AmericanTower", "ATC"]')),
('Realty Income Corporation', 'Real Estate', 'USA', ('["Realty Income", "O", "Realty Income Corp", "RealtyIncome", "Realty Income REIT"]')),
-- Software
('ServiceNow Inc', 'Software', 'USA', ('["ServiceNow", "NOW", "Service Now", "ServiceNow Inc.", "SNOW"]')),
('Workday Inc', 'Software', 'USA', ('["Workday", "WDAY", "Work Day", "Workday Inc.", "WorkDay"]')),
('Snowflake Inc', 'Software', 'USA', ('["Snowflake", "SNOW", "Snowflake Inc.", "Snow Flake", "Snowflake Computing"]')),
('Palantir Technologies Inc', 'Software', 'USA', ('["Palantir", "PLTR", "Palantir Technologies", "Palantir Tech", "PalantirTech"]')),
('Datadog Inc', 'Software', 'USA', ('["Datadog", "DDOG", "Data Dog", "DataDog", "Datadog Inc."]')),
-- Semiconductors
('Advanced Micro Devices Inc', 'Semiconductors', 'USA', ('["AMD", "Advanced Micro Devices", "Adv Micro Devices", "A.M.D.", "AMD Inc"]')),
('Qualcomm Incorporated', 'Semiconductors', 'USA', ('["Qualcomm", "QCOM", "Qualcomm Inc", "QualComm", "Qualcomm Corp"]')),
('Broadcom Inc', 'Semiconductors', 'USA', ('["Broadcom", "AVGO", "Broadcom Inc.", "BroadCom", "Broadcom Corp"]')),
('Texas Instruments Incorporated', 'Semiconductors', 'USA', ('["Texas Instruments", "TXN", "TI", "Texas Inst", "TexasInstruments"]')),
('Micron Technology Inc', 'Semiconductors', 'USA', ('["Micron", "MU", "Micron Technology", "Micron Tech", "Micron Corp"]')),
-- Banks (International)
('HSBC Holdings plc', 'Finance', 'UK', ('["HSBC", "HSBC Holdings", "Hong Kong Shanghai Banking", "HSBC Bank", "H.S.B.C."]')),
('Barclays plc', 'Finance', 'UK', ('["Barclays", "BCS", "Barclays Bank", "Barclays PLC", "Barclays Group"]')),
('Deutsche Bank AG', 'Finance', 'Germany', ('["Deutsche Bank", "DB", "DeutscheBank", "Deutsche Bank AG", "DBK"]')),
('BNP Paribas SA', 'Finance', 'France', ('["BNP Paribas", "BNP", "BNPQY", "BNP Paribas SA", "BNPParibas"]')),
('Credit Suisse Group AG', 'Finance', 'Switzerland', ('["Credit Suisse", "CS", "CreditSuisse", "Credit Suisse Group", "CSGN"]')),
-- Luxury & Fashion
('LVMH Moet Hennessy Louis Vuitton', 'Luxury', 'France', ('["LVMH", "Louis Vuitton", "LVMUY", "Moet Hennessy", "LV"]')),
('Hermes International SA', 'Luxury', 'France', ('["Hermes", "Hermès", "HESAY", "Hermes Paris", "Hermes International"]')),
('Nike Inc', 'Apparel', 'USA', ('["Nike", "NKE", "Nike Inc.", "NIKE", "Nike Corporation"]')),
('Adidas AG', 'Apparel', 'Germany', ('["Adidas", "ADDYY", "Adidas AG", "adidas", "Adidas Group"]')),
('Kering SA', 'Luxury', 'France', ('["Kering", "Gucci", "PPRUY", "Kering Group", "Kering SA"]')),
-- Crypto & Fintech
('Coinbase Global Inc', 'Fintech', 'USA', ('["Coinbase", "COIN", "Coinbase Global", "CoinBase", "Coinbase Inc"]')),
('Block Inc', 'Fintech', 'USA', ('["Block", "Square", "SQ", "Block Inc.", "Cash App"]')),
('PayPal Holdings Inc', 'Fintech', 'USA', ('["PayPal", "PYPL", "Pay Pal", "PayPal Holdings", "PayPal Inc"]')),
('Stripe Inc', 'Fintech', 'USA', ('["Stripe", "Stripe Inc.", "Stripe Payments", "Stripe Inc", "StripePay"]')),
('Robinhood Markets Inc', 'Fintech', 'USA', ('["Robinhood", "HOOD", "Robin Hood", "Robinhood Markets", "RobinHood"]')),
-- Biotech
('Moderna Inc', 'Biotech', 'USA', ('["Moderna", "MRNA", "Moderna Inc.", "ModernaTX", "Moderna Therapeutics"]')),
('BioNTech SE', 'Biotech', 'Germany', ('["BioNTech", "BNTX", "Bio N Tech", "BioNTech SE", "Biontech"]')),
('Regeneron Pharmaceuticals Inc', 'Biotech', 'USA', ('["Regeneron", "REGN", "Regeneron Pharma", "Regeneron Pharmaceuticals", "RegenPharma"]')),
('Gilead Sciences Inc', 'Biotech', 'USA', ('["Gilead", "GILD", "Gilead Sciences", "Gilead Inc", "Gilead Biosciences"]')),
('Amgen Inc', 'Biotech', 'USA', ('["Amgen", "AMGN", "Amgen Inc.", "AmGen", "Amgen Corporation"]')),
-- Cloud & SaaS
('Shopify Inc', 'Software', 'Canada', ('["Shopify", "SHOP", "Shopify Inc.", "Shop-ify", "Shopify Commerce"]')),
('Twilio Inc', 'Software', 'USA', ('["Twilio", "TWLO", "Twilio Inc.", "Twil.io", "Twilio Communications"]')),
('Atlassian Corporation', 'Software', 'Australia', ('["Atlassian", "TEAM", "Atlassian Corp", "Jira", "Atlassian Pty"]')),
('HubSpot Inc', 'Software', 'USA', ('["HubSpot", "HUBS", "Hub Spot", "HubSpot Inc.", "Hubspot"]')),
('Zoom Video Communications Inc', 'Software', 'USA', ('["Zoom", "ZM", "Zoom Video", "Zoom Communications", "ZoomVideo"]')),
-- Mining & Materials
('Rio Tinto Group', 'Mining', 'UK', ('["Rio Tinto", "RIO", "Rio Tinto PLC", "RioTinto", "Rio Tinto Group"]')),
('BHP Group Limited', 'Mining', 'Australia', ('["BHP", "BHP Billiton", "BHP Group", "BHPB", "BHP Ltd"]')),
('Vale SA', 'Mining', 'Brazil', ('["Vale", "VALE", "Vale SA", "Companhia Vale", "Vale Mining"]')),
('Freeport-McMoRan Inc', 'Mining', 'USA', ('["Freeport McMoRan", "FCX", "Freeport", "Freeport-McMoRan", "FreeportMcMoRan"]')),
('Newmont Corporation', 'Mining', 'USA', ('["Newmont", "NEM", "Newmont Mining", "Newmont Corp", "NewMont"]')),
-- Japanese Companies
('SoftBank Group Corp', 'Technology', 'Japan', ('["SoftBank", "SFTBY", "Soft Bank", "SoftBank Group", "SoftBankCorp"]')),
('Honda Motor Co Ltd', 'Automotive', 'Japan', ('["Honda", "HMC", "Honda Motor", "Honda Motors", "Honda Co"]')),
('Sony Interactive Entertainment', 'Entertainment', 'Japan', ('["PlayStation", "SIE", "Sony Interactive", "PS", "Sony IE"]')),
('Panasonic Holdings Corporation', 'Electronics', 'Japan', ('["Panasonic", "PCRFY", "Panasonic Corp", "Panasonic Holdings", "Matsushita"]')),
('Mitsubishi UFJ Financial Group', 'Finance', 'Japan', ('["MUFG", "Mitsubishi UFJ", "MUFG Bank", "Mitsubishi Financial", "MitsubishiUFJ"]')),
-- Chinese Companies
('Alibaba Group Holding Limited', 'Technology', 'China', ('["Alibaba", "BABA", "Ali Baba", "Alibaba Group", "AlibabaGroup"]')),
('Tencent Holdings Limited', 'Technology', 'China', ('["Tencent", "TCEHY", "Tencent Holdings", "Tencent Corp", "TenCent"]')),
('Baidu Inc', 'Technology', 'China', ('["Baidu", "BIDU", "Baidu Inc.", "Bai Du", "Baidu Corp"]')),
('JD.com Inc', 'Retail', 'China', ('["JD.com", "JD", "Jingdong", "JD Com", "JD.com Inc"]')),
('ByteDance Ltd', 'Technology', 'China', ('["ByteDance", "TikTok", "Byte Dance", "ByteDance Ltd", "ByteDanceLtd"]')),
-- Indian Companies
('Tata Consultancy Services Limited', 'Technology', 'India', ('["TCS", "Tata Consultancy", "Tata CS", "TCS Ltd", "Tata Consulting"]')),
('Infosys Limited', 'Technology', 'India', ('["Infosys", "INFY", "Infosys Ltd", "InfoSys", "Infosys Technologies"]')),
('Reliance Industries Limited', 'Conglomerate', 'India', ('["Reliance", "RIL", "Reliance Industries", "Reliance Ltd", "RelianceInd"]')),
('Wipro Limited', 'Technology', 'India', ('["Wipro", "WIT", "Wipro Ltd", "Wipro Technologies", "Wipro Infotech"]')),
('HDFC Bank Limited', 'Finance', 'India', ('["HDFC Bank", "HDFC", "HDB", "HDFC Ltd", "HDFCBank"]')),
-- Hospitality & Travel
('Marriott International Inc', 'Hospitality', 'USA', ('["Marriott", "MAR", "Marriott International", "Marriott Hotels", "Marriott Inc"]')),
('Hilton Worldwide Holdings Inc', 'Hospitality', 'USA', ('["Hilton", "HLT", "Hilton Hotels", "Hilton Worldwide", "Hilton Corp"]')),
('Booking Holdings Inc', 'Travel', 'USA', ('["Booking.com", "BKNG", "Priceline", "Booking Holdings", "Booking"]')),
('Expedia Group Inc', 'Travel', 'USA', ('["Expedia", "EXPE", "Expedia Group", "Expedia Inc", "Expedia Travel"]')),
('InterContinental Hotels Group plc', 'Hospitality', 'UK', ('["IHG", "InterContinental", "Inter Continental Hotels", "IHG Group", "Holiday Inn"]')),
-- Utilities
('NextEra Energy Inc', 'Utilities', 'USA', ('["NextEra", "NEE", "NextEra Energy", "Next Era", "FPL Group"]')),
('Duke Energy Corporation', 'Utilities', 'USA', ('["Duke Energy", "DUK", "Duke", "Duke Energy Corp", "DukeEnergy"]')),
('Southern Company', 'Utilities', 'USA', ('["Southern Company", "SO", "Southern Co", "The Southern Company", "SouthernCo"]')),
('Dominion Energy Inc', 'Utilities', 'USA', ('["Dominion Energy", "D", "Dominion", "Dominion Power", "DominionEnergy"]')),
('Enel SpA', 'Utilities', 'Italy', ('["Enel", "ENLAY", "Enel SpA", "Enel Group", "Enel Energy"]')),
-- Space & Defense (More)
('SpaceX', 'Aerospace', 'USA', ('["SpaceX", "Space X", "Space Exploration Technologies", "SpaceX Corp", "Starlink"]')),
('Blue Origin LLC', 'Aerospace', 'USA', ('["Blue Origin", "BlueOrigin", "Blue Origin LLC", "Blue Origin Space", "BO"]')),
('L3Harris Technologies Inc', 'Defense', 'USA', ('["L3Harris", "LHX", "L3 Harris", "Harris Corporation", "L3Harris Technologies"]')),
('BAE Systems plc', 'Defense', 'UK', ('["BAE Systems", "BAESY", "BAE", "BAE Systems PLC", "British Aerospace"]')),
('General Dynamics Corporation', 'Defense', 'USA', ('["General Dynamics", "GD", "GenDynamics", "General Dynamics Corp", "GD Corp"]')),
-- Media & Streaming
('Paramount Global', 'Entertainment', 'USA', ('["Paramount", "PARA", "ViacomCBS", "Paramount Plus", "Paramount Global"]')),
('Fox Corporation', 'Media', 'USA', ('["Fox", "FOXA", "Fox Corp", "Fox News", "Fox Corporation"]')),
('Lionsgate Entertainment Corp', 'Entertainment', 'USA', ('["Lionsgate", "LGF", "Lions Gate", "Lionsgate Films", "LionsGate"]')),
('Electronic Arts Inc', 'Gaming', 'USA', ('["EA", "Electronic Arts", "EA Games", "EA Sports", "ElectronicArts"]')),
('Activision Blizzard Inc', 'Gaming', 'USA', ('["Activision", "ATVI", "Activision Blizzard", "Blizzard", "ActiBlizz"]')),
-- Cybersecurity
('CrowdStrike Holdings Inc', 'Cybersecurity', 'USA', ('["CrowdStrike", "CRWD", "Crowd Strike", "CrowdStrike Holdings", "CrowdStrike Inc"]')),
('Palo Alto Networks Inc', 'Cybersecurity', 'USA', ('["Palo Alto Networks", "PANW", "PAN", "Palo Alto", "PaloAltoNetworks"]')),
('Fortinet Inc', 'Cybersecurity', 'USA', ('["Fortinet", "FTNT", "FortiNet", "Fortinet Inc.", "Fortinet Corp"]')),
('Zscaler Inc', 'Cybersecurity', 'USA', ('["Zscaler", "ZS", "Z Scaler", "Zscaler Inc.", "ZScaler"]')),
('Okta Inc', 'Cybersecurity', 'USA', ('["Okta", "OKTA", "Okta Inc.", "Okta Identity", "Okta Security"]')),
-- EV & Clean Energy
('Rivian Automotive Inc', 'Automotive', 'USA', ('["Rivian", "RIVN", "Rivian Automotive", "Rivian Motors", "Rivian Inc"]')),
('Lucid Group Inc', 'Automotive', 'USA', ('["Lucid", "LCID", "Lucid Motors", "Lucid Group", "Lucid Air"]')),
('NIO Inc', 'Automotive', 'China', ('["NIO", "NIO Inc", "Nio", "NIO Ltd", "NIO Cars"]')),
('Enphase Energy Inc', 'Clean Energy', 'USA', ('["Enphase", "ENPH", "Enphase Energy", "Enphase Inc", "EnphaseEnergy"]')),
('First Solar Inc', 'Clean Energy', 'USA', ('["First Solar", "FSLR", "FirstSolar", "First Solar Inc.", "First Solar Corp"]'));

-- =============================================================================
-- LOAD SEED DATA INTO ENTITIES AND ALIASES TABLES
-- =============================================================================

-- Insert canonical entities
INSERT INTO entities (canonical_name, entity_type, industry, country, metadata)
SELECT
    company_name,
    'COMPANY',
    industry,
    country,
    OBJECT_CONSTRUCT('source', 'seed_data', 'alias_count', ARRAY_SIZE(aliases))
FROM seed_companies;

-- Insert aliases (flatten the JSON array)
INSERT INTO entity_aliases (entity_id, alias_name, alias_type, name_normalized)
SELECT
    e.entity_id,
    a.value::VARCHAR,
    CASE
        WHEN LENGTH(a.value::VARCHAR) <= 5 THEN 'ABBREVIATION'
        WHEN a.value::VARCHAR = e.canonical_name THEN 'LEGAL'
        ELSE 'VARIATION'
    END,
    normalize_name(a.value::VARCHAR)
FROM seed_companies s
JOIN entities e ON e.canonical_name = s.company_name
, LATERAL FLATTEN(input => s.aliases) a;

-- Also insert the canonical name as an alias for unified search
INSERT INTO entity_aliases (entity_id, alias_name, alias_type, name_normalized)
SELECT
    entity_id,
    canonical_name,
    'LEGAL',
    normalize_name(canonical_name)
FROM entities;

-- =============================================================================
-- GENERATE EMBEDDINGS for all aliases
-- =============================================================================
-- NOTE: This uses Snowflake Cortex EMBED_TEXT_768 (e5-base-v2 model)
-- Cost: ~$0.0001 per embedding, ~1200 embeddings = ~$0.12



INSERT INTO entity_embeddings (entity_id, alias_id, source_text, embedding)
SELECT
    a.entity_id,
    a.alias_id,
    a.alias_name,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', a.alias_name)
FROM entity_aliases a;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
SELECT 'entities' AS table_name, COUNT(*) AS row_count FROM entities
UNION ALL
SELECT 'entity_aliases', COUNT(*) FROM entity_aliases
UNION ALL
SELECT 'entity_embeddings', COUNT(*) FROM entity_embeddings;

-- Sample data check
SELECT e.canonical_name, e.industry, COUNT(a.alias_id) AS alias_count
FROM entities e
JOIN entity_aliases a ON e.entity_id = a.entity_id
GROUP BY e.canonical_name, e.industry
ORDER BY alias_count DESC
LIMIT 10;
