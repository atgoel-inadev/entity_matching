/**
 * K6 Performance Test — ResolveIQ v2 Resolution Pipeline (100+ Entities)
 *
 * Measures p50, p90, p95, p99 latency for the resolution endpoint under
 * concurrent load ramping up to 20 virtual users (VUs).
 *
 * Test Coverage:
 *   • 100+ unique entity variations
 *   • Multiple field combinations (tax_id, name, city, address, country, etc.)
 *   • 4 pipeline scenarios: EXACT, FUZZY, SEMANTIC, BATCH
 *
 * Scenarios exercised per VU (round-robin by VU index):
 *   • EXACT fast-path   — tax_id + name exact match → bypasses embedding pipeline
 *   • FUZZY resolution  — name with typos → Levenshtein scoring over candidates
 *   • SEMANTIC resolve  — descriptive query → Snowflake Cortex embedding + ANN
 *   • Batch resolve     — 3–4 entities in one request (concurrent Promise.allSettled)
 *
 * Usage:
 *   k6 run resolution.perf.js
 *   k6 run --env BASE_URL=http://localhost:8001 --env PROFILE=b2b-supplier resolution.perf.js
 *   k6 run --env BASE_URL=http://myserver:8001 --env API_KEY=secret resolution.perf.js
 *
 * Output reports:
 *   k6 run --out json=results.json resolution.perf.js
 *   k6 run --out influxdb=http://localhost:8086/k6 resolution.perf.js
 */

import http    from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// ── Environment configuration ─────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL  || 'http://localhost:8001';
const PROFILE  = __ENV.PROFILE   || 'b2b-supplier';
const API_KEY  = __ENV.API_KEY   || '';

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
  ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
};

// ── Test Statistics ───────────────────────────────────────────────────────────
//    Total entity variations: 100+ across all scenarios
//    • EXACT:    30+ entities with different field combinations
//    • FUZZY:    30+ entities with 1-3 character typos
//    • SEMANTIC: 30+ descriptive free-text queries
//    • NO_MATCH: 15+ completely novel entities
//    • BATCH:    10+ multi-entity batch requests

// ── Custom per-scenario latency metrics ───────────────────────────────────────
//    These appear separately in the K6 summary, making it easy to compare
//    pipeline costs (fast-path vs full embedding pipeline).
const exactLatency    = new Trend('p_exact_resolve_ms',    true);
const fuzzyLatency    = new Trend('p_fuzzy_resolve_ms',    true);
const semanticLatency = new Trend('p_semantic_resolve_ms', true);
const batchLatency    = new Trend('p_batch_resolve_ms',    true);
const errorRate       = new Rate('resolution_errors');
const newEntityCount  = new Counter('new_entity_responses');
const cacheHitCount   = new Counter('cache_hit_responses');

// ── Load profile ──────────────────────────────────────────────────────────────
//
//   Phase 1 ─ Warm-up     (30s →  3 VUs): seeds caches, warms JVM/NestJS event loop
//   Phase 2 ─ Ramp-up     (60s → 10 VUs): gradual load increase
//   Phase 3 ─ Ramp-up     (60s → 20 VUs): peak ramp (tests 100+ entities)
//   Phase 4 ─ Steady-state(180s → 20 VUs): primary measurement window
//   Phase 5 ─ Ramp-down   (30s →  0 VUs): graceful teardown
//
export const options = {
  stages: [
    { duration: '30s',  target: 3  },
    { duration: '60s',  target: 10 },
    { duration: '60s',  target: 20 },
    { duration: '180s', target: 20 },
    { duration: '30s',  target: 0  },
  ],

  thresholds: {
    // ── Global HTTP latency (all endpoints combined) ─────────────────────────
    'http_req_duration': [
      { threshold: 'p(50)<400',  abortOnFail: false },
      { threshold: 'p(90)<900',  abortOnFail: false },
      { threshold: 'p(95)<1400', abortOnFail: false },
      { threshold: 'p(99)<2500', abortOnFail: true  },  // hard-stop if p99 > 2.5s
    ],

    // ── Error rate: tolerate at most 1% failed requests ──────────────────────
    'http_req_failed':    [{ threshold: 'rate<0.01', abortOnFail: true }],
    'resolution_errors':  [{ threshold: 'rate<0.01', abortOnFail: false }],

    // ── EXACT fast-path (SQL lookup, no embedding) ───────────────────────────
    //    Should be the fastest path — typically <100ms with warm connection pool.
    'p_exact_resolve_ms': [
      'p(50)<100',
      'p(90)<200',
      'p(95)<300',
      'p(99)<600',
    ],

    // ── FUZZY / phonetic (Levenshtein scoring over in-process candidates) ────
    //    No embedding call, but scores 50–200 candidates in-process.
    'p_fuzzy_resolve_ms': [
      'p(50)<300',
      'p(90)<700',
      'p(95)<1000',
      'p(99)<1800',
    ],

    // ── SEMANTIC (Snowflake Cortex EMBED_TEXT_768 + ANN vector search) ───────
    //    Slowest path: 1–2 Cortex embedding API calls + vector search.
    'p_semantic_resolve_ms': [
      'p(50)<600',
      'p(90)<1200',
      'p(95)<1800',
      'p(99)<3000',
    ],

    // ── Batch resolve (3–4 entities via Promise.allSettled) ──────────────────
    //    Expected to be faster than N×single due to parallel execution.
    'p_batch_resolve_ms': [
      'p(50)<900',
      'p(90)<1800',
      'p(95)<2500',
      'p(99)<4000',
    ],
  },
};

// ── Test data (100+ entity variations) ───────────────────────────────────────
//
// EXACT_PAYLOADS: known entities expected to exist in the profile.
// The fast-path checker bypasses the full embedding pipeline for these.
// 30+ variations with different field combinations.
const EXACT_PAYLOADS = [
  // Standard supplier entities
  { fields: { supplier_name: 'Acme Supply Co',            tax_id: '36-1234567', city: 'Chicago'    }, threshold: 0.70 },
  { fields: { supplier_name: 'Global Parts Mfg',          tax_id: '13-9876543', city: 'Detroit'    }, threshold: 0.70 },
  { fields: { supplier_name: 'Precision Components Ltd',  tax_id: 'GB987654321', city: 'Manchester' }, threshold: 0.70 },
  { fields: { supplier_name: 'Apex Industrial Group',     tax_id: '47-2345678', city: 'Houston'    }, threshold: 0.70 },
  { fields: { supplier_name: 'Summit Manufacturing LLC',  tax_id: '82-3456789', city: 'Dallas'     }, threshold: 0.70 },
  { fields: { supplier_name: 'Riverside Fabrication Co',  tax_id: '55-6789012', city: 'Phoenix'    }, threshold: 0.70 },
  { fields: { supplier_name: 'Lakefront Steel Works',     tax_id: '33-4567890', city: 'Cleveland'  }, threshold: 0.70 },
  
  // Asian suppliers
  { fields: { supplier_name: 'Shanghai Electronics Supply Co', tax_id: 'CN-8765432', city: 'Shanghai' }, threshold: 0.70 },
  { fields: { supplier_name: 'Tokyo Precision Parts Ltd',      tax_id: 'JP-1122334', city: 'Tokyo'    }, threshold: 0.70 },
  { fields: { supplier_name: 'Seoul Manufacturing Group',      tax_id: 'KR-5566778', city: 'Seoul'    }, threshold: 0.70 },
  { fields: { supplier_name: 'Beijing Industrial Corp',        tax_id: 'CN-2233445', city: 'Beijing'  }, threshold: 0.70 },
  { fields: { supplier_name: 'Taipei Components Ltd',          tax_id: 'TW-6677889', city: 'Taipei'   }, threshold: 0.70 },
  
  // European suppliers
  { fields: { supplier_name: 'Berlin Machinery GmbH',      tax_id: 'DE-3344556', city: 'Berlin'    }, threshold: 0.70 },
  { fields: { supplier_name: 'Paris Industrial SA',        tax_id: 'FR-7788990', city: 'Paris'     }, threshold: 0.70 },
  { fields: { supplier_name: 'Amsterdam Components BV',    tax_id: 'NL-4455667', city: 'Amsterdam' }, threshold: 0.70 },
  { fields: { supplier_name: 'Milan Fabrication SpA',      tax_id: 'IT-8899001', city: 'Milan'     }, threshold: 0.70 },
  { fields: { supplier_name: 'Barcelona Parts SL',         tax_id: 'ES-5566778', city: 'Barcelona' }, threshold: 0.70 },
  
  // Mixed field combinations
  { fields: { supplier_name: 'Atlantic Metals Inc',        city: 'Boston',    country: 'USA' }, threshold: 0.65 },
  { fields: { supplier_name: 'Pacific Components LLC',     city: 'Seattle',   country: 'USA' }, threshold: 0.65 },
  { fields: { supplier_name: 'Midwest Manufacturing Co',   city: 'Milwaukee', country: 'USA' }, threshold: 0.65 },
  { fields: { supplier_name: 'Southern Industrial Group',  city: 'Atlanta',   country: 'USA' }, threshold: 0.65 },
  { fields: { supplier_name: 'Northern Supply Chain Ltd',  city: 'Toronto',   country: 'Canada' }, threshold: 0.65 },
  
  // Tax ID only (tests exact match without name)
  { fields: { tax_id: '36-1234567' }, threshold: 0.80 },
  { fields: { tax_id: 'GB987654321' }, threshold: 0.80 },
  { fields: { tax_id: 'CN-8765432' }, threshold: 0.80 },
  { fields: { tax_id: 'JP-1122334' }, threshold: 0.80 },
  
  // Name + City (no tax_id)
  { fields: { supplier_name: 'Acme Supply Co', city: 'Chicago' }, threshold: 0.65 },
  { fields: { supplier_name: 'Global Parts Mfg', city: 'Detroit' }, threshold: 0.65 },
  { fields: { supplier_name: 'Shanghai Electronics Supply Co', city: 'Shanghai' }, threshold: 0.65 },
  { fields: { supplier_name: 'Tokyo Precision Parts Ltd', city: 'Tokyo' }, threshold: 0.65 },
];

// FUZZY_PAYLOADS: deliberate typos to exercise Levenshtein scoring.
// 30+ variations with 1–3 character edits.
const FUZZY_PAYLOADS = [
  // Single character typos
  { fields: { supplier_name: 'Acme Suply Co',         city: 'Chicago'   }, threshold: 0.60 },
  { fields: { supplier_name: 'Globl Parts Mfg',       city: 'Detroit'   }, threshold: 0.60 },
  { fields: { supplier_name: 'Precison Components',   city: 'Manchester'}, threshold: 0.60 },
  { fields: { supplier_name: 'Apex Industral Group',  city: 'Houston'   }, threshold: 0.60 },
  { fields: { supplier_name: 'Sumit Manufacturing',   city: 'Dallas'    }, threshold: 0.60 },
  { fields: { supplier_name: 'Riverside Fabricaton',  city: 'Phoenix'   }, threshold: 0.60 },
  { fields: { supplier_name: 'Lakfront Steel Works',  city: 'Cleveland' }, threshold: 0.60 },
  
  // Double character typos
  { fields: { supplier_name: 'Shangha Electrnics Supply', city: 'Shanghai' }, threshold: 0.55 },
  { fields: { supplier_name: 'Tokio Precison Parts',      city: 'Tokyo'    }, threshold: 0.55 },
  { fields: { supplier_name: 'Seol Manufactring Group',   city: 'Seoul'    }, threshold: 0.55 },
  { fields: { supplier_name: 'Bejing Industial Corp',     city: 'Beijing'  }, threshold: 0.55 },
  { fields: { supplier_name: 'Taipe Components Ltd',      city: 'Taipei'   }, threshold: 0.55 },
  
  // European typos
  { fields: { supplier_name: 'Berln Machinery GmbH',   city: 'Berlin'    }, threshold: 0.60 },
  { fields: { supplier_name: 'Pars Industrial SA',     city: 'Paris'     }, threshold: 0.60 },
  { fields: { supplier_name: 'Amstedam Components',    city: 'Amsterdam' }, threshold: 0.55 },
  { fields: { supplier_name: 'Miln Fabrication SpA',   city: 'Milan'     }, threshold: 0.60 },
  { fields: { supplier_name: 'Barcelna Parts SL',      city: 'Barcelona' }, threshold: 0.60 },
  
  // Abbreviation variations
  { fields: { supplier_name: 'Acme Sup Co',            city: 'Chicago'    }, threshold: 0.55 },
  { fields: { supplier_name: 'Global Pts Mfg',         city: 'Detroit'    }, threshold: 0.55 },
  { fields: { supplier_name: 'Precision Comp Ltd',     city: 'Manchester' }, threshold: 0.55 },
  { fields: { supplier_name: 'Apex Ind Grp',           city: 'Houston'    }, threshold: 0.55 },
  { fields: { supplier_name: 'Summit Mfg LLC',         city: 'Dallas'     }, threshold: 0.55 },
  
  // Mixed typos and abbreviations
  { fields: { supplier_name: 'Atlntic Metls Inc',      city: 'Boston'     }, threshold: 0.55 },
  { fields: { supplier_name: 'Pacfic Componts LLC',    city: 'Seattle'    }, threshold: 0.55 },
  { fields: { supplier_name: 'Midwst Mfg Co',          city: 'Milwaukee'  }, threshold: 0.55 },
  { fields: { supplier_name: 'Southrn Ind Grp',        city: 'Atlanta'    }, threshold: 0.55 },
  { fields: { supplier_name: 'Northrn Supply Chn',     city: 'Toronto'    }, threshold: 0.55 },
  
  // Case variations with typos
  { fields: { supplier_name: 'ACME SUPLY CO',          city: 'Chicago'    }, threshold: 0.60 },
  { fields: { supplier_name: 'global parts mfg',       city: 'Detroit'    }, threshold: 0.60 },
  { fields: { supplier_name: 'SHANGHA ELECTRONICS',    city: 'Shanghai'   }, threshold: 0.55 },
  { fields: { supplier_name: 'tokyo precison parts',   city: 'Tokyo'      }, threshold: 0.55 },
];

// SEMANTIC_PAYLOADS: descriptive free-text queries that exercise embedding + ANN.
// 30+ variations simulating users describing a company without knowing exact name.
const SEMANTIC_PAYLOADS = [
  // Industry-based queries
  { fields: { supplier_name: 'industrial supply company based in Chicago Illinois'   }, threshold: 0.50 },
  { fields: { supplier_name: 'automotive parts manufacturer in Detroit Michigan'      }, threshold: 0.50 },
  { fields: { supplier_name: 'precision engineering and components supplier in UK'    }, threshold: 0.50 },
  { fields: { supplier_name: 'heavy industry manufacturing group Texas'               }, threshold: 0.50 },
  { fields: { supplier_name: 'metal fabrication and manufacturing company Dallas'     }, threshold: 0.50 },
  { fields: { supplier_name: 'steel fabrication works based in Ohio'                  }, threshold: 0.50 },
  
  // Asian market queries
  { fields: { supplier_name: 'electronics supplier in Shanghai China'                 }, threshold: 0.50 },
  { fields: { supplier_name: 'precision manufacturing company Tokyo Japan'            }, threshold: 0.50 },
  { fields: { supplier_name: 'industrial manufacturer in Seoul South Korea'           }, threshold: 0.50 },
  { fields: { supplier_name: 'technology components supplier Beijing'                 }, threshold: 0.50 },
  { fields: { supplier_name: 'electronics parts manufacturer Taiwan'                  }, threshold: 0.50 },
  
  // European market queries
  { fields: { supplier_name: 'machinery manufacturer in Berlin Germany'               }, threshold: 0.50 },
  { fields: { supplier_name: 'industrial equipment supplier Paris France'             }, threshold: 0.50 },
  { fields: { supplier_name: 'components manufacturer Amsterdam Netherlands'          }, threshold: 0.50 },
  { fields: { supplier_name: 'fabrication company in Milan Italy'                     }, threshold: 0.50 },
  { fields: { supplier_name: 'industrial parts supplier Barcelona Spain'              }, threshold: 0.50 },
  
  // Material-based queries
  { fields: { supplier_name: 'steel and metal supplier in Chicago'                    }, threshold: 0.50 },
  { fields: { supplier_name: 'aluminum fabrication company in Detroit'                }, threshold: 0.50 },
  { fields: { supplier_name: 'electronic components and parts supplier'               }, threshold: 0.45 },
  { fields: { supplier_name: 'industrial machinery and equipment manufacturer'        }, threshold: 0.45 },
  { fields: { supplier_name: 'precision mechanical components supplier'               }, threshold: 0.45 },
  
  // Regional queries
  { fields: { supplier_name: 'East Coast manufacturing company'                       }, threshold: 0.45 },
  { fields: { supplier_name: 'West Coast industrial supplier'                         }, threshold: 0.45 },
  { fields: { supplier_name: 'Midwest manufacturing and fabrication'                  }, threshold: 0.45 },
  { fields: { supplier_name: 'Southern industrial equipment company'                  }, threshold: 0.45 },
  { fields: { supplier_name: 'Pacific Northwest supply chain provider'                }, threshold: 0.45 },
  
  // Service-based queries
  { fields: { supplier_name: 'high volume production manufacturing'                   }, threshold: 0.45 },
  { fields: { supplier_name: 'custom fabrication and machining services'              }, threshold: 0.45 },
  { fields: { supplier_name: 'industrial engineering and design company'              }, threshold: 0.45 },
  { fields: { supplier_name: 'supply chain and logistics provider'                    }, threshold: 0.45 },
  { fields: { supplier_name: 'OEM parts manufacturer and distributor'                 }, threshold: 0.45 },
];

// NO_MATCH_PAYLOADS: completely novel entities — exercises full pipeline with no match.
// create_if_missing: false so no DB write happens during the perf test.
// 15 variations to ensure comprehensive no-match testing.
const NO_MATCH_PAYLOADS = [
  { fields: { supplier_name: 'Quantum Dynamics Corp Alpha',    tax_id: '00-0000001', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Temporal Solutions Beta LLC',    tax_id: '00-0000002', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Future Technologies Gamma Inc',  tax_id: '00-0000003', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Nexus Innovations Delta Corp',   tax_id: '00-0000004', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Zenith Manufacturing Epsilon',   tax_id: '00-0000005', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Odyssey Components Zeta Ltd',    tax_id: '00-0000006', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Phoenix Industrial Eta Group',   tax_id: '00-0000007', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Aurora Technologies Theta Inc',  tax_id: '00-0000008', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Nova Manufacturing Iota LLC',    tax_id: '00-0000009', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Stellar Components Kappa Co',    tax_id: '00-0000010', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Vortex Industrial Lambda Group', tax_id: '00-0000011', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Apex Future Mu Corporation',     tax_id: '00-0000012', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Infinity Parts Nu Enterprises',  tax_id: '00-0000013', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Horizon Manufacturing Xi LLC',   tax_id: '00-0000014', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
  { fields: { supplier_name: 'Titan Industries Omicron Inc',   tax_id: '00-0000015', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
];

// BATCH_PAYLOADS: mixed batches to test concurrent Promise.allSettled throughput.
// 10+ batch variations with different entity combinations.
const BATCH_PAYLOADS = [
  {
    entities: [
      { fields: { supplier_name: 'Acme Suply Co',        city: 'Chicago'   }, threshold: 0.60 },
      { fields: { supplier_name: 'Globl Parts Mfg',      city: 'Detroit'   }, threshold: 0.60 },
      { fields: { supplier_name: 'New Vendor Alpha Corp', city: 'Austin'    }, threshold: 0.70, create_if_missing: false },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'Acme Supply Co',       tax_id: '36-1234567' }, threshold: 0.70 },
      { fields: { supplier_name: 'Precison Components',  city: 'Manchester'   }, threshold: 0.55 },
      { fields: { supplier_name: 'Beta Innovations Ltd', city: 'Seattle'      }, threshold: 0.70, create_if_missing: false },
      { fields: { supplier_name: 'Gamma Tech Solutions', city: 'Boston'       }, threshold: 0.70, create_if_missing: false },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'Sumit Manufacturing',   city: 'Dallas'    }, threshold: 0.60 },
      { fields: { supplier_name: 'Apex Industrial Group', tax_id: '47-2345678' }, threshold: 0.70 },
      { fields: { supplier_name: 'Riverside Fabricaton',  city: 'Phoenix'   }, threshold: 0.60 },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'Shanghai Electronics Supply Co', tax_id: 'CN-8765432' }, threshold: 0.70 },
      { fields: { supplier_name: 'Tokyo Precison Parts',           city: 'Tokyo'        }, threshold: 0.55 },
      { fields: { supplier_name: 'Seoul Manufacturing Group',      city: 'Seoul'        }, threshold: 0.65 },
      { fields: { supplier_name: 'Beijing Industrial Corp',        tax_id: 'CN-2233445' }, threshold: 0.70 },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'Berlin Machinery GmbH',  city: 'Berlin'    }, threshold: 0.65 },
      { fields: { supplier_name: 'Paris Industrial SA',    city: 'Paris'     }, threshold: 0.65 },
      { fields: { supplier_name: 'Amsterdam Components',   city: 'Amsterdam' }, threshold: 0.55 },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'electronics supplier in Shanghai China'   }, threshold: 0.50 },
      { fields: { supplier_name: 'precision manufacturing company Tokyo'    }, threshold: 0.50 },
      { fields: { supplier_name: 'industrial manufacturer in Seoul'         }, threshold: 0.50 },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'Atlntic Metls Inc',   city: 'Boston'     }, threshold: 0.55 },
      { fields: { supplier_name: 'Pacfic Componts LLC', city: 'Seattle'    }, threshold: 0.55 },
      { fields: { supplier_name: 'Midwst Mfg Co',       city: 'Milwaukee'  }, threshold: 0.55 },
      { fields: { supplier_name: 'Southrn Ind Grp',     city: 'Atlanta'    }, threshold: 0.55 },
    ],
  },
  {
    entities: [
      { fields: { tax_id: '36-1234567' }, threshold: 0.80 },
      { fields: { tax_id: 'GB987654321' }, threshold: 0.80 },
      { fields: { tax_id: 'CN-8765432' }, threshold: 0.80 },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'machinery manufacturer in Berlin Germany'  }, threshold: 0.50 },
      { fields: { supplier_name: 'industrial equipment supplier Paris France'}, threshold: 0.50 },
      { fields: { supplier_name: 'components manufacturer Amsterdam'         }, threshold: 0.50 },
      { fields: { supplier_name: 'fabrication company in Milan Italy'        }, threshold: 0.50 },
    ],
  },
  {
    entities: [
      { fields: { supplier_name: 'Quantum Dynamics Corp',  tax_id: '00-0000020', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
      { fields: { supplier_name: 'Nexus Innovations Ltd',  tax_id: '00-0000021', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
      { fields: { supplier_name: 'Zenith Technologies Inc',tax_id: '00-0000022', city: 'Nowhere' }, threshold: 0.70, create_if_missing: false },
    ],
  },
];

// ── URL builders ─────────────────────────────────────────────────────────────
const resolveURL     = () => `${BASE_URL}/profiles/${PROFILE}/resolve`;
const batchURL       = () => `${BASE_URL}/profiles/${PROFILE}/resolve/batch`;
const findSimilarURL = (limit = 5) => `${BASE_URL}/profiles/${PROFILE}/find-similar?limit=${limit}`;

// ── Random item picker ────────────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── Scenario functions ────────────────────────────────────────────────────────

/**
 * EXACT fast-path: sends a request with a high-weight EXACT field (tax_id).
 * FastPathChecker should intercept this and return without hitting the pipeline.
 * Expected: p99 < 600ms even at peak load.
 */
function runExactFastPath() {
  const payload = pick(EXACT_PAYLOADS);

  group('exact_fast_path', () => {
    const start = Date.now();
    const res = http.post(
      resolveURL(),
      JSON.stringify(payload),
      { headers: HEADERS, tags: { scenario: 'exact' } },
    );
    const duration = Date.now() - start;

    exactLatency.add(duration);

    const ok = check(res, {
      'exact: status 200':        (r) => r.status === 200,
      'exact: has match_type':    (r) => JSON.parse(r.body).match_type !== undefined,
      'exact: not NEW_ENTITY':    (r) => JSON.parse(r.body).match_type !== 'NEW_ENTITY',
      'exact: match_score >= 0.9':(r) => {
        const body = JSON.parse(r.body);
        return body.match_type === 'EXACT_FASTPATH' || body.match_score >= 0.9;
      },
    });

    errorRate.add(!ok);

    if (!ok) {
      console.warn(`[EXACT] VU=${__VU} iter=${__ITER} status=${res.status} body=${res.body.slice(0, 200)}`);
    }

    trackCacheAndNewEntity(res);
  });
}

/**
 * FUZZY resolution: names with deliberate typos.
 * Exercises Levenshtein scoring across the candidate pool.
 * Expected: p99 < 1800ms.
 */
function runFuzzyResolution() {
  const payload = pick(FUZZY_PAYLOADS);

  group('fuzzy_resolution', () => {
    const start = Date.now();
    const res = http.post(
      resolveURL(),
      JSON.stringify(payload),
      { headers: HEADERS, tags: { scenario: 'fuzzy' } },
    );
    const duration = Date.now() - start;

    fuzzyLatency.add(duration);

    const ok = check(res, {
      'fuzzy: status 200':     (r) => r.status === 200,
      'fuzzy: has match_type': (r) => JSON.parse(r.body).match_type !== undefined,
      'fuzzy: execution_ms set': (r) => {
        const body = JSON.parse(r.body);
        return body.execution_ms !== undefined && body.execution_ms > 0;
      },
    });

    errorRate.add(!ok);

    if (!ok) {
      console.warn(`[FUZZY] VU=${__VU} iter=${__ITER} status=${res.status} body=${res.body.slice(0, 200)}`);
    }

    trackCacheAndNewEntity(res);
  });
}

/**
 * SEMANTIC resolution: free-text description queries.
 * Exercises Snowflake Cortex EMBED_TEXT_768 + ANN vector search.
 * This is the most latency-sensitive path due to the external embedding call.
 * Expected: p99 < 3000ms.
 */
function runSemanticResolution() {
  const payload = pick(SEMANTIC_PAYLOADS);

  group('semantic_resolution', () => {
    const start = Date.now();
    const res = http.post(
      resolveURL(),
      JSON.stringify(payload),
      { headers: HEADERS, tags: { scenario: 'semantic' } },
    );
    const duration = Date.now() - start;

    semanticLatency.add(duration);

    const ok = check(res, {
      'semantic: status 200':     (r) => r.status === 200,
      'semantic: has match_type': (r) => JSON.parse(r.body).match_type !== undefined,
    });

    errorRate.add(!ok);

    if (!ok) {
      console.warn(`[SEMANTIC] VU=${__VU} iter=${__ITER} status=${res.status} body=${res.body.slice(0, 200)}`);
    }

    trackCacheAndNewEntity(res);
  });
}

/**
 * Batch resolve: sends 3–4 entities concurrently in a single HTTP request.
 * The pipeline uses Promise.allSettled internally for true parallel processing.
 * Expected: p99 < 4000ms for 3–4 entity batches.
 */
function runBatchResolve() {
  const payload = pick(BATCH_PAYLOADS);

  group('batch_resolve', () => {
    const start = Date.now();
    const res = http.post(
      batchURL(),
      JSON.stringify(payload),
      { headers: HEADERS, tags: { scenario: 'batch' } },
    );
    const duration = Date.now() - start;

    batchLatency.add(duration);

    const ok = check(res, {
      'batch: status 200':           (r) => r.status === 200,
      'batch: has results array':    (r) => Array.isArray(JSON.parse(r.body).results),
      'batch: results count matches':(r) => {
        const body = JSON.parse(r.body);
        return body.results && body.results.length === payload.entities.length;
      },
      'batch: total_processed set':  (r) => {
        const body = JSON.parse(r.body);
        return body.total_processed === payload.entities.length;
      },
      'batch: parallel speedup':     (r) => {
        // Batch of N should take less than N × single-request p90
        const body = JSON.parse(r.body);
        const maxExpectedMs = payload.entities.length * 700;
        return body.total_execution_ms < maxExpectedMs;
      },
    });

    errorRate.add(!ok);

    if (!ok) {
      console.warn(`[BATCH] VU=${__VU} iter=${__ITER} status=${res.status} body=${res.body.slice(0, 200)}`);
    }
  });
}

/**
 * No-match scenario: completely novel entities.
 * Exercises the full pipeline without a DB write (create_if_missing: false).
 * Validates that the system returns NEW_ENTITY cleanly without errors.
 */
function runNoMatch() {
  const payload = pick(NO_MATCH_PAYLOADS);

  group('no_match', () => {
    const res = http.post(
      resolveURL(),
      JSON.stringify(payload),
      { headers: HEADERS, tags: { scenario: 'no_match' } },
    );

    const ok = check(res, {
      'no_match: status 200':      (r) => r.status === 200,
      'no_match: is NEW_ENTITY':   (r) => JSON.parse(r.body).match_type === 'NEW_ENTITY',
      'no_match: no entity_id':    (r) => JSON.parse(r.body).entity_id == null,
    });

    errorRate.add(!ok);
    // Count how many new-entity results come back across all scenarios
    if (res.status === 200 && JSON.parse(res.body).match_type === 'NEW_ENTITY') {
      newEntityCount.add(1);
    }
  });
}

// ── Cache / new-entity tracking helper ───────────────────────────────────────
function trackCacheAndNewEntity(res) {
  if (res.status !== 200) return;
  try {
    const body = JSON.parse(res.body);
    if (body.was_cached)               cacheHitCount.add(1);
    if (body.match_type === 'NEW_ENTITY') newEntityCount.add(1);
  } catch (_) { /* ignore parse errors */ }
}

// ── Main VU function ──────────────────────────────────────────────────────────
//
// Each VU follows a round-robin scenario assignment based on its ID.
// This distributes scenario types evenly across all concurrent users.
//
//   VU mod 5 == 0 → EXACT fast-path         (20% of VUs)
//   VU mod 5 == 1 → FUZZY resolution         (20% of VUs)
//   VU mod 5 == 2 → SEMANTIC resolution      (20% of VUs)
//   VU mod 5 == 3 → BATCH resolve            (20% of VUs)
//   VU mod 5 == 4 → NO_MATCH / mixed         (20% of VUs)
//
export default function () {
  const scenario = __VU % 5;

  switch (scenario) {
    case 0: runExactFastPath();    break;
    case 1: runFuzzyResolution();  break;
    case 2: runSemanticResolution(); break;
    case 3: runBatchResolve();     break;
    case 4: runNoMatch();          break;
  }

  // Think time: 100–500ms to simulate realistic inter-request pacing
  sleep(Math.random() * 0.4 + 0.1);
}

// ── Setup: verify the API is reachable before the load starts ─────────────────
export function setup() {
  console.log(`\n=== ResolveIQ v2 Performance Test ===`);
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Profile  : ${PROFILE}`);
  console.log(`API Key  : ${API_KEY ? 'set' : 'not set'}`);
  console.log(`=====================================\n`);

  const healthRes = http.get(`${BASE_URL}/health`, { headers: HEADERS });
  if (healthRes.status !== 200) {
    throw new Error(`Health check failed: ${healthRes.status} — is the engine running at ${BASE_URL}?`);
  }
  console.log(`Health check: OK (${healthRes.status})`);
}

// ── Teardown: print a results summary ────────────────────────────────────────
export function teardown(data) {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           ResolveIQ v2 Performance Test Complete                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('\n📊 Detailed percentile metrics (p50/p90/p95/p99) shown in summary above.');
  console.log('📈 Check thresholds for pass/fail status per scenario.');
  console.log('💾 Run with --out json=results.json to export raw metrics.');
  console.log('📄 Run with --out html=report.html for HTML report (if k6-reporter installed).');
  console.log('\n✅ Test Coverage:');
  console.log(`   • ${EXACT_PAYLOADS.length} EXACT fast-path scenarios`);
  console.log(`   • ${FUZZY_PAYLOADS.length} FUZZY resolution scenarios`);
  console.log(`   • ${SEMANTIC_PAYLOADS.length} SEMANTIC embedding scenarios`);
  console.log(`   • ${NO_MATCH_PAYLOADS.length} NO_MATCH scenarios`);
  console.log(`   • ${BATCH_PAYLOADS.length} BATCH resolve scenarios`);
  console.log(`   • Total: ${EXACT_PAYLOADS.length + FUZZY_PAYLOADS.length + SEMANTIC_PAYLOADS.length + NO_MATCH_PAYLOADS.length + BATCH_PAYLOADS.length}+ unique entity variations\n`);
}

// ── Custom Summary Handler ───────────────────────────────────────────────────
//    Generates detailed HTML report and text summary with all percentiles
export function handleSummary(data) {
  const summary = {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };

  // Add HTML report if k6-reporter is available
  try {
    summary['summary.html'] = htmlReport(data);
    console.log('\n📄 HTML report generated: summary.html');
  } catch (e) {
    // k6-reporter not installed, skip HTML
  }

  // Custom percentile summary
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                   DETAILED PERCENTILE BREAKDOWN                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const metrics = [
    { name: 'EXACT Fast-Path',      key: 'p_exact_resolve_ms',    target: 'p99<600ms'  },
    { name: 'FUZZY Resolution',     key: 'p_fuzzy_resolve_ms',    target: 'p99<1800ms' },
    { name: 'SEMANTIC Resolution',  key: 'p_semantic_resolve_ms', target: 'p99<3000ms' },
    { name: 'BATCH Resolution',     key: 'p_batch_resolve_ms',    target: 'p99<4000ms' },
    { name: 'HTTP Request Duration',key: 'http_req_duration',     target: 'p99<2500ms' },
  ];

  metrics.forEach(metric => {
    const m = data.metrics[metric.key];
    if (m && m.values) {
      const p50 = m.values['p(50)'] || 0;
      const p90 = m.values['p(90)'] || 0;
      const p95 = m.values['p(95)'] || 0;
      const p99 = m.values['p(99)'] || 0;
      const avg = m.values.avg || 0;
      const max = m.values.max || 0;

      console.log(`📊 ${metric.name} (target: ${metric.target})`);
      console.log(`   ├─ p50:  ${p50.toFixed(2)}ms`);
      console.log(`   ├─ p90:  ${p90.toFixed(2)}ms`);
      console.log(`   ├─ p95:  ${p95.toFixed(2)}ms`);
      console.log(`   ├─ p99:  ${p99.toFixed(2)}ms`);
      console.log(`   ├─ avg:  ${avg.toFixed(2)}ms`);
      console.log(`   └─ max:  ${max.toFixed(2)}ms\n`);
    }
  });

  // Error rate summary
  const errorRate = data.metrics['resolution_errors'];
  const httpFailRate = data.metrics['http_req_failed'];
  
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         ERROR SUMMARY                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  
  if (errorRate && errorRate.values) {
    console.log(`❌ Resolution Errors: ${(errorRate.values.rate * 100).toFixed(2)}% (target: <1%)`);
  }
  if (httpFailRate && httpFailRate.values) {
    console.log(`🔴 HTTP Failures:     ${(httpFailRate.values.rate * 100).toFixed(2)}% (target: <1%)\n`);
  }

  // Cache hit rate summary
  const cacheHits = data.metrics['cache_hit_responses'];
  const iterations = data.metrics['iterations'];
  
  if (cacheHits && iterations && iterations.values) {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                         CACHE PERFORMANCE                          ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    const hitRate = (cacheHits.values.count / iterations.values.count * 100);
    console.log(`💾 Cache Hit Rate: ${hitRate.toFixed(2)}% (${cacheHits.values.count} hits / ${iterations.values.count} requests)\n`);
  }

  return summary;
}
