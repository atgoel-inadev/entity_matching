-- =============================================================================
-- RESOLVEIQ: B2B Payment Domain Seed Data
-- Buyer and Supplier Entities for Payment Processing & Reconciliation
-- =============================================================================
-- This script creates realistic B2B payment domain entities:
--   - Buyer Profile: Companies making payments (AP perspective)
--   - Supplier Profile: Companies receiving payments (AR perspective)
--   - Fields: Tax IDs, bank details, payment terms, credit info
-- =============================================================================

USE ROLE SNOWFLAKE_LEARNING_ROLE;
USE WAREHOUSE SNOWFLAKE_LEARNING_WH;
USE DATABASE SNOWFLAKE_LEARNING_DB;
USE SCHEMA ENTITY_MATCHING;

-- =============================================================================
-- PROFILE: BUYER ENTITIES (AP/Payer Perspective)
-- =============================================================================
INSERT INTO resolution_profiles (profile_id, profile_name, profile_slug, entity_type, description, default_threshold)
VALUES ('PROF-BUYER-B2B-001', 'B2B Buyer Match', 'b2b-buyer', 'BUYER',
        'Buyer/Payer entity matching for accounts payable and payment processing. Matches on company name, tax ID, and payment account details.', 0.75);

INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config)
SELECT column1, column2, column3, column4, column5, column6, column7, column8, PARSE_JSON(column9) FROM VALUES
('PROF-BUYER-B2B-001', 'buyer_name',        'Buyer Company Name',    1,  TRUE,  TRUE,  'SEMANTIC', 5.0, '{"model": "e5-base-v2"}'),
('PROF-BUYER-B2B-001', 'tax_id',            'Tax ID / VAT Number',   2,  FALSE, FALSE, 'EXACT',    4.0, NULL),
('PROF-BUYER-B2B-001', 'duns_number',       'DUNS Number',           3,  FALSE, FALSE, 'EXACT',    3.0, NULL),
('PROF-BUYER-B2B-001', 'billing_address',   'Billing Address',       4,  FALSE, FALSE, 'FUZZY',    2.0, NULL),
('PROF-BUYER-B2B-001', 'city',              'City',                  5,  FALSE, FALSE, 'FUZZY',    1.5, NULL),
('PROF-BUYER-B2B-001', 'state',             'State/Province',        6,  FALSE, FALSE, 'EXACT',    1.0, NULL),
('PROF-BUYER-B2B-001', 'country',           'Country',               7,  FALSE, FALSE, 'EXACT',    1.5, NULL),
('PROF-BUYER-B2B-001', 'postal_code',       'Postal Code',           8,  FALSE, FALSE, 'EXACT',    1.0, NULL),
('PROF-BUYER-B2B-001', 'bank_account_last4','Bank Account (Last 4)', 9,  FALSE, FALSE, 'EXACT',    2.0, NULL),
('PROF-BUYER-B2B-001', 'payment_email',     'Payment Email',         10, FALSE, FALSE, 'EXACT',    2.5, NULL);

-- Buyer Entities: 50+ realistic B2B payment buyers across industries
INSERT INTO profile_entities (profile_id, display_name, field_values, field_values_normalized, metadata)
SELECT column1, column2, PARSE_JSON(column3), PARSE_JSON(column4), PARSE_JSON(column5) FROM VALUES
('PROF-BUYER-B2B-001', 'Acme Manufacturing Inc',
 '{"buyer_name":"Acme Manufacturing Inc","tax_id":"36-1234567","duns_number":"123456789","billing_address":"500 Industrial Pkwy","city":"Chicago","state":"IL","country":"USA","postal_code":"60601","bank_account_last4":"4567","payment_email":"ap@acme-mfg.com"}',
 '{"buyer_name":"acme manufacturing inc","tax_id":"361234567","duns_number":"123456789","billing_address":"500 industrial pkwy","city":"chicago","state":"il","country":"usa","postal_code":"60601","bank_account_last4":"4567","payment_email":"ap@acme-mfg.com"}',
 '{"payment_terms":"Net 30","credit_limit":500000,"industry":"Manufacturing","salesforce_id":"001XX000003AAAA"}'),

('PROF-BUYER-B2B-001', 'TechCorp Solutions LLC',
 '{"buyer_name":"TechCorp Solutions LLC","tax_id":"94-7654321","duns_number":"987654321","billing_address":"1200 Innovation Drive","city":"San Francisco","state":"CA","country":"USA","postal_code":"94103","bank_account_last4":"8901","payment_email":"accounts.payable@techcorp.com"}',
 '{"buyer_name":"techcorp solutions llc","tax_id":"947654321","duns_number":"987654321","billing_address":"1200 innovation drive","city":"san francisco","state":"ca","country":"usa","postal_code":"94103","bank_account_last4":"8901","payment_email":"accounts.payable@techcorp.com"}',
 '{"payment_terms":"Net 45","credit_limit":1000000,"industry":"Technology","salesforce_id":"001XX000003BBBB"}'),

('PROF-BUYER-B2B-001', 'Global Retail Group',
 '{"buyer_name":"Global Retail Group","tax_id":"22-3456789","duns_number":"456789123","billing_address":"800 Commerce Blvd","city":"New York","state":"NY","country":"USA","postal_code":"10001","bank_account_last4":"2345","payment_email":"payables@globalretail.com"}',
 '{"buyer_name":"global retail group","tax_id":"223456789","duns_number":"456789123","billing_address":"800 commerce blvd","city":"new york","state":"ny","country":"usa","postal_code":"10001","bank_account_last4":"2345","payment_email":"payables@globalretail.com"}',
 '{"payment_terms":"Net 60","credit_limit":2500000,"industry":"Retail","salesforce_id":"001XX000003CCCC"}'),

('PROF-BUYER-B2B-001', 'Metro Healthcare Systems',
 '{"buyer_name":"Metro Healthcare Systems","tax_id":"13-9876543","duns_number":"321654987","billing_address":"45 Hospital Plaza","city":"Boston","state":"MA","country":"USA","postal_code":"02101","bank_account_last4":"6789","payment_email":"billing@metrohealthcare.org"}',
 '{"buyer_name":"metro healthcare systems","tax_id":"139876543","duns_number":"321654987","billing_address":"45 hospital plaza","city":"boston","state":"ma","country":"usa","postal_code":"02101","bank_account_last4":"6789","payment_email":"billing@metrohealthcare.org"}',
 '{"payment_terms":"Net 30","credit_limit":750000,"industry":"Healthcare","salesforce_id":"001XX000003DDDD"}'),

('PROF-BUYER-B2B-001', 'Pacific Logistics Partners',
 '{"buyer_name":"Pacific Logistics Partners","tax_id":"91-5678901","billing_address":"2200 Harbor Way","city":"Seattle","state":"WA","country":"USA","postal_code":"98101","bank_account_last4":"3456","payment_email":"ap@paclog.com"}',
 '{"buyer_name":"pacific logistics partners","tax_id":"915678901","billing_address":"2200 harbor way","city":"seattle","state":"wa","country":"usa","postal_code":"98101","bank_account_last4":"3456","payment_email":"ap@paclog.com"}',
 '{"payment_terms":"Net 45","credit_limit":400000,"industry":"Logistics","salesforce_id":"001XX000003EEEE"}'),

('PROF-BUYER-B2B-001', 'Atlantic Energy Corporation',
 '{"buyer_name":"Atlantic Energy Corporation","tax_id":"52-1234567","duns_number":"111222333","billing_address":"1000 Power Plant Rd","city":"Houston","state":"TX","country":"USA","postal_code":"77002","bank_account_last4":"7890","payment_email":"procurement@atlanticenergy.com"}',
 '{"buyer_name":"atlantic energy corporation","tax_id":"521234567","duns_number":"111222333","billing_address":"1000 power plant rd","city":"houston","state":"tx","country":"usa","postal_code":"77002","bank_account_last4":"7890","payment_email":"procurement@atlanticenergy.com"}',
 '{"payment_terms":"Net 30","credit_limit":5000000,"industry":"Energy","salesforce_id":"001XX000003FFFF"}'),

('PROF-BUYER-B2B-001', 'Midwest Food Distributors',
 '{"buyer_name":"Midwest Food Distributors","tax_id":"38-9012345","billing_address":"350 Distribution Center Dr","city":"Minneapolis","state":"MN","country":"USA","postal_code":"55401","bank_account_last4":"1234","payment_email":"ap@midwestfood.com"}',
 '{"buyer_name":"midwest food distributors","tax_id":"389012345","billing_address":"350 distribution center dr","city":"minneapolis","state":"mn","country":"usa","postal_code":"55401","bank_account_last4":"1234","payment_email":"ap@midwestfood.com"}',
 '{"payment_terms":"Net 15","credit_limit":800000,"industry":"Food Distribution","salesforce_id":"001XX000003GGGG"}'),

('PROF-BUYER-B2B-001', 'Deutsche Bank AG',
 '{"buyer_name":"Deutsche Bank AG","tax_id":"DE123456789","duns_number":"314159265","billing_address":"Taunusanlage 12","city":"Frankfurt","state":"HE","country":"Germany","postal_code":"60325","bank_account_last4":"9876","payment_email":"accounts.payable@db.com"}',
 '{"buyer_name":"deutsche bank ag","tax_id":"de123456789","billing_address":"taunusanlage 12","city":"frankfurt","state":"he","country":"germany","postal_code":"60325","bank_account_last4":"9876","payment_email":"accounts.payable@db.com"}',
 '{"payment_terms":"Net 30","credit_limit":10000000,"industry":"Financial Services","salesforce_id":"001XX000003HHHH"}'),

('PROF-BUYER-B2B-001', 'Fujitsu Limited',
 '{"buyer_name":"Fujitsu Limited","tax_id":"JP1234567890123","billing_address":"Shiodome City Center, 1-5-2 Higashi-Shimbashi","city":"Tokyo","state":"Tokyo","country":"Japan","postal_code":"105-7123","bank_account_last4":"5432","payment_email":"payment@fujitsu.co.jp"}',
 '{"buyer_name":"fujitsu limited","tax_id":"jp1234567890123","billing_address":"shiodome city center 152 higashishimbashi","city":"tokyo","state":"tokyo","country":"japan","postal_code":"1057123","bank_account_last4":"5432","payment_email":"payment@fujitsu.co.jp"}',
 '{"payment_terms":"Net 60","credit_limit":3000000,"industry":"Technology","salesforce_id":"001XX000003IIII"}'),

('PROF-BUYER-B2B-001', 'Tesco PLC',
 '{"buyer_name":"Tesco PLC","tax_id":"GB123456789","duns_number":"444555666","billing_address":"Tesco House, Shire Park","city":"Welwyn Garden City","state":"Hertfordshire","country":"United Kingdom","postal_code":"AL7 1GA","bank_account_last4":"6543","payment_email":"supplier.payments@tesco.com"}',
 '{"buyer_name":"tesco plc","tax_id":"gb123456789","duns_number":"444555666","billing_address":"tesco house shire park","city":"welwyn garden city","state":"hertfordshire","country":"united kingdom","postal_code":"al71ga","bank_account_last4":"6543","payment_email":"supplier.payments@tesco.com"}',
 '{"payment_terms":"Net 90","credit_limit":5000000,"industry":"Retail","salesforce_id":"001XX000003JJJJ"}'),

('PROF-BUYER-B2B-001', 'Samsung Electronics Co Ltd',
 '{"buyer_name":"Samsung Electronics Co Ltd","tax_id":"KR1234567890","billing_address":"129 Samsung-ro, Yeongtong-gu","city":"Suwon","state":"Gyeonggi-do","country":"South Korea","postal_code":"16677","bank_account_last4":"8765","payment_email":"procurement@samsung.com"}',
 '{"buyer_name":"samsung electronics co ltd","tax_id":"kr1234567890","billing_address":"129 samsungro yeongtonggu","city":"suwon","state":"gyeonggido","country":"south korea","postal_code":"16677","bank_account_last4":"8765","payment_email":"procurement@samsung.com"}',
 '{"payment_terms":"Net 45","credit_limit":8000000,"industry":"Electronics","salesforce_id":"001XX000003KKKK"}'),

('PROF-BUYER-B2B-001', 'Bharti Airtel Limited',
 '{"buyer_name":"Bharti Airtel Limited","tax_id":"AAACB1234A","billing_address":"Bharti Crescent, 1 Nelson Mandela Road","city":"New Delhi","state":"Delhi","country":"India","postal_code":"110070","bank_account_last4":"2109","payment_email":"vendors@airtel.in"}',
 '{"buyer_name":"bharti airtel limited","tax_id":"aaacb1234a","billing_address":"bharti crescent 1 nelson mandela road","city":"new delhi","state":"delhi","country":"india","postal_code":"110070","bank_account_last4":"2109","payment_email":"vendors@airtel.in"}',
 '{"payment_terms":"Net 30","credit_limit":2000000,"industry":"Telecommunications","salesforce_id":"001XX000003LLLL"}'),

('PROF-BUYER-B2B-001', 'Petrobras SA',
 '{"buyer_name":"Petrobras SA","tax_id":"BR33000167000101","billing_address":"Av. República do Chile, 65","city":"Rio de Janeiro","state":"RJ","country":"Brazil","postal_code":"20031-912","bank_account_last4":"3210","payment_email":"fornecedores@petrobras.com.br"}',
 '{"buyer_name":"petrobras sa","tax_id":"br33000167000101","billing_address":"av republica do chile 65","city":"rio de janeiro","state":"rj","country":"brazil","postal_code":"20031912","bank_account_last4":"3210","payment_email":"fornecedores@petrobras.com.br"}',
 '{"payment_terms":"Net 60","credit_limit":15000000,"industry":"Oil & Gas","salesforce_id":"001XX000003MMMM"}'),

('PROF-BUYER-B2B-001', 'Commonwealth Bank of Australia',
 '{"buyer_name":"Commonwealth Bank of Australia","tax_id":"AU123456789","billing_address":"Tower 1, 201 Sussex Street","city":"Sydney","state":"NSW","country":"Australia","postal_code":"2000","bank_account_last4":"4321","payment_email":"accounts.payable@cba.com.au"}',
 '{"buyer_name":"commonwealth bank of australia","tax_id":"au123456789","billing_address":"tower 1 201 sussex street","city":"sydney","state":"nsw","country":"australia","postal_code":"2000","bank_account_last4":"4321","payment_email":"accounts.payable@cba.com.au"}',
 '{"payment_terms":"Net 30","credit_limit":6000000,"industry":"Banking","salesforce_id":"001XX000003NNNN"}'),

('PROF-BUYER-B2B-001', 'Air Canada',
 '{"buyer_name":"Air Canada","tax_id":"CA123456789RC0001","billing_address":"7373 Côte-Vertu Blvd West","city":"Montreal","state":"QC","country":"Canada","postal_code":"H4Y 1H4","bank_account_last4":"5678","payment_email":"supplier.payments@aircanada.ca"}',
 '{"buyer_name":"air canada","tax_id":"ca123456789rc0001","billing_address":"7373 cotevertu blvd west","city":"montreal","state":"qc","country":"canada","postal_code":"h4y1h4","bank_account_last4":"5678","payment_email":"supplier.payments@aircanada.ca"}',
 '{"payment_terms":"Net 45","credit_limit":1200000,"industry":"Airlines","salesforce_id":"001XX000003OOOO"}'),

('PROF-BUYER-B2B-001', 'Nestlé SA',
 '{"buyer_name":"Nestlé SA","tax_id":"CHE-123.456.789","billing_address":"Avenue Nestlé 55","city":"Vevey","state":"Vaud","country":"Switzerland","postal_code":"1800","bank_account_last4":"9012","payment_email":"procure.to.pay@nestle.com"}',
 '{"buyer_name":"nestle sa","tax_id":"che123456789","billing_address":"avenue nestle 55","city":"vevey","state":"vaud","country":"switzerland","postal_code":"1800","bank_account_last4":"9012","payment_email":"procure.to.pay@nestle.com"}',
 '{"payment_terms":"Net 60","credit_limit":7500000,"industry":"Food & Beverage","salesforce_id":"001XX000003PPPP"}'),

('PROF-BUYER-B2B-001', 'Volkswagen AG',
 '{"buyer_name":"Volkswagen AG","tax_id":"DE123456788","billing_address":"Berliner Ring 2","city":"Wolfsburg","state":"Lower Saxony","country":"Germany","postal_code":"38440","bank_account_last4":"3456","payment_email":"lieferanten@volkswagen.de"}',
 '{"buyer_name":"volkswagen ag","tax_id":"de123456788","billing_address":"berliner ring 2","city":"wolfsburg","state":"lower saxony","country":"germany","postal_code":"38440","bank_account_last4":"3456","payment_email":"lieferanten@volkswagen.de"}',
 '{"payment_terms":"Net 90","credit_limit":20000000,"industry":"Automotive","salesforce_id":"001XX000003QQQQ"}'),

('PROF-BUYER-B2B-001', 'Unilever PLC',
 '{"buyer_name":"Unilever PLC","tax_id":"GB123456780","billing_address":"100 Victoria Embankment","city":"London","state":"Greater London","country":"United Kingdom","postal_code":"EC4Y 0DY","bank_account_last4":"7654","payment_email":"supplier.invoices@unilever.com"}',
 '{"buyer_name":"unilever plc","tax_id":"gb123456780","billing_address":"100 victoria embankment","city":"london","state":"greater london","country":"united kingdom","postal_code":"ec4y0dy","bank_account_last4":"7654","payment_email":"supplier.invoices@unilever.com"}',
 '{"payment_terms":"Net 60","credit_limit":5000000,"industry":"Consumer Goods","salesforce_id":"001XX000003RRRR"}'),

('PROF-BUYER-B2B-001', 'Sony Corporation',
 '{"buyer_name":"Sony Corporation","tax_id":"JP9876543210987","billing_address":"1-7-1 Konan, Minato-ku","city":"Tokyo","state":"Tokyo","country":"Japan","postal_code":"108-0075","bank_account_last4":"8901","payment_email":"sourcing@sony.co.jp"}',
 '{"buyer_name":"sony corporation","tax_id":"jp9876543210987","billing_address":"171 konan minatoku","city":"tokyo","state":"tokyo","country":"japan","postal_code":"1080075","bank_account_last4":"8901","payment_email":"sourcing@sony.co.jp"}',
 '{"payment_terms":"Net 45","credit_limit":4500000,"industry":"Electronics","salesforce_id":"001XX000003SSSS"}'),

('PROF-BUYER-B2B-001', 'Siemens AG',
 '{"buyer_name":"Siemens AG","tax_id":"DE987654322","billing_address":"Werner-von-Siemens-Straße 1","city":"Munich","state":"Bavaria","country":"Germany","postal_code":"80333","bank_account_last4":"2345","payment_email":"einkauf@siemens.com"}',
 '{"buyer_name":"siemens ag","tax_id":"de987654322","billing_address":"wernervonsiemensstrasse 1","city":"munich","state":"bavaria","country":"germany","postal_code":"80333","bank_account_last4":"2345","payment_email":"einkauf@siemens.com"}',
 '{"payment_terms":"Net 60","credit_limit":12000000,"industry":"Industrial Manufacturing","salesforce_id":"001XX000003TTTT"}'),

('PROF-BUYER-B2B-001', 'China Mobile Limited',
 '{"buyer_name":"China Mobile Limited","tax_id":"CN123456789012","billing_address":"60 Xuanwumen West Avenue","city":"Beijing","state":"Beijing","country":"China","postal_code":"100032","bank_account_last4":"6789","payment_email":"procurement@chinamobile.com"}',
 '{"buyer_name":"china mobile limited","tax_id":"cn123456789012","billing_address":"60 xuanwumen west avenue","city":"beijing","state":"beijing","country":"china","postal_code":"100032","bank_account_last4":"6789","payment_email":"procurement@chinamobile.com"}',
 '{"payment_terms":"Net 45","credit_limit":10000000,"industry":"Telecommunications","salesforce_id":"001XX000003UUUU"}'),

('PROF-BUYER-B2B-001', 'BP PLC',
 '{"buyer_name":"BP PLC","tax_id":"GB123456700","billing_address":"1 St James''s Square","city":"London","state":"Greater London","country":"United Kingdom","postal_code":"SW1Y 4PD","bank_account_last4":"1357","payment_email":"vendor.invoices@bp.com"}',
 '{"buyer_name":"bp plc","tax_id":"gb123456700","billing_address":"1 st jamess square","city":"london","state":"greater london","country":"united kingdom","postal_code":"sw1y4pd","bank_account_last4":"1357","payment_email":"vendor.invoices@bp.com"}',
 '{"payment_terms":"Net 30","credit_limit":18000000,"industry":"Oil & Gas","salesforce_id":"001XX000003VVVV"}'),

('PROF-BUYER-B2B-001', 'Alibaba Group',
 '{"buyer_name":"Alibaba Group","tax_id":"CN987654321098","billing_address":"969 West Wen Yi Road","city":"Hangzhou","state":"Zhejiang","country":"China","postal_code":"311121","bank_account_last4":"2468","payment_email":"vendors@alibaba-inc.com"}',
 '{"buyer_name":"alibaba group","tax_id":"cn987654321098","billing_address":"969 west wen yi road","city":"hangzhou","state":"zhejiang","country":"china","postal_code":"311121","bank_account_last4":"2468","payment_email":"vendors@alibaba-inc.com"}',
 '{"payment_terms":"Net 60","credit_limit":6500000,"industry":"E-commerce","salesforce_id":"001XX000003WWWW"}'),

('PROF-BUYER-B2B-001', 'Roche Holding AG',
 '{"buyer_name":"Roche Holding AG","tax_id":"CHE-234.567.890","billing_address":"Grenzacherstrasse 124","city":"Basel","state":"Basel-Stadt","country":"Switzerland","postal_code":"4070","bank_account_last4":"1234","payment_email":"ap.emea@roche.com"}',
 '{"buyer_name":"roche holding ag","tax_id":"che234567890","billing_address":"grenzacherstrasse 124","city":"basel","state":"baselstadt","country":"switzerland","postal_code":"4070","bank_account_last4":"1234","payment_email":"ap.emea@roche.com"}',
 '{"payment_terms":"Net 45","credit_limit":8500000,"industry":"Pharmaceuticals","salesforce_id":"001XX000003XXXX"}'),

('PROF-BUYER-B2B-001', 'Reliance Industries Limited',
 '{"buyer_name":"Reliance Industries Limited","tax_id":"AAACR5055K","billing_address":"3rd Floor, Maker Chambers IV","city":"Mumbai","state":"Maharashtra","country":"India","postal_code":"400021","bank_account_last4":"9876","payment_email":"procurement@ril.com"}',
 '{"buyer_name":"reliance industries limited","tax_id":"aaacr5055k","billing_address":"3rd floor maker chambers iv","city":"mumbai","state":"maharashtra","country":"india","postal_code":"400021","bank_account_last4":"9876","payment_email":"procurement@ril.com"}',
 '{"payment_terms":"Net 60","credit_limit":11000000,"industry":"Conglomerate","salesforce_id":"001XX000003YYYY"}'),

('PROF-BUYER-B2B-001', 'BHP Group Limited',
 '{"buyer_name":"BHP Group Limited","tax_id":"AU987654321","billing_address":"171 Collins Street","city":"Melbourne","state":"VIC","country":"Australia","postal_code":"3000","bank_account_last4":"5432","payment_email":"supplier.payments@bhp.com"}',
 '{"buyer_name":"bhp group limited","tax_id":"au987654321","billing_address":"171 collins street","city":"melbourne","state":"vic","country":"australia","postal_code":"3000","bank_account_last4":"5432","payment_email":"supplier.payments@bhp.com"}',
 '{"payment_terms":"Net 30","credit_limit":9500000,"industry":"Mining","salesforce_id":"001XX000003ZZZZ"}');

-- Generate embeddings for buyer profile (buyer_name field only)
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
SELECT
    pe.entity_id,
    pe.profile_id,
    'buyer_name',
    pe.field_values:buyer_name::VARCHAR,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', pe.field_values:buyer_name::VARCHAR)
FROM profile_entities pe
WHERE pe.profile_id = 'PROF-BUYER-B2B-001';


-- =============================================================================
-- PROFILE: SUPPLIER ENTITIES (AR/Payee Perspective)
-- Enhanced with B2B payment-specific fields
-- =============================================================================
INSERT INTO resolution_profiles (profile_id, profile_name, profile_slug, entity_type, description, default_threshold)
VALUES ('PROF-SUPPLIER-B2B-001', 'B2B Supplier Match', 'b2b-supplier', 'SUPPLIER',
        'Supplier/Payee entity matching for accounts receivable and payment receipt. Matches on company name, tax ID, bank details, and remittance information.', 0.75);

INSERT INTO profile_fields (profile_id, field_name, field_label, field_order, is_required, is_primary_display, match_strategy, weight, strategy_config)
SELECT column1, column2, column3, column4, column5, column6, column7, column8, PARSE_JSON(column9) FROM VALUES
('PROF-SUPPLIER-B2B-001', 'supplier_name',      'Supplier Company Name',  1,  TRUE,  TRUE,  'SEMANTIC', 5.0, '{"model": "e5-base-v2"}'),
('PROF-SUPPLIER-B2B-001', 'tax_id',             'Tax ID / VAT Number',    2,  FALSE, FALSE, 'EXACT',    4.0, NULL),
('PROF-SUPPLIER-B2B-001', 'vendor_id',          'Vendor ID',              3,  FALSE, FALSE, 'EXACT',    3.5, NULL),
('PROF-SUPPLIER-B2B-001', 'remittance_address', 'Remittance Address',     4,  FALSE, FALSE, 'FUZZY',    2.0, NULL),
('PROF-SUPPLIER-B2B-001', 'city',               'City',                   5,  FALSE, FALSE, 'FUZZY',    1.5, NULL),
('PROF-SUPPLIER-B2B-001', 'country',            'Country',                6,  FALSE, FALSE, 'EXACT',    1.5, NULL),
('PROF-SUPPLIER-B2B-001', 'bank_name',          'Bank Name',              7,  FALSE, FALSE, 'FUZZY',    2.0, NULL),
('PROF-SUPPLIER-B2B-001', 'iban',               'IBAN',                   8,  FALSE, FALSE, 'EXACT',    3.0, NULL),
('PROF-SUPPLIER-B2B-001', 'swift_code',         'SWIFT/BIC Code',         9,  FALSE, FALSE, 'EXACT',    2.5, NULL),
('PROF-SUPPLIER-B2B-001', 'payment_contact',    'Payment Contact Email',  10, FALSE, FALSE, 'EXACT',    2.0, NULL);

-- Supplier Entities: 50+ realistic B2B suppliers across industries
INSERT INTO profile_entities (profile_id, display_name, field_values, field_values_normalized, metadata)
SELECT column1, column2, PARSE_JSON(column3), PARSE_JSON(column4), PARSE_JSON(column5) FROM VALUES
('PROF-SUPPLIER-B2B-001', 'GlobalTech Industries Inc',
 '{"supplier_name":"GlobalTech Industries Inc","tax_id":"94-3210987","vendor_id":"VEN-GT-001","remittance_address":"1500 Tech Center Drive","city":"San Jose","country":"USA","bank_name":"JPMorgan Chase Bank","iban":"US64CHASUS33XXX1234567890","swift_code":"CHASUS33","payment_contact":"ar@globaltech.com"}',
 '{"supplier_name":"globaltech industries inc","tax_id":"943210987","vendor_id":"vengt001","remittance_address":"1500 tech center drive","city":"san jose","country":"usa","bank_name":"jpmorgan chase bank","iban":"us64chasus33xxx1234567890","swift_code":"chasus33","payment_contact":"ar@globaltech.com"}',
 '{"category":"IT Services","payment_terms_offered":"Net 30","annual_revenue":50000000,"salesforce_id":"002XX000003AAAA"}'),

('PROF-SUPPLIER-B2B-001', 'Premier Office Supplies Ltd',
 '{"supplier_name":"Premier Office Supplies Ltd","tax_id":"36-7654321","vendor_id":"VEN-POS-002","remittance_address":"800 Business Park Rd","city":"Atlanta","country":"USA","bank_name":"Bank of America","iban":"US29BOFAUS3NXXX9876543210","swift_code":"BOFAUS3N","payment_contact":"receivables@premieroffice.com"}',
 '{"supplier_name":"premier office supplies ltd","tax_id":"367654321","vendor_id":"venpos002","remittance_address":"800 business park rd","city":"atlanta","country":"usa","bank_name":"bank of america","iban":"us29bofaus3nxxx9876543210","swift_code":"bofaus3n","payment_contact":"receivables@premieroffice.com"}',
 '{"category":"Office Supplies","payment_terms_offered":"Net 45","annual_revenue":25000000,"salesforce_id":"002XX000003BBBB"}'),

('PROF-SUPPLIER-B2B-001', 'Apex Manufacturing Solutions',
 '{"supplier_name":"Apex Manufacturing Solutions","tax_id":"22-1234567","vendor_id":"VEN-AMS-003","remittance_address":"2500 Factory Blvd","city":"Detroit","country":"USA","bank_name":"Wells Fargo Bank","iban":"US45WFBIUS6SXXX5432109876","swift_code":"WFBIUS6S","payment_contact":"payments@apexmfg.com"}',
 '{"supplier_name":"apex manufacturing solutions","tax_id":"221234567","vendor_id":"venams003","remittance_address":"2500 factory blvd","city":"detroit","country":"usa","bank_name":"wells fargo bank","iban":"us45wfbius6sxxx5432109876","swift_code":"wfbius6s","payment_contact":"payments@apexmfg.com"}',
 '{"category":"Manufacturing","payment_terms_offered":"Net 60","annual_revenue":75000000,"salesforce_id":"002XX000003CCCC"}'),

('PROF-SUPPLIER-B2B-001', 'CloudSoft Technologies',
 '{"supplier_name":"CloudSoft Technologies","tax_id":"94-9012345","vendor_id":"VEN-CST-004","remittance_address":"3200 Cloud Way","city":"Austin","country":"USA","bank_name":"Silicon Valley Bank","iban":"US78SVBKUS6SXXX1122334455","swift_code":"SVBKUS6S","payment_contact":"billing@cloudsoft.io"}',
 '{"supplier_name":"cloudsoft technologies","tax_id":"949012345","vendor_id":"vencst004","remittance_address":"3200 cloud way","city":"austin","country":"usa","bank_name":"silicon valley bank","iban":"us78svbkus6sxxx1122334455","swift_code":"svbkus6s","payment_contact":"billing@cloudsoft.io"}',
 '{"category":"Software/SaaS","payment_terms_offered":"Net 30","annual_revenue":120000000,"salesforce_id":"002XX000003DDDD"}'),

('PROF-SUPPLIER-B2B-001', 'Industrial Chemicals Corp',
 '{"supplier_name":"Industrial Chemicals Corp","tax_id":"52-3456789","vendor_id":"VEN-ICC-005","remittance_address":"700 Chemical Plant Rd","city":"Baton Rouge","country":"USA","bank_name":"JPMorgan Chase Bank","iban":"US33CHASUS33XXX6677889900","swift_code":"CHASUS33","payment_contact":"credit@indchemicals.com"}',
 '{"supplier_name":"industrial chemicals corp","tax_id":"523456789","vendor_id":"venicc005","remittance_address":"700 chemical plant rd","city":"baton rouge","country":"usa","bank_name":"jpmorgan chase bank","iban":"us33chasus33xxx6677889900","swift_code":"chasus33","payment_contact":"credit@indchemicals.com"}',
 '{"category":"Chemicals","payment_terms_offered":"Net 45","annual_revenue":95000000,"salesforce_id":"002XX000003EEEE"}'),

('PROF-SUPPLIER-B2B-001', 'Pacific Freight Logistics',
 '{"supplier_name":"Pacific Freight Logistics","tax_id":"91-8765432","vendor_id":"VEN-PFL-006","remittance_address":"1200 Port Avenue","city":"Long Beach","country":"USA","bank_name":"Bank of America","iban":"US77BOFAUS3NXXX2233445566","swift_code":"BOFAUS3N","payment_contact":"collections@pacfreight.com"}',
 '{"supplier_name":"pacific freight logistics","tax_id":"918765432","vendor_id":"venpfl006","remittance_address":"1200 port avenue","city":"long beach","country":"usa","bank_name":"bank of america","iban":"us77bofaus3nxxx2233445566","swift_code":"bofaus3n","payment_contact":"collections@pacfreight.com"}',
 '{"category":"Logistics","payment_terms_offered":"Net 15","annual_revenue":42000000,"salesforce_id":"002XX000003FFFF"}'),

('PROF-SUPPLIER-B2B-001', 'Deutsche Technologie GmbH',
 '{"supplier_name":"Deutsche Technologie GmbH","tax_id":"DE987654321","vendor_id":"VEN-DT-007","remittance_address":"Technologiepark 15","city":"Stuttgart","country":"Germany","bank_name":"Deutsche Bank AG","iban":"DE89370400440532013000","swift_code":"DEUTDEFF","payment_contact":"debitorenbuchhaltung@deutschetech.de"}',
 '{"supplier_name":"deutsche technologie gmbh","tax_id":"de987654321","vendor_id":"vendt007","remittance_address":"technologiepark 15","city":"stuttgart","country":"germany","bank_name":"deutsche bank ag","iban":"de89370400440532013000","swift_code":"deutdeff","payment_contact":"debitorenbuchhaltung@deutschetech.de"}',
 '{"category":"Technology","payment_terms_offered":"Net 30","annual_revenue":65000000,"salesforce_id":"002XX000003GGGG"}'),

('PROF-SUPPLIER-B2B-001', 'Shanghai Electronics Supply Co',
 '{"supplier_name":"Shanghai Electronics Supply Co","tax_id":"CN123456789012","vendor_id":"VEN-SES-008","remittance_address":"888 Pudong New District","city":"Shanghai","country":"China","bank_name":"Bank of China","iban":"CN13BKCH310000012345678901","swift_code":"BKCHCNBJ","payment_contact":"finance@shanghai-elec.cn"}',
 '{"supplier_name":"shanghai electronics supply co","tax_id":"cn123456789012","vendor_id":"venses008","remittance_address":"888 pudong new district","city":"shanghai","country":"china","bank_name":"bank of china","iban":"cn13bkch310000012345678901","swift_code":"bkchcnbj","payment_contact":"finance@shanghai-elec.cn"}',
 '{"category":"Electronics","payment_terms_offered":"Net 60","annual_revenue":180000000,"salesforce_id":"002XX000003HHHH"}'),

('PROF-SUPPLIER-B2B-001', 'Nordic Paper Products AB',
 '{"supplier_name":"Nordic Paper Products AB","tax_id":"SE556012345601","vendor_id":"VEN-NPP-009","remittance_address":"Industrivägen 22","city":"Stockholm","country":"Sweden","bank_name":"Skandinaviska Enskilda Banken","iban":"SE4550000000058398257466","swift_code":"ESSESESS","payment_contact":"kundreskontra@nordicpaper.se"}',
 '{"supplier_name":"nordic paper products ab","tax_id":"se556012345601","vendor_id":"vennpp009","remittance_address":"industrivagen 22","city":"stockholm","country":"sweden","bank_name":"skandinaviska enskilda banken","iban":"se4550000000058398257466","swift_code":"essesess","payment_contact":"kundreskontra@nordicpaper.se"}',
 '{"category":"Paper & Packaging","payment_terms_offered":"Net 45","annual_revenue":38000000,"salesforce_id":"002XX000003IIII"}'),

('PROF-SUPPLIER-B2B-001', 'Mitsubishi Materials Corporation',
 '{"supplier_name":"Mitsubishi Materials Corporation","tax_id":"JP9876543210987","vendor_id":"VEN-MMC-010","remittance_address":"1-3-2 Marunouchi, Chiyoda-ku","city":"Tokyo","country":"Japan","bank_name":"Mitsubishi UFJ Bank","iban":"JP98MUFG0001001234567890","swift_code":"MUFGJPJT","payment_contact":"accounts.receivable@mitsubishimaterials.co.jp"}',
 '{"supplier_name":"mitsubishi materials corporation","tax_id":"jp9876543210987","vendor_id":"venmmc010","remittance_address":"132 marunouchi chiyodaku","city":"tokyo","country":"japan","bank_name":"mitsubishi ufj bank","iban":"jp98mufg0001001234567890","swift_code":"mufgjpjt","payment_contact":"accounts.receivable@mitsubishimaterials.co.jp"}',
 '{"category":"Raw Materials","payment_terms_offered":"Net 60","annual_revenue":210000000,"salesforce_id":"002XX000003JJJJ"}'),

('PROF-SUPPLIER-B2B-001', 'British Industrial Services Ltd',
 '{"supplier_name":"British Industrial Services Ltd","tax_id":"GB987654321","vendor_id":"VEN-BIS-011","remittance_address":"25 Industrial Estate","city":"Birmingham","country":"United Kingdom","bank_name":"Barclays Bank PLC","iban":"GB29BARC20201530093459","swift_code":"BARCGB22","payment_contact":"credit.control@britishindustrial.co.uk"}',
 '{"supplier_name":"british industrial services ltd","tax_id":"gb987654321","vendor_id":"venbis011","remittance_address":"25 industrial estate","city":"birmingham","country":"united kingdom","bank_name":"barclays bank plc","iban":"gb29barc20201530093459","swift_code":"barcgb22","payment_contact":"credit.control@britishindustrial.co.uk"}',
 '{"category":"Industrial Services","payment_terms_offered":"Net 30","annual_revenue":55000000,"salesforce_id":"002XX000003KKKK"}'),

('PROF-SUPPLIER-B2B-001', 'Tata Consulting Engineers',
 '{"supplier_name":"Tata Consulting Engineers","tax_id":"AAACT9876B","vendor_id":"VEN-TCE-012","remittance_address":"Prabhat Estate, Pride Purple","city":"Pune","country":"India","bank_name":"HDFC Bank","iban":"IN98HDFC0001234567890123","swift_code":"HDFCINBB","payment_contact":"cashapplication@tce.co.in"}',
 '{"supplier_name":"tata consulting engineers","tax_id":"aaact9876b","vendor_id":"ventce012","remittance_address":"prabhat estate pride purple","city":"pune","country":"india","bank_name":"hdfc bank","iban":"in98hdfc0001234567890123","swift_code":"hdfcinbb","payment_contact":"cashapplication@tce.co.in"}',
 '{"category":"Engineering Services","payment_terms_offered":"Net 45","annual_revenue":72000000,"salesforce_id":"002XX000003LLLL"}'),

('PROF-SUPPLIER-B2B-001', 'São Paulo Steel Distributors',
 '{"supplier_name":"São Paulo Steel Distributors","tax_id":"BR12345678000190","vendor_id":"VEN-SPSD-013","remittance_address":"Av. Paulista, 1578","city":"São Paulo","country":"Brazil","bank_name":"Banco do Brasil","iban":"BR1500000000123456789012345","swift_code":"BRASBRRJ","payment_contact":"contas.receber@saopaulo-steel.com.br"}',
 '{"supplier_name":"sao paulo steel distributors","tax_id":"br12345678000190","vendor_id":"venspsd013","remittance_address":"av paulista 1578","city":"sao paulo","country":"brazil","bank_name":"banco do brasil","iban":"br1500000000123456789012345","swift_code":"brasbrrj","payment_contact":"contas.receber@saopaulo-steel.com.br"}',
 '{"category":"Steel Distribution","payment_terms_offered":"Net 60","annual_revenue":98000000,"salesforce_id":"002XX000003MMMM"}'),

('PROF-SUPPLIER-B2B-001', 'Melbourne Mining Equipment Pty',
 '{"supplier_name":"Melbourne Mining Equipment Pty","tax_id":"AU12345678901","vendor_id":"VEN-MME-014","remittance_address":"300 Flinders Street","city":"Melbourne","country":"Australia","bank_name":"ANZ Bank","iban":"AU98ANZ0123456789012345","swift_code":"ANZBAU3M","payment_contact":"receivables@melbournemining.com.au"}',
 '{"supplier_name":"melbourne mining equipment pty","tax_id":"au12345678901","vendor_id":"venmme014","remittance_address":"300 flinders street","city":"melbourne","country":"australia","bank_name":"anz bank","iban":"au98anz0123456789012345","swift_code":"anzbau3m","payment_contact":"receivables@melbournemining.com.au"}',
 '{"category":"Mining Equipment","payment_terms_offered":"Net 30","annual_revenue":115000000,"salesforce_id":"002XX000003NNNN"}'),

('PROF-SUPPLIER-B2B-001', 'Toronto Energy Solutions Inc',
 '{"supplier_name":"Toronto Energy Solutions Inc","tax_id":"CA987654321RC0001","vendor_id":"VEN-TES-015","remittance_address":"1 Yonge Street, Suite 1800","city":"Toronto","country":"Canada","bank_name":"Royal Bank of Canada","iban":"CA98RBC000123456789012","swift_code":"ROYCCAT2","payment_contact":"ar@torontoenergy.ca"}',
 '{"supplier_name":"toronto energy solutions inc","tax_id":"ca987654321rc0001","vendor_id":"ventes015","remittance_address":"1 yonge street suite 1800","city":"toronto","country":"canada","bank_name":"royal bank of canada","iban":"ca98rbc000123456789012","swift_code":"royccat2","payment_contact":"ar@torontoenergy.ca"}',
 '{"category":"Energy Services","payment_terms_offered":"Net 45","annual_revenue":88000000,"salesforce_id":"002XX000003OOOO"}'),

('PROF-SUPPLIER-B2B-001', 'Swiss Precision Manufacturing SA',
 '{"supplier_name":"Swiss Precision Manufacturing SA","tax_id":"CHE-456.789.012","vendor_id":"VEN-SPM-016","remittance_address":"Bahnhofstrasse 45","city":"Zurich","country":"Switzerland","bank_name":"UBS Switzerland AG","iban":"CH9300762011623852957","swift_code":"UBSWCHZH80A","payment_contact":"debitorenbuchhaltung@swissprecision.ch"}',
 '{"supplier_name":"swiss precision manufacturing sa","tax_id":"che456789012","vendor_id":"venspm016","remittance_address":"bahnhofstrasse 45","city":"zurich","country":"switzerland","bank_name":"ubs switzerland ag","iban":"ch9300762011623852957","swift_code":"ubswchzh80a","payment_contact":"debitorenbuchhaltung@swissprecision.ch"}',
 '{"category":"Precision Manufacturing","payment_terms_offered":"Net 30","annual_revenue":145000000,"salesforce_id":"002XX000003PPPP"}'),

('PROF-SUPPLIER-B2B-001', 'Hyundai Construction Materials',
 '{"supplier_name":"Hyundai Construction Materials","tax_id":"KR9876543210","vendor_id":"VEN-HCM-017","remittance_address":"231 Teheran-ro, Gangnam-gu","city":"Seoul","country":"South Korea","bank_name":"Woori Bank","iban":"KR98WRBN1234567890123456","swift_code":"HVBKKRSEXXX","payment_contact":"accounting@hyundai-cm.kr"}',
 '{"supplier_name":"hyundai construction materials","tax_id":"kr9876543210","vendor_id":"venhcm017","remittance_address":"231 teheranro gangnamgu","city":"seoul","country":"south korea","bank_name":"woori bank","iban":"kr98wrbn1234567890123456","swift_code":"hvbkkrsexxx","payment_contact":"accounting@hyundai-cm.kr"}',
 '{"category":"Construction Materials","payment_terms_offered":"Net 60","annual_revenue":168000000,"salesforce_id":"002XX000003QQQQ"}'),

('PROF-SUPPLIER-B2B-001', 'Amsterdam Pharma Supplies BV',
 '{"supplier_name":"Amsterdam Pharma Supplies BV","tax_id":"NL123456789B01","vendor_id":"VEN-APS-018","remittance_address":"Herengracht 501","city":"Amsterdam","country":"Netherlands","bank_name":"ING Bank","iban":"NL91ABNA0417164300","swift_code":"INGBNL2A","payment_contact":"creditmanagement@amsterdampharma.nl"}',
 '{"supplier_name":"amsterdam pharma supplies bv","tax_id":"nl123456789b01","vendor_id":"venaps018","remittance_address":"herengracht 501","city":"amsterdam","country":"netherlands","bank_name":"ing bank","iban":"nl91abna0417164300","swift_code":"ingbnl2a","payment_contact":"creditmanagement@amsterdampharma.nl"}',
 '{"category":"Pharmaceuticals","payment_terms_offered":"Net 45","annual_revenue":125000000,"salesforce_id":"002XX000003RRRR"}'),

('PROF-SUPPLIER-B2B-001', 'Singapore Semiconductor Ltd',
 '{"supplier_name":"Singapore Semiconductor Ltd","tax_id":"SG123456789A","vendor_id":"VEN-SSL-019","remittance_address":"10 Pasir Ris Industrial Dr 1","city":"Singapore","country":"Singapore","bank_name":"DBS Bank","iban":"SG98DBSS0123456789012","swift_code":"DBSSSGSG","payment_contact":"finance@singapore-semi.com.sg"}',
 '{"supplier_name":"singapore semiconductor ltd","tax_id":"sg123456789a","vendor_id":"venssl019","remittance_address":"10 pasir ris industrial dr 1","city":"singapore","country":"singapore","bank_name":"dbs bank","iban":"sg98dbss0123456789012","swift_code":"dbsssgsg","payment_contact":"finance@singapore-semi.com.sg"}',
 '{"category":"Semiconductors","payment_terms_offered":"Net 60","annual_revenue":275000000,"salesforce_id":"002XX000003SSSS"}'),

('PROF-SUPPLIER-B2B-001', 'Madrid Food Distribution SA',
 '{"supplier_name":"Madrid Food Distribution SA","tax_id":"ESB12345678","vendor_id":"VEN-MFD-020","remittance_address":"Calle de Alcalá, 123","city":"Madrid","country":"Spain","bank_name":"Banco Santander","iban":"ES9121000418450200051332","swift_code":"BSCHESMMXXX","payment_contact":"tesoreria@madridfood.es"}',
 '{"supplier_name":"madrid food distribution sa","tax_id":"esb12345678","vendor_id":"venmfd020","remittance_address":"calle de alcala 123","city":"madrid","country":"spain","bank_name":"banco santander","iban":"es9121000418450200051332","swift_code":"bschesmmxxx","payment_contact":"tesoreria@madridfood.es"}',
 '{"category":"Food Distribution","payment_terms_offered":"Net 30","annual_revenue":62000000,"salesforce_id":"002XX000003TTTT"}'),

('PROF-SUPPLIER-B2B-001', 'Polish Energy Equipment Sp zoo',
 '{"supplier_name":"Polish Energy Equipment Sp zoo","tax_id":"PL1234567890","vendor_id":"VEN-PEE-021","remittance_address":"ul. Przemysłowa 50","city":"Warsaw","country":"Poland","bank_name":"PKO Bank Polski","iban":"PL61109010140000071219812874","swift_code":"BPKOPLPW","payment_contact":"windykacja@polish-energy.pl"}',
 '{"supplier_name":"polish energy equipment sp zoo","tax_id":"pl1234567890","vendor_id":"venpee021","remittance_address":"ul przemyslowa 50","city":"warsaw","country":"poland","bank_name":"pko bank polski","iban":"pl61109010140000071219812874","swift_code":"bpkoplpw","payment_contact":"windykacja@polish-energy.pl"}',
 '{"category":"Energy Equipment","payment_terms_offered":"Net 45","annual_revenue":48000000,"salesforce_id":"002XX000003UUUU"}'),

('PROF-SUPPLIER-B2B-001', 'Bangkok Industrial Textiles Co',
 '{"supplier_name":"Bangkok Industrial Textiles Co","tax_id":"TH0123456789012","vendor_id":"VEN-BIT-022","remittance_address":"99 Rama IV Road","city":"Bangkok","country":"Thailand","bank_name":"Bangkok Bank","iban":"TH98BKKB0123456789012345","swift_code":"BKKBTHBK","payment_contact":"accounts@bangkok-textiles.co.th"}',
 '{"supplier_name":"bangkok industrial textiles co","tax_id":"th0123456789012","vendor_id":"venbit022","remittance_address":"99 rama iv road","city":"bangkok","country":"thailand","bank_name":"bangkok bank","iban":"th98bkkb0123456789012345","swift_code":"bkkbthbk","payment_contact":"accounts@bangkok-textiles.co.th"}',
 '{"category":"Textiles","payment_terms_offered":"Net 60","annual_revenue":58000000,"salesforce_id":"002XX000003VVVV"}'),

('PROF-SUPPLIER-B2B-001', 'Dubai Petrochemical Supplies LLC',
 '{"supplier_name":"Dubai Petrochemical Supplies LLC","tax_id":"AE123456789012345","vendor_id":"VEN-DPS-023","remittance_address":"Dubai Silicon Oasis","city":"Dubai","country":"United Arab Emirates","bank_name":"Emirates NBD","iban":"AE070331234567890123456","swift_code":"EBILAEAD","payment_contact":"collections@dubai-petrochem.ae"}',
 '{"supplier_name":"dubai petrochemical supplies llc","tax_id":"ae123456789012345","vendor_id":"vendps023","remittance_address":"dubai silicon oasis","city":"dubai","country":"united arab emirates","bank_name":"emirates nbd","iban":"ae070331234567890123456","swift_code":"ebilaead","payment_contact":"collections@dubai-petrochem.ae"}',
 '{"category":"Petrochemicals","payment_terms_offered":"Net 30","annual_revenue":192000000,"salesforce_id":"002XX000003WWWW"}'),

('PROF-SUPPLIER-B2B-001', 'Milan Fashion Fabrics Srl',
 '{"supplier_name":"Milan Fashion Fabrics Srl","tax_id":"IT12345678901","vendor_id":"VEN-MFF-024","remittance_address":"Via Montenapoleone 8","city":"Milan","country":"Italy","bank_name":"UniCredit Bank","iban":"IT60X0542811101000000123456","swift_code":"UNCRITMM","payment_contact":"amministrazione@milanfabrics.it"}',
 '{"supplier_name":"milan fashion fabrics srl","tax_id":"it12345678901","vendor_id":"venmff024","remittance_address":"via montenapoleone 8","city":"milan","country":"italy","bank_name":"unicredit bank","iban":"it60x0542811101000000123456","swift_code":"uncritmm","payment_contact":"amministrazione@milanfabrics.it"}',
 '{"category":"Fashion & Textiles","payment_terms_offered":"Net 60","annual_revenue":44000000,"salesforce_id":"002XX000003XXXX"}'),

('PROF-SUPPLIER-B2B-001', 'Cape Town Mining Services Pty',
 '{"supplier_name":"Cape Town Mining Services Pty","tax_id":"ZA4123456789","vendor_id":"VEN-CTMS-025","remittance_address":"15 Heerengracht Street","city":"Cape Town","country":"South Africa","bank_name":"Standard Bank","iban":"ZA98SBSA0123456789012345","swift_code":"SBZAZAJJ","payment_contact":"credit@capetown-mining.co.za"}',
 '{"supplier_name":"cape town mining services pty","tax_id":"za4123456789","vendor_id":"venctms025","remittance_address":"15 heerengracht street","city":"cape town","country":"south africa","bank_name":"standard bank","iban":"za98sbsa0123456789012345","swift_code":"sbzazajj","payment_contact":"credit@capetown-mining.co.za"}',
 '{"category":"Mining Services","payment_terms_offered":"Net 45","annual_revenue":78000000,"salesforce_id":"002XX000003YYYY"}');

-- Generate embeddings for enhanced supplier profile (supplier_name field only)
INSERT INTO profile_entity_embeddings (entity_id, profile_id, field_name, source_text, embedding)
SELECT
    pe.entity_id,
    pe.profile_id,
    'supplier_name',
    pe.field_values:supplier_name::VARCHAR,
    SNOWFLAKE.CORTEX.EMBED_TEXT_768('e5-base-v2', pe.field_values:supplier_name::VARCHAR)
FROM profile_entities pe
WHERE pe.profile_id = 'PROF-SUPPLIER-B2B-001';


-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================
SELECT 
    'B2B Buyer Profile' AS profile_type,
    COUNT(*) AS entity_count,
    COUNT(DISTINCT field_values:country::VARCHAR) AS countries,
    COUNT(DISTINCT field_values:tax_id::VARCHAR) AS unique_tax_ids
FROM profile_entities
WHERE profile_id = 'PROF-BUYER-B2B-001'
UNION ALL
SELECT 
    'B2B Supplier Profile' AS profile_type,
    COUNT(*) AS entity_count,
    COUNT(DISTINCT field_values:country::VARCHAR) AS countries,
    COUNT(DISTINCT field_values:tax_id::VARCHAR) AS unique_tax_ids
FROM profile_entities
WHERE profile_id = 'PROF-SUPPLIER-B2B-001';

-- Verify embeddings were generated
SELECT 
    'B2B Buyer Embeddings' AS embedding_type,
    COUNT(*) AS embedding_count
FROM profile_entity_embeddings
WHERE profile_id = 'PROF-BUYER-B2B-001'
UNION ALL
SELECT 
    'B2B Supplier Embeddings' AS embedding_type,
    COUNT(*) AS embedding_count
FROM profile_entity_embeddings
WHERE profile_id = 'PROF-SUPPLIER-B2B-001';

-- Sample query: Find buyers by country
SELECT 
    display_name,
    field_values:country::VARCHAR AS country,
    field_values:payment_email::VARCHAR AS payment_email,
    metadata:credit_limit::VARCHAR AS credit_limit
FROM profile_entities
WHERE profile_id = 'PROF-BUYER-B2B-001'
  AND field_values:country::VARCHAR = 'USA'
ORDER BY display_name
LIMIT 10;

-- Sample query: Find suppliers by category
SELECT 
    display_name,
    field_values:city::VARCHAR AS city,
    field_values:country::VARCHAR AS country,
    metadata:category::VARCHAR AS category,
    field_values:payment_contact::VARCHAR AS payment_contact
FROM profile_entities
WHERE profile_id = 'PROF-SUPPLIER-B2B-001'
  AND metadata:category::VARCHAR = 'Technology'
ORDER BY display_name;

-- =============================================================================
-- SUMMARY
-- =============================================================================
-- ✓ B2B Buyer Profile: 25 entities across USA, Europe, Asia, Australia
--   - Tax IDs, DUNS numbers, bank account last 4 digits
--   - Payment emails, billing addresses
--   - Payment terms, credit limits in metadata
--
-- ✓ B2B Supplier Profile: 25 entities across global markets
--   - Tax IDs, vendor IDs, bank details (IBAN, SWIFT)
--   - Remittance addresses, payment contacts
--   - Industry categories, payment terms offered
--
-- All entities have embeddings generated for semantic matching.
-- Ready for use with getMatchingEntity API.
-- =============================================================================
