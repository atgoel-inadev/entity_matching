/**
 * K6 Smoke Test — ResolveIQ v2
 *
 * Runs a minimal 1-VU, 30s test to verify the API is healthy before
 * launching the full performance test. Checks all endpoints used in
 * resolution.perf.js and validates response shapes.
 *
 * Usage:
 *   k6 run smoke.js
 *   k6 run --env BASE_URL=http://localhost:8001 smoke.js
 */

import http  from 'k6/http';
import { check, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8001';
const PROFILE  = __ENV.PROFILE  || 'supplier-dedup';
const API_KEY  = __ENV.API_KEY  || '';

const HEADERS = {
  'Content-Type': 'application/json',
  ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
};

export const options = {
  vus:      1,
  duration: '30s',
  thresholds: {
    'http_req_duration': ['p(95)<2000'],
    'http_req_failed':   ['rate<0.01'],
  },
};

export default function () {
  // ── Health ─────────────────────────────────────────────────────────────────
  group('health', () => {
    const res = http.get(`${BASE_URL}/health`, { headers: HEADERS });
    check(res, {
      'health: status 200': (r) => r.status === 200,
      'health: has status field': (r) => JSON.parse(r.body).status !== undefined,
    });
  });

  // ── Profile exists ─────────────────────────────────────────────────────────
  group('get_profile', () => {
    const res = http.get(`${BASE_URL}/profiles/${PROFILE}`, { headers: HEADERS });
    check(res, {
      'profile: status 200':          (r) => r.status === 200,
      'profile: has profile_slug':    (r) => JSON.parse(r.body).profile_slug !== undefined,
      'profile: has fields array':    (r) => Array.isArray(JSON.parse(r.body).fields),
      'profile: has default_threshold': (r) => JSON.parse(r.body).default_threshold !== undefined,
    });
  });

  // ── Single exact resolve ───────────────────────────────────────────────────
  group('resolve_exact', () => {
    const res = http.post(
      `${BASE_URL}/profiles/${PROFILE}/resolve`,
      JSON.stringify({
        fields:    { name: 'Acme Supply Co', tax_id: '36-1234567' },
        threshold: 0.65,
      }),
      { headers: HEADERS },
    );
    check(res, {
      'resolve: status 200':        (r) => r.status === 200,
      'resolve: has match_type':    (r) => JSON.parse(r.body).match_type !== undefined,
      'resolve: has execution_ms':  (r) => JSON.parse(r.body).execution_ms > 0,
      'resolve: has field_scores':  (r) => Array.isArray(JSON.parse(r.body).field_scores),
      'resolve: is_new_entity bool':(r) => typeof JSON.parse(r.body).is_new_entity === 'boolean',
    });
  });

  // ── Batch resolve ──────────────────────────────────────────────────────────
  group('batch_resolve', () => {
    const res = http.post(
      `${BASE_URL}/profiles/${PROFILE}/resolve/batch`,
      JSON.stringify({
        entities: [
          { fields: { name: 'Acme Suply Co',   city: 'Chicago' }, threshold: 0.60 },
          { fields: { name: 'Globl Parts Mfg', city: 'Detroit' }, threshold: 0.60 },
        ],
      }),
      { headers: HEADERS },
    );
    check(res, {
      'batch: status 200':        (r) => r.status === 200,
      'batch: has results':       (r) => Array.isArray(JSON.parse(r.body).results),
      'batch: results length 2':  (r) => JSON.parse(r.body).results.length === 2,
      'batch: total_processed 2': (r) => JSON.parse(r.body).total_processed === 2,
    });
  });

  // ── Find similar ───────────────────────────────────────────────────────────
  group('find_similar', () => {
    const res = http.post(
      `${BASE_URL}/profiles/${PROFILE}/find-similar?limit=5`,
      JSON.stringify({
        fields:    { name: 'Acme Supply' },
        threshold: 0.50,
      }),
      { headers: HEADERS },
    );
    check(res, {
      'find_similar: status 200':     (r) => r.status === 200,
      'find_similar: returns array':  (r) => Array.isArray(JSON.parse(r.body)),
      'find_similar: max 5 results':  (r) => JSON.parse(r.body).length <= 5,
    });
  });
}
