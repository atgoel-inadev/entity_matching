# ResolveIQ v2 — K6 Performance Tests (100+ Entity Coverage)

## Overview

Comprehensive performance testing suite that validates ResolveIQ v2 resolution pipeline
under realistic concurrent load with **100+ unique entity variations**.

**Test Coverage**:
- ✅ 30+ EXACT fast-path scenarios (high-weight field matches)
- ✅ 30+ FUZZY resolution scenarios (1-3 character typos)
- ✅ 30+ SEMANTIC embedding scenarios (descriptive free-text queries)
- ✅ 15+ NO_MATCH scenarios (completely novel entities)
- ✅ 10+ BATCH resolution scenarios (3-4 concurrent entities)

**Percentile Metrics**: p50, p90, p95, p99 for all scenarios + global HTTP latency

---

## Prerequisites

Install K6:
```bash
# macOS
brew install k6

# Windows (scoop)
scoop install k6

# Windows (choco)
choco install k6

# Docker
docker pull grafana/k6
```

---

## Quick Start

```bash
# 1. Start the engine
cd engine && npm run start:dev

# 2. Smoke test (1 VU, 30s — verify endpoints before load test)
k6 run performance/k6/smoke.js

# 3. Full performance test (ramp to 20 VUs, ~6 min, 100+ entities)
k6 run performance/k6/resolution.perf.js
```

---

## Test Files

| File | Purpose | Duration | Entities |
|---|---|---|---|
| `smoke.js` | 1 VU sanity check before load runs | 30s | ~10 |
| `resolution.perf.js` | Full load test — p50/p90/p95/p99 | ~6m | **100+** |

---

## resolution.perf.js — Load Profile

```
VUs
20 ┤                    ╔═════════════════════╗
10 ┤           ╔════════╝                     ║
 3 ┤  ╔════════╝                             ║
 0 ╠══╝                                       ╚══
   0s  30s  90s  150s  330s  360s
      warm  ramp  ramp   steady   down
```

| Phase | Duration | Target VUs | Purpose |
|---|---|---|---|
| Warm-up | 30s | 3 | Seed NestJS event loop & DB connection pool |
| Ramp-up | 60s | 10 | Gradual load increase |
| Ramp-up | 60s | 20 | Peak load ramp (tests 100+ entities) |
| Steady-state | 180s | 20 | **Primary measurement window** |
| Ramp-down | 30s | 0 | Graceful teardown |

**Total test duration**: ~6 minutes  
**Expected iterations**: ~2000+ (100+ unique entities, multiple iterations each)

---

## Scenarios (Round-Robin by VU Index)

| VU % 5 | Scenario | Path | What it tests |
|---|---|---|---|
| 0 | EXACT fast-path | `POST /resolve` with `tax_id` | FastPathChecker SQL bypass |
| 1 | FUZZY resolution | `POST /resolve` with name typos | Levenshtein scoring over candidates |
| 2 | SEMANTIC resolution | `POST /resolve` with free-text | Snowflake Cortex embedding + ANN search |
| 3 | Batch resolve | `POST /resolve/batch` (3–4 entities) | `Promise.allSettled` parallelism |
| 4 | No-match | `POST /resolve` with novel data | Full pipeline, no match result |

---

## Latency Thresholds

### Per-Scenario Thresholds (hard-coded in script)

| Metric | p50 | p90 | p95 | p99 |
|---|---|---|---|---|
| **Overall HTTP** | < 400ms | < 900ms | < 1400ms | < 2500ms |
| `exact_resolve_ms` | < 100ms | < 200ms | < 300ms | < 600ms |
| `fuzzy_resolve_ms` | < 300ms | < 700ms | < 1000ms | < 1800ms |
| `semantic_resolve_ms` | < 600ms | < 1200ms | < 1800ms | < 3000ms |
| `batch_resolve_ms` | < 900ms | < 1800ms | < 2500ms | < 4000ms |

> **Abort-on-fail**: The test hard-stops if `http_req_duration p(99) > 2500ms`
> or error rate exceeds 1%.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `http://localhost:8001` | Engine base URL |
| `PROFILE` | `b2b-supplier` | Profile slug to resolve against |
| `API_KEY` | *(empty)* | Value for `X-API-Key` header (if required) |

```bash
# Run against staging with auth
k6 run \
  --env BASE_URL=https://staging.resolveiq.internal \
  --env PROFILE=b2b-supplier \
  --env API_KEY=my-secret-key \
  performance/k6/resolution.perf.js

# Run with different profile
k6 run --env PROFILE=supplier-dedup performance/k6/resolution.perf.js
```

---

## Exporting Results

```bash
# Export raw JSON metrics
k6 run --out json=results/run-$(date +%Y%m%d-%H%M).json performance/k6/resolution.perf.js

# Export to InfluxDB + view in Grafana
k6 run --out influxdb=http://localhost:8086/k6 performance/k6/resolution.perf.js

# Run via Docker (no local install needed)
docker run --rm -i \
  --network host \
  grafana/k6 run \
  --env BASE_URL=http://localhost:8001 \
  - < performance/k6/resolution.perf.js
```

---

## Reading the Output

The test prints a comprehensive summary with detailed percentile breakdowns:

### Standard K6 Metrics Table

```
✓ http_req_duration............: avg=245ms  p(50)=180ms p(90)=480ms p(95)=720ms p(99)=1200ms
✓ p_exact_resolve_ms...........: avg=55ms   p(50)=42ms  p(90)=95ms  p(95)=130ms p(99)=280ms
✓ p_fuzzy_resolve_ms...........: avg=290ms  p(50)=210ms p(90)=550ms p(95)=780ms p(99)=1400ms
✓ p_semantic_resolve_ms........: avg=480ms  p(50)=420ms p(90)=880ms p(95)=1100ms p(99)=2100ms
✓ p_batch_resolve_ms...........: avg=620ms  p(50)=540ms p(90)=1100ms p(95)=1400ms p(99)=2800ms
✓ http_req_failed..............: 0.00%  0 out of 2140
✓ resolution_errors............: 0.00%  0 out of 2140
```

### Custom Detailed Percentile Breakdown

After the standard K6 summary, the test prints an enhanced breakdown:

```
╔════════════════════════════════════════════════════════════════════╗
║                   DETAILED PERCENTILE BREAKDOWN                    ║
╚════════════════════════════════════════════════════════════════════╝

📊 EXACT Fast-Path (target: p99<600ms)
   ├─ p50:  42.18ms
   ├─ p90:  95.32ms
   ├─ p95:  130.45ms
   ├─ p99:  280.12ms
   ├─ avg:  55.23ms
   └─ max:  340.67ms

📊 FUZZY Resolution (target: p99<1800ms)
   ├─ p50:  210.45ms
   ├─ p90:  550.78ms
   ├─ p95:  780.23ms
   ├─ p99:  1400.56ms
   ├─ avg:  290.12ms
   └─ max:  1650.89ms

[... SEMANTIC, BATCH, HTTP metrics follow ...]

╔════════════════════════════════════════════════════════════════════╗
║                         ERROR SUMMARY                              ║
╚════════════════════════════════════════════════════════════════════╝

❌ Resolution Errors: 0.00% (target: <1%)
🔴 HTTP Failures:     0.00% (target: <1%)

╔════════════════════════════════════════════════════════════════════╗
║                         CACHE PERFORMANCE                          ║
╚════════════════════════════════════════════════════════════════════╝

💾 Cache Hit Rate: 62.35% (1334 hits / 2140 requests)

✅ Test Coverage:
   • 30 EXACT fast-path scenarios
   • 30 FUZZY resolution scenarios
   • 30 SEMANTIC embedding scenarios
   • 15 NO_MATCH scenarios
   • 10 BATCH resolve scenarios
   • Total: 115+ unique entity variations
```

### What to Look For

- `✓` = threshold passed
- `✗` = threshold breached (investigate the scenario)
- **p50** (median) should be fast even under load
- **p90** represents typical user experience
- **p95/p99** catch outliers and worst-case latency
- `cache_hit_responses` counter shows L0/L1 cache effectiveness
- `new_entity_responses` counter confirms NEW_ENTITY path is working

### HTML Report

Run with HTML output for visual charts:

```bash
k6 run --out json=results.json performance/k6/resolution.perf.js

# HTML report auto-generated as summary.html
# Open in browser to see percentile graphs
```
