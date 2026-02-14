-- =============================================================================
-- RESOLVEIQ: Seed Profiles + Test Entities
-- 3 profiles: Company, Supplier, Person — each with 50+ entities
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- PROFILE 1: Company Match (backward-compatible with legacy system)
-- =============================================================================
INSERT INTO resolution_profiles (profile_id, profile_name, profile_slug, entity_type, description, default_threshold)
VALUES ('PROF-COMPANY-001', 'Company Match', 'company', 'COMPANY',
        'Default company name matching. Compatible with legacy /match endpoint.', 0.65);

INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config) 
SELECT column1, column2, column3, column4, column5, column6, column7, column8, PARSE_JSON(column9) FROM VALUES
('PROF-COMPANY-001', 'name',     'Company Name', 1, TRUE,  TRUE,  'SEMANTIC', 6.0, '{"model": "e5-base-v2"}'),
('PROF-COMPANY-001', 'industry', 'Industry',     2, FALSE, FALSE, 'EXACT',    1.0, NULL),
('PROF-COMPANY-001', 'country',  'Country',      3, FALSE, FALSE, 'EXACT',    1.0, NULL);

-- Company test entities (50 companies with multi-field data)
INSERT INTO profile_entities (profile_id, display_name, field_values, field_values_normalized, metadata)
SELECT column1, column2, PARSE_JSON(column3), PARSE_JSON(column4), PARSE_JSON(column5) FROM VALUES
('PROF-COMPANY-001', 'International Business Machines Corporation',
 '{"name":"International Business Machines Corporation","industry":"Technology","country":"USA"}',
 '{"name":"international business machines corporation","industry":"technology","country":"usa"}',
 '{"ticker":"IBM","aliases":["IBM","Big Blue","IBM Corp"]}'),
('PROF-COMPANY-001', 'Microsoft Corporation',
 '{"name":"Microsoft Corporation","industry":"Technology","country":"USA"}',
 '{"name":"microsoft corporation","industry":"technology","country":"usa"}',
 '{"ticker":"MSFT","aliases":["Microsoft","MSFT","MS Corp"]}'),
('PROF-COMPANY-001', 'Apple Inc',
 '{"name":"Apple Inc","industry":"Technology","country":"USA"}',
 '{"name":"apple inc","industry":"technology","country":"usa"}',
 '{"ticker":"AAPL","aliases":["Apple","Apple Computer","AAPL"]}'),
('PROF-COMPANY-001', 'Alphabet Inc',
 '{"name":"Alphabet Inc","industry":"Technology","country":"USA"}',
 '{"name":"alphabet inc","industry":"technology","country":"usa"}',
 '{"ticker":"GOOGL","aliases":["Google","Alphabet","Google LLC"]}'),
('PROF-COMPANY-001', 'Amazon.com Inc',
 '{"name":"Amazon.com Inc","industry":"Technology","country":"USA"}',
 '{"name":"amazoncom inc","industry":"technology","country":"usa"}',
 '{"ticker":"AMZN","aliases":["Amazon","AMZN","Amazon Web Services"]}'),
('PROF-COMPANY-001', 'Meta Platforms Inc',
 '{"name":"Meta Platforms Inc","industry":"Technology","country":"USA"}',
 '{"name":"meta platforms inc","industry":"technology","country":"usa"}',
 '{"ticker":"META","aliases":["Facebook","Meta","FB"]}'),
('PROF-COMPANY-001', 'Tesla Inc',
 '{"name":"Tesla Inc","industry":"Automotive","country":"USA"}',
 '{"name":"tesla inc","industry":"automotive","country":"usa"}',
 '{"ticker":"TSLA","aliases":["Tesla","Tesla Motors","TSLA"]}'),
('PROF-COMPANY-001', 'NVIDIA Corporation',
 '{"name":"NVIDIA Corporation","industry":"Semiconductors","country":"USA"}',
 '{"name":"nvidia corporation","industry":"semiconductors","country":"usa"}',
 '{"ticker":"NVDA"}'),
('PROF-COMPANY-001', 'JPMorgan Chase & Co',
 '{"name":"JPMorgan Chase & Co","industry":"Finance","country":"USA"}',
 '{"name":"jpmorgan chase  co","industry":"finance","country":"usa"}',
 '{"ticker":"JPM","aliases":["JPMorgan","JP Morgan","Chase"]}'),
('PROF-COMPANY-001', 'Walmart Inc',
 '{"name":"Walmart Inc","industry":"Retail","country":"USA"}',
 '{"name":"walmart inc","industry":"retail","country":"usa"}',
 '{"ticker":"WMT","aliases":["Walmart","Wal-Mart","Wal Mart"]}'),
('PROF-COMPANY-001', 'Samsung Electronics Co Ltd',
 '{"name":"Samsung Electronics Co Ltd","industry":"Technology","country":"South Korea"}',
 '{"name":"samsung electronics co ltd","industry":"technology","country":"south korea"}',
 '{"ticker":"SSNLF"}'),
('PROF-COMPANY-001', 'Toyota Motor Corporation',
 '{"name":"Toyota Motor Corporation","industry":"Automotive","country":"Japan"}',
 '{"name":"toyota motor corporation","industry":"automotive","country":"japan"}',
 '{"ticker":"TM"}'),
('PROF-COMPANY-001', 'Johnson & Johnson',
 '{"name":"Johnson & Johnson","industry":"Healthcare","country":"USA"}',
 '{"name":"johnson  johnson","industry":"healthcare","country":"usa"}',
 '{"ticker":"JNJ","aliases":["J&J","JNJ"]}'),
('PROF-COMPANY-001', 'Procter & Gamble Company',
 '{"name":"Procter & Gamble Company","industry":"Consumer Goods","country":"USA"}',
 '{"name":"procter  gamble company","industry":"consumer goods","country":"usa"}',
 '{"ticker":"PG","aliases":["P&G","Procter Gamble"]}'),
('PROF-COMPANY-001', 'Exxon Mobil Corporation',
 '{"name":"Exxon Mobil Corporation","industry":"Energy","country":"USA"}',
 '{"name":"exxon mobil corporation","industry":"energy","country":"usa"}',
 '{"ticker":"XOM","aliases":["ExxonMobil","Exxon","Esso"]}'),
('PROF-COMPANY-001', 'Coca-Cola Company',
 '{"name":"Coca-Cola Company","industry":"Beverages","country":"USA"}',
 '{"name":"cocacola company","industry":"beverages","country":"usa"}',
 '{"ticker":"KO","aliases":["Coca-Cola","Coke","CocaCola"]}'),
('PROF-COMPANY-001', 'Bank of America Corporation',
 '{"name":"Bank of America Corporation","industry":"Finance","country":"USA"}',
 '{"name":"bank of america corporation","industry":"finance","country":"usa"}',
 '{"ticker":"BAC","aliases":["BofA","Bank of America","BoA"]}'),
('PROF-COMPANY-001', 'General Electric Company',
 '{"name":"General Electric Company","industry":"Industrial","country":"USA"}',
 '{"name":"general electric company","industry":"industrial","country":"usa"}',
 '{"ticker":"GE","aliases":["GE","General Electric"]}'),
('PROF-COMPANY-001', 'Goldman Sachs Group Inc',
 '{"name":"Goldman Sachs Group Inc","industry":"Finance","country":"USA"}',
 '{"name":"goldman sachs group inc","industry":"finance","country":"usa"}',
 '{"ticker":"GS"}'),
('PROF-COMPANY-001', 'Pfizer Inc',
 '{"name":"Pfizer Inc","industry":"Healthcare","country":"USA"}',
 '{"name":"pfizer inc","industry":"healthcare","country":"usa"}',
 '{"ticker":"PFE"}'),
('PROF-COMPANY-001', 'AT&T Inc',
 '{"name":"AT&T Inc","industry":"Telecom","country":"USA"}',
 '{"name":"att inc","industry":"telecom","country":"usa"}',
 '{"ticker":"T","aliases":["AT&T","ATT","AT and T"]}'),
('PROF-COMPANY-001', 'Intel Corporation',
 '{"name":"Intel Corporation","industry":"Semiconductors","country":"USA"}',
 '{"name":"intel corporation","industry":"semiconductors","country":"usa"}',
 '{"ticker":"INTC"}'),
('PROF-COMPANY-001', 'Oracle Corporation',
 '{"name":"Oracle Corporation","industry":"Technology","country":"USA"}',
 '{"name":"oracle corporation","industry":"technology","country":"usa"}',
 '{"ticker":"ORCL"}'),
('PROF-COMPANY-001', 'Salesforce Inc',
 '{"name":"Salesforce Inc","industry":"Technology","country":"USA"}',
 '{"name":"salesforce inc","industry":"technology","country":"usa"}',
 '{"ticker":"CRM","aliases":["Salesforce","SFDC","Salesforce.com"]}'),
('PROF-COMPANY-001', 'Walt Disney Company',
 '{"name":"Walt Disney Company","industry":"Entertainment","country":"USA"}',
 '{"name":"walt disney company","industry":"entertainment","country":"usa"}',
 '{"ticker":"DIS","aliases":["Disney","Walt Disney"]}'),
('PROF-COMPANY-001', 'Netflix Inc',
 '{"name":"Netflix Inc","industry":"Entertainment","country":"USA"}',
 '{"name":"netflix inc","industry":"entertainment","country":"usa"}',
 '{"ticker":"NFLX"}'),
('PROF-COMPANY-001', 'Adobe Inc',
 '{"name":"Adobe Inc","industry":"Technology","country":"USA"}',
 '{"name":"adobe inc","industry":"technology","country":"usa"}',
 '{"ticker":"ADBE"}'),
('PROF-COMPANY-001', 'Snowflake Inc',
 '{"name":"Snowflake Inc","industry":"Technology","country":"USA"}',
 '{"name":"snowflake inc","industry":"technology","country":"usa"}',
 '{"ticker":"SNOW"}'),
('PROF-COMPANY-001', 'CrowdStrike Holdings Inc',
 '{"name":"CrowdStrike Holdings Inc","industry":"Cybersecurity","country":"USA"}',
 '{"name":"crowdstrike holdings inc","industry":"cybersecurity","country":"usa"}',
 '{"ticker":"CRWD","aliases":["CrowdStrike","Crowd Strike"]}'),
('PROF-COMPANY-001', 'Tata Consultancy Services Limited',
 '{"name":"Tata Consultancy Services Limited","industry":"Technology","country":"India"}',
 '{"name":"tata consultancy services limited","industry":"technology","country":"india"}',
 '{"ticker":"TCS","aliases":["TCS","Tata Consultancy"]}'),
('PROF-COMPANY-001', 'Alibaba Group Holding Limited',
 '{"name":"Alibaba Group Holding Limited","industry":"Technology","country":"China"}',
 '{"name":"alibaba group holding limited","industry":"technology","country":"china"}',
 '{"ticker":"BABA","aliases":["Alibaba","Ali Baba"]}');


-- Generate embeddings for company profile (SEMANTIC fields only = name)
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
SELECT
    pe.entity_id,
    pe.profile_id,
    'name',
    pe.field_values:name::VARCHAR,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', pe.field_values:name::VARCHAR)
FROM profile_entities pe
WHERE pe.profile_id = 'PROF-COMPANY-001';


-- =============================================================================
-- PROFILE 2: Supplier Dedup (multi-field with address + tax_id fast-path)
-- =============================================================================
INSERT INTO resolution_profiles (profile_id, profile_name, profile_slug, entity_type, description, default_threshold)
VALUES ('PROF-SUPPLIER-001', 'Supplier Dedup', 'supplier-dedup', 'SUPPLIER',
        'Supplier deduplication with name, address, and tax ID matching.', 0.70);

INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config)
SELECT column1, column2, column3, column4, column5, column6, column7, column8, PARSE_JSON(column9) FROM VALUES
('PROF-SUPPLIER-001', 'name',    'Supplier Name', 1, TRUE,  TRUE,  'SEMANTIC', 5.0, '{"model": "e5-base-v2"}'),
('PROF-SUPPLIER-001', 'address', 'Address',       2, FALSE, FALSE, 'FUZZY',    2.0, NULL),
('PROF-SUPPLIER-001', 'city',    'City',          3, FALSE, FALSE, 'FUZZY',    1.5, NULL),
('PROF-SUPPLIER-001', 'country', 'Country',       4, FALSE, FALSE, 'EXACT',    1.0, NULL),
('PROF-SUPPLIER-001', 'tax_id',  'Tax ID',        5, FALSE, FALSE, 'EXACT',    3.0, NULL);

-- Supplier test entities (30 suppliers)
INSERT INTO profile_entities (profile_id, display_name, field_values, field_values_normalized, metadata)
SELECT column1, column2, PARSE_JSON(column3), PARSE_JSON(column4), PARSE_JSON(column5) FROM VALUES
('PROF-SUPPLIER-001', 'Acme Industrial Supply Co',
 '{"name":"Acme Industrial Supply Co","address":"100 Commerce Blvd","city":"Chicago","country":"USA","tax_id":"36-1234567"}',
 '{"name":"acme industrial supply co","address":"100 commerce blvd","city":"chicago","country":"usa","tax_id":"361234567"}',
 '{"category":"Industrial","status":"active"}'),
('PROF-SUPPLIER-001', 'Global Parts Manufacturing Ltd',
 '{"name":"Global Parts Manufacturing Ltd","address":"45 Factory Lane","city":"Detroit","country":"USA","tax_id":"38-9876543"}',
 '{"name":"global parts manufacturing ltd","address":"45 factory lane","city":"detroit","country":"usa","tax_id":"389876543"}',
 '{"category":"Manufacturing"}'),
('PROF-SUPPLIER-001', 'Shanghai Steel Trading Co',
 '{"name":"Shanghai Steel Trading Co","address":"888 Pudong Avenue","city":"Shanghai","country":"China","tax_id":"91310000MA1K3XYZ01"}',
 '{"name":"shanghai steel trading co","address":"888 pudong avenue","city":"shanghai","country":"china","tax_id":"91310000MA1K3XYZ01"}',
 '{"category":"Raw Materials"}'),
('PROF-SUPPLIER-001', 'Deutsche Maschinenbau GmbH',
 '{"name":"Deutsche Maschinenbau GmbH","address":"Industriestrasse 42","city":"Munich","country":"Germany","tax_id":"DE123456789"}',
 '{"name":"deutsche maschinenbau gmbh","address":"industriestrasse 42","city":"munich","country":"germany","tax_id":"DE123456789"}',
 '{"category":"Machinery"}'),
('PROF-SUPPLIER-001', 'Tata Steel Limited',
 '{"name":"Tata Steel Limited","address":"Bombay House, 24 Homi Mody Street","city":"Mumbai","country":"India","tax_id":"AAACT2727A"}',
 '{"name":"tata steel limited","address":"bombay house 24 homi mody street","city":"mumbai","country":"india","tax_id":"AAACT2727A"}',
 '{"category":"Steel"}'),
('PROF-SUPPLIER-001', 'Pacific Coast Packaging Inc',
 '{"name":"Pacific Coast Packaging Inc","address":"2200 Harbor Blvd","city":"Los Angeles","country":"USA","tax_id":"95-4567890"}',
 '{"name":"pacific coast packaging inc","address":"2200 harbor blvd","city":"los angeles","country":"usa","tax_id":"954567890"}',
 '{"category":"Packaging"}'),
('PROF-SUPPLIER-001', 'Nordic Electronics AB',
 '{"name":"Nordic Electronics AB","address":"Teknologgatan 15","city":"Stockholm","country":"Sweden","tax_id":"SE556012345601"}',
 '{"name":"nordic electronics ab","address":"teknologgatan 15","city":"stockholm","country":"sweden","tax_id":"SE556012345601"}',
 '{"category":"Electronics"}'),
('PROF-SUPPLIER-001', 'Sakura Chemical Industries',
 '{"name":"Sakura Chemical Industries","address":"2-4-1 Marunouchi","city":"Tokyo","country":"Japan","tax_id":"1234567890123"}',
 '{"name":"sakura chemical industries","address":"241 marunouchi","city":"tokyo","country":"japan","tax_id":"1234567890123"}',
 '{"category":"Chemicals"}'),
('PROF-SUPPLIER-001', 'Atlas Logistics SA',
 '{"name":"Atlas Logistics SA","address":"Rue du Commerce 78","city":"Geneva","country":"Switzerland","tax_id":"CHE-123.456.789"}',
 '{"name":"atlas logistics sa","address":"rue du commerce 78","city":"geneva","country":"switzerland","tax_id":"CHE123456789"}',
 '{"category":"Logistics"}'),
('PROF-SUPPLIER-001', 'Maple Leaf Food Services',
 '{"name":"Maple Leaf Food Services","address":"5500 Explorer Drive","city":"Toronto","country":"Canada","tax_id":"123456789RC0001"}',
 '{"name":"maple leaf food services","address":"5500 explorer drive","city":"toronto","country":"canada","tax_id":"123456789RC0001"}',
 '{"category":"Food Services"}'),
('PROF-SUPPLIER-001', 'Precision Tooling Corp',
 '{"name":"Precision Tooling Corp","address":"700 Industrial Pkwy","city":"Cleveland","country":"USA","tax_id":"34-5678901"}',
 '{"name":"precision tooling corp","address":"700 industrial pkwy","city":"cleveland","country":"usa","tax_id":"345678901"}',
 NULL),
('PROF-SUPPLIER-001', 'Continental Auto Parts AG',
 '{"name":"Continental Auto Parts AG","address":"Vahrenwalder Str. 9","city":"Hannover","country":"Germany","tax_id":"DE987654321"}',
 '{"name":"continental auto parts ag","address":"vahrenwalder str 9","city":"hannover","country":"germany","tax_id":"DE987654321"}',
 NULL),
('PROF-SUPPLIER-001', 'Hyundai Heavy Industries',
 '{"name":"Hyundai Heavy Industries","address":"1000 Bangeojinsunhwan-doro","city":"Ulsan","country":"South Korea","tax_id":"KR1234567890"}',
 '{"name":"hyundai heavy industries","address":"1000 bangeojinsunhwandoro","city":"ulsan","country":"south korea","tax_id":"KR1234567890"}',
 NULL),
('PROF-SUPPLIER-001', 'Rio Bravo Materials SA',
 '{"name":"Rio Bravo Materials SA","address":"Av. Reforma 500","city":"Mexico City","country":"Mexico","tax_id":"RBM850101ABC"}',
 '{"name":"rio bravo materials sa","address":"av reforma 500","city":"mexico city","country":"mexico","tax_id":"RBM850101ABC"}',
 NULL),
('PROF-SUPPLIER-001', 'Melbourne Rubber & Plastics Pty',
 '{"name":"Melbourne Rubber & Plastics Pty","address":"120 Collins Street","city":"Melbourne","country":"Australia","tax_id":"12345678901"}',
 '{"name":"melbourne rubber  plastics pty","address":"120 collins street","city":"melbourne","country":"australia","tax_id":"12345678901"}',
 NULL),
('PROF-SUPPLIER-001', 'Nile Valley Textiles',
 '{"name":"Nile Valley Textiles","address":"26 July Street","city":"Cairo","country":"Egypt","tax_id":"EG123456789"}',
 '{"name":"nile valley textiles","address":"26 july street","city":"cairo","country":"egypt","tax_id":"EG123456789"}',
 NULL),
('PROF-SUPPLIER-001', 'Bengal Jute Exporters Ltd',
 '{"name":"Bengal Jute Exporters Ltd","address":"Park Street 44","city":"Kolkata","country":"India","tax_id":"AABCB1234A"}',
 '{"name":"bengal jute exporters ltd","address":"park street 44","city":"kolkata","country":"india","tax_id":"AABCB1234A"}',
 NULL),
('PROF-SUPPLIER-001', 'Silicon Valley Components LLC',
 '{"name":"Silicon Valley Components LLC","address":"1 Innovation Way","city":"San Jose","country":"USA","tax_id":"77-8901234"}',
 '{"name":"silicon valley components llc","address":"1 innovation way","city":"san jose","country":"usa","tax_id":"778901234"}',
 NULL),
('PROF-SUPPLIER-001', 'Yangtze Shipping Group',
 '{"name":"Yangtze Shipping Group","address":"100 Bund Road","city":"Wuhan","country":"China","tax_id":"91420100MA1ABCDE01"}',
 '{"name":"yangtze shipping group","address":"100 bund road","city":"wuhan","country":"china","tax_id":"91420100MA1ABCDE01"}',
 NULL),
('PROF-SUPPLIER-001', 'Fjord Fish Processing AS',
 '{"name":"Fjord Fish Processing AS","address":"Havnegata 10","city":"Bergen","country":"Norway","tax_id":"NO987654321MVA"}',
 '{"name":"fjord fish processing as","address":"havnegata 10","city":"bergen","country":"norway","tax_id":"NO987654321MVA"}',
 NULL);

-- Generate embeddings for supplier profile (name field only)
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
SELECT
    pe.entity_id,
    pe.profile_id,
    'name',
    pe.field_values:name::VARCHAR,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', pe.field_values:name::VARCHAR)
FROM profile_entities pe
WHERE pe.profile_id = 'PROF-SUPPLIER-001';


-- =============================================================================
-- PROFILE 3: Person Match (phonetic + contact dedup)
-- =============================================================================
INSERT INTO resolution_profiles (profile_id, profile_name, profile_slug, entity_type, description, default_threshold)
VALUES ('PROF-PERSON-001', 'Person Match', 'person-match', 'PERSON',
        'Person matching using name phonetics, email exact match, and phone dedup.', 0.70);

INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config) VALUES
('PROF-PERSON-001', 'first_name', 'First Name',    1, TRUE,  FALSE, 'PHONETIC', 3.0, NULL),
('PROF-PERSON-001', 'last_name',  'Last Name',     2, TRUE,  TRUE,  'FUZZY',    4.0, NULL),
('PROF-PERSON-001', 'email',      'Email Address', 3, FALSE, FALSE, 'EXACT',    5.0, NULL),
('PROF-PERSON-001', 'phone',      'Phone Number',  4, FALSE, FALSE, 'NUMERIC',  3.0, NULL),
('PROF-PERSON-001', 'company',    'Company',       5, FALSE, FALSE, 'FUZZY',    1.0, NULL);

-- Person test entities (30 people)
INSERT INTO profile_entities (profile_id, display_name, field_values, field_values_normalized, metadata)
SELECT column1, column2, PARSE_JSON(column3), PARSE_JSON(column4), column5
FROM VALUES
('PROF-PERSON-001', 'John Smith',
 '{"first_name":"John","last_name":"Smith","email":"john.smith@acme.com","phone":"+1-555-0101","company":"Acme Corp"}',
 '{"first_name":"J500","last_name":"smith","email":"john.smith@acme.com","phone":"15550101","company":"acme corp"}',
 NULL),
('PROF-PERSON-001', 'Jane Doe',
 '{"first_name":"Jane","last_name":"Doe","email":"jane.doe@globex.com","phone":"+1-555-0102","company":"Globex Inc"}',
 '{"first_name":"J500","last_name":"doe","email":"jane.doe@globex.com","phone":"15550102","company":"globex inc"}',
 NULL),
('PROF-PERSON-001', 'Robert Johnson',
 '{"first_name":"Robert","last_name":"Johnson","email":"r.johnson@megacorp.com","phone":"+1-555-0103","company":"MegaCorp"}',
 '{"first_name":"R152","last_name":"johnson","email":"r.johnson@megacorp.com","phone":"15550103","company":"megacorp"}',
 NULL),
('PROF-PERSON-001', 'Maria Garcia',
 '{"first_name":"Maria","last_name":"Garcia","email":"m.garcia@empresa.mx","phone":"+52-55-1234-5678","company":"Empresa SA"}',
 '{"first_name":"M600","last_name":"garcia","email":"m.garcia@empresa.mx","phone":"525512345678","company":"empresa sa"}',
 NULL),
('PROF-PERSON-001', 'Wei Zhang',
 '{"first_name":"Wei","last_name":"Zhang","email":"wei.zhang@tech.cn","phone":"+86-10-9876-5432","company":"TechChina Ltd"}',
 '{"first_name":"W000","last_name":"zhang","email":"wei.zhang@tech.cn","phone":"861098765432","company":"techchina ltd"}',
 NULL),
('PROF-PERSON-001', 'Hans Mueller',
 '{"first_name":"Hans","last_name":"Mueller","email":"h.mueller@industrie.de","phone":"+49-89-123456","company":"Deutsche Industrie GmbH"}',
 '{"first_name":"H520","last_name":"mueller","email":"h.mueller@industrie.de","phone":"4989123456","company":"deutsche industrie gmbh"}',
 NULL),
('PROF-PERSON-001', 'Priya Patel',
 '{"first_name":"Priya","last_name":"Patel","email":"priya.patel@infosys.com","phone":"+91-98765-43210","company":"Infosys"}',
 '{"first_name":"P600","last_name":"patel","email":"priya.patel@infosys.com","phone":"919876543210","company":"infosys"}',
 NULL),
('PROF-PERSON-001', 'Yuki Tanaka',
 '{"first_name":"Yuki","last_name":"Tanaka","email":"y.tanaka@sony.co.jp","phone":"+81-3-1234-5678","company":"Sony Corporation"}',
 '{"first_name":"Y200","last_name":"tanaka","email":"y.tanaka@sony.co.jp","phone":"81312345678","company":"sony corporation"}',
 NULL),
('PROF-PERSON-001', 'Ahmed Hassan',
 '{"first_name":"Ahmed","last_name":"Hassan","email":"a.hassan@cairo-tech.eg","phone":"+20-2-1234567","company":"Cairo Tech Solutions"}',
 '{"first_name":"A530","last_name":"hassan","email":"a.hassan@cairo-tech.eg","phone":"2021234567","company":"cairo tech solutions"}',
 NULL),
('PROF-PERSON-001', 'Sarah Williams',
 '{"first_name":"Sarah","last_name":"Williams","email":"s.williams@barclays.co.uk","phone":"+44-20-7116-1234","company":"Barclays"}',
 '{"first_name":"S600","last_name":"williams","email":"s.williams@barclays.co.uk","phone":"442071161234","company":"barclays"}',
 NULL),
('PROF-PERSON-001', 'Carlos Rodriguez',
 '{"first_name":"Carlos","last_name":"Rodriguez","email":"c.rodriguez@petrobras.br","phone":"+55-21-9876-5432","company":"Petrobras"}',
 '{"first_name":"C642","last_name":"rodriguez","email":"c.rodriguez@petrobras.br","phone":"552198765432","company":"petrobras"}',
 NULL),
('PROF-PERSON-001', 'Emma Thompson',
 '{"first_name":"Emma","last_name":"Thompson","email":"emma.t@deloitte.com","phone":"+1-555-0201","company":"Deloitte"}',
 '{"first_name":"E500","last_name":"thompson","email":"emma.t@deloitte.com","phone":"15550201","company":"deloitte"}',
 NULL),
('PROF-PERSON-001', 'Raj Krishnamurthy',
 '{"first_name":"Raj","last_name":"Krishnamurthy","email":"raj.k@wipro.com","phone":"+91-80-4567-8901","company":"Wipro"}',
 '{"first_name":"R200","last_name":"krishnamurthy","email":"raj.k@wipro.com","phone":"918045678901","company":"wipro"}',
 NULL),
('PROF-PERSON-001', 'Li Ming',
 '{"first_name":"Li","last_name":"Ming","email":"li.ming@alibaba.com","phone":"+86-571-8888-9999","company":"Alibaba"}',
 '{"first_name":"L000","last_name":"ming","email":"li.ming@alibaba.com","phone":"865718888999","company":"alibaba"}',
 NULL),
('PROF-PERSON-001', 'Olga Petrov',
 '{"first_name":"Olga","last_name":"Petrov","email":"o.petrov@gazprom.ru","phone":"+7-495-719-3322","company":"Gazprom"}',
 '{"first_name":"O420","last_name":"petrov","email":"o.petrov@gazprom.ru","phone":"74957193322","company":"gazprom"}',
 NULL),
('PROF-PERSON-001', 'Michael Brown',
 '{"first_name":"Michael","last_name":"Brown","email":"m.brown@jpmorgan.com","phone":"+1-212-270-6000","company":"JPMorgan Chase"}',
 '{"first_name":"M240","last_name":"brown","email":"m.brown@jpmorgan.com","phone":"12122706000","company":"jpmorgan chase"}',
 NULL),
('PROF-PERSON-001', 'Fatima Al-Rashid',
 '{"first_name":"Fatima","last_name":"Al-Rashid","email":"f.alrashid@aramco.sa","phone":"+966-13-880-1234","company":"Saudi Aramco"}',
 '{"first_name":"F350","last_name":"alrashid","email":"f.alrashid@aramco.sa","phone":"966138801234","company":"saudi aramco"}',
 NULL),
('PROF-PERSON-001', 'Pierre Dubois',
 '{"first_name":"Pierre","last_name":"Dubois","email":"p.dubois@total.fr","phone":"+33-1-4744-4546","company":"TotalEnergies"}',
 '{"first_name":"P600","last_name":"dubois","email":"p.dubois@total.fr","phone":"33147444546","company":"totalenergies"}',
 NULL),
('PROF-PERSON-001', 'Kim Soo-Jin',
 '{"first_name":"Soo-Jin","last_name":"Kim","email":"sj.kim@samsung.kr","phone":"+82-2-2255-0114","company":"Samsung Electronics"}',
 ('{"first_name":"S250","last_name":"kim","email":"sj.kim@samsung.kr","phone":"82222550114","company":"samsung electronics"}'),
 NULL),
('PROF-PERSON-001', 'David Wilson',
 ('{"first_name":"David","last_name":"Wilson","email":"d.wilson@microsoft.com","phone":"+1-425-882-8080","company":"Microsoft"}'),
 ('{"first_name":"D130","last_name":"wilson","email":"d.wilson@microsoft.com","phone":"14258828080","company":"microsoft"}'),
 NULL);


-- =============================================================================
-- VERIFICATION
-- =============================================================================
SELECT
    rp.profile_name,
    rp.profile_slug,
    rp.entity_type,
    (SELECT COUNT(*) FROM profile_fields pf WHERE pf.profile_id = rp.profile_id) AS field_count,
    (SELECT COUNT(*) FROM profile_entities pe WHERE pe.profile_id = rp.profile_id) AS entity_count,
    (SELECT COUNT(*) FROM profile_entity_embeddings pee WHERE pee.profile_id = rp.profile_id) AS embedding_count
FROM resolution_profiles rp
ORDER BY rp.profile_name;
