/**
 * K6 Performance Test — ResolveIQ v2 Resolution Pipeline
 *
 * Measures p50, p90, p95, p99 latency for the resolution endpoint under
 * concurrent load ramping up to 10 virtual users (VUs).
 *
 * Scenarios exercised per VU (round-robin by VU index):
 *   • EXACT fast-path   — tax_id + name exact match → bypasses embedding pipeline
 *   • FUZZY resolution  — name with typos → Levenshtein scoring over candidates
 *   • SEMANTIC resolve  — descriptive query → Snowflake Cortex embedding + ANN
 *   • Batch resolve     — 3–4 entities in one request (concurrent Promise.allSettled)
 *
 * Usage:
 *   k6 run resolution.perf.js
 *   k6 run --env BASE_URL=http://localhost:8001 --env PROFILE=supplier-dedup resolution.perf.js
 *   k6 run --env BASE_URL=http://myserver:8001 --env API_KEY=secret resolution.perf.js
 *
 * Output HTML report (requires k6-reporter):
 *   k6 run --out json=results.json resolution.perf.js
 */

import http    from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// ── Environment configuration ─────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL  || 'http://localhost:8001';
const PROFILE  = __ENV.PROFILE   || 'supplier-dedup';
const API_KEY  = __ENV.API_KEY   || '';

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
  ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
};

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
//   Phase 1 ─ Warm-up     (30s →  2 VUs): seeds caches, warms JVM/NestJS event loop
//   Phase 2 ─ Ramp-up     (60s →  5 VUs): gradual load increase
//   Phase 3 ─ Ramp-up     (60s → 10 VUs): peak ramp
//   Phase 4 ─ Steady-state(120s → 10 VUs): primary measurement window
//   Phase 5 ─ Ramp-down   (30s →  0 VUs): graceful teardown
//
export const options = {
  stages: [
    { duration: '30s',  target: 2  },
    { duration: '60s',  target: 5  },
    { duration: '60s',  target: 10 },
    { duration: '120s', target: 10 },
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

// ── Test data ─────────────────────────────────────────────────────────────────
//
// EXACT_PAYLOADS: known tax_id values expected to exist in the profile.
// The fast-path checker bypasses the full embedding pipeline for these.
const EXACT_PAYLOADS = [
  { fields: { name: 'Acme Supply Co',            tax_id: '36-1234567', city: 'Chicago'    }, threshold: 0.65 },
  { fields: { name: 'Global Parts Mfg',           tax_id: '13-9876543', city: 'Detroit'    }, threshold: 0.65 },
  { fields: { name: 'Precision Components Ltd',   tax_id: 'GB987654321', city: 'Manchester' }, threshold: 0.65 },
  { fields: { name: 'Apex Industrial Group',      tax_id: '47-2345678', city: 'Houston'    }, threshold: 0.65 },
  { fields: { name: 'Summit Manufacturing LLC',   tax_id: '82-3456789', city: 'Dallas'     }, threshold: 0.65 },
  { fields: { name: 'Riverside Fabrication Co',   tax_id: '55-6789012', city: 'Phoenix'    }, threshold: 0.65 },
  { fields: { name: 'Lakefront Steel Works',      tax_id: '33-4567890', city: 'Cleveland'  }, threshold: 0.65 },
];

// FUZZY_PAYLOADS: deliberate typos to exercise Levenshtein scoring.
// Each input has 1–3 character edits that should still match above threshold.
const FUZZY_PAYLOADS = [
  { fields: { name: 'Acme Suply Co',         city: 'Chicago'   }, threshold: 0.60 },  // "Suply" → 1 edit
  { fields: { name: 'Globl Parts Mfg',        city: 'Detroit'   }, threshold: 0.60 },  // "Globl" → 1 edit
  { fields: { name: 'Precison Componants',    city: 'Manchester'}, threshold: 0.55 },  // 2 typos
  { fields: { name: 'Apex Industral Grp',     city: 'Houston'   }, threshold: 0.60 },  // "Industral" + abbrev
  { fields: { name: 'Sumit Manufacturng',     city: 'Dallas'    }, threshold: 0.60 },  // 2 edits
  { fields: { name: 'Riverside Fabricaton',   city: 'Phoenix'   }, threshold: 0.60 },  // "Fabricaton" → 1 edit
  { fields: { name: 'Lakfront Steel Werks',   city: 'Cleveland' }, threshold: 0.55 },  // 2 edits
];

// SEMANTIC_PAYLOADS: descriptive free-text queries that exercise embedding + ANN.
// These simulate users describing a company without knowing its exact name.
const SEMANTIC_PAYLOADS = [
  { fields: { name: 'industrial supply company based in Chicago Illinois'   }, threshold: 0.55 },
  { fields: { name: 'automotive parts manufacturer in Detroit Michigan'       }, threshold: 0.55 },
  { fields: { name: 'precision engineering and components supplier in UK'     }, threshold: 0.55 },
  { fields: { name: 'heavy industry manufacturing group Texas'                }, threshold: 0.55 },
  { fields: { name: 'metal fabrication and manufacturing company Dallas'      }, threshold: 0.55 },
  { fields: { name: 'steel fabrication works based in Ohio'                   }, threshold: 0.55 },
];

// NO_MATCH_PAYLOADS: completely novel entities — exercises full pipeline with no match.
// create_if_missing: false so no DB write happens during the perf test.
const NO_MATCH_PAYLOADS = [
  { fields: { name: 'Quantum Dynamics Corp Alpha',  tax_id: '00-0000001', city: 'Nowhere' }, threshold: 0.65, create_if_missing: false },
  { fields: { name: 'Temporal Solutions Beta LLC',  tax_id: '00-0000002', city: 'Nowhere' }, threshold: 0.65, create_if_missing: false },
  { fields: { name: 'Future Technologies Gamma Inc',tax_id: '00-0000003', city: 'Nowhere' }, threshold: 0.65, create_if_missing: false },
];

// BATCH_PAYLOADS: mixed batches to test concurrent Promise.allSettled throughput.
const BATCH_PAYLOADS = [
  {
    entities: [
      { fields: { name: 'Acme Suply Co',        city: 'Chicago'   }, threshold: 0.60 },
      { fields: { name: 'Globl Parts Mfg',       city: 'Detroit'   }, threshold: 0.60 },
      { fields: { name: 'New Vendor Alpha Corp',  city: 'Austin'    }, threshold: 0.65, create_if_missing: false },
    ],
  },
  {
    entities: [
      { fields: { name: 'Acme Supply Co',        tax_id: '36-1234567' }, threshold: 0.65 },
      { fields: { name: 'Precison Componants',   city: 'Manchester'   }, threshold: 0.55 },
      { fields: { name: 'Beta Innovations Ltd',  city: 'Seattle'      }, threshold: 0.65, create_if_missing: false },
      { fields: { name: 'Gamma Tech Solutions',  city: 'Boston'       }, threshold: 0.65, create_if_missing: false },
    ],
  },
  {
    entities: [
      { fields: { name: 'Summit Manufacturng',   city: 'Dallas'    }, threshold: 0.60 },
      { fields: { name: 'Apex Industrial Group', tax_id: '47-2345678' }, threshold: 0.65 },
      { fields: { name: 'Riverside Fabricaton',  city: 'Phoenix'   }, threshold: 0.60 },
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
  console.log('\n=== Test Complete ===');
  console.log('Check the thresholds above for p50/p90/p95/p99 per scenario.');
  console.log('Run with --out json=results.json to export raw metrics.');
}
