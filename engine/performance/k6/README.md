# ResolveIQ v2 — K6 Performance Tests

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

# 3. Full performance test (ramp to 10 VUs, ~5 min)
k6 run performance/k6/resolution.perf.js
```

---

## Test Files

| File | Purpose | Duration |
|---|---|---|
| `smoke.js` | 1 VU sanity check before load runs | 30s |
| `resolution.perf.js` | Full load test — p50/p90/p95/p99 | ~5m 30s |

---

## resolution.perf.js — Load Profile

```
VUs
10 ┤                    ╔═══════════╗
 5 ┤           ╔════════╝           ║
 2 ┤  ╔════════╝                   ║
 0 ╠══╝                             ╚═══
   0s  30s  90s  150s  270s  300s  330s
      warm  ramp  ramp  steady  down
```

| Phase | Duration | Target VUs | Purpose |
|---|---|---|---|
| Warm-up | 30s | 2 | Seed NestJS event loop & DB connection pool |
| Ramp-up | 60s | 5 | Gradual load increase |
| Ramp-up | 60s | 10 | Peak load ramp |
| Steady-state | 120s | 10 | **Primary measurement window** |
| Ramp-down | 30s | 0 | Graceful teardown |

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
| `PROFILE` | `supplier-dedup` | Profile slug to resolve against |
| `API_KEY` | *(empty)* | Value for `X-API-Key` header (if required) |

```bash
# Run against staging with auth
k6 run \
  --env BASE_URL=https://staging.resolveiq.internal \
  --env PROFILE=supplier-dedup \
  --env API_KEY=my-secret-key \
  performance/k6/resolution.perf.js
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

K6 prints a summary table after each run. Key metrics to check:

```
✓ http_req_duration............: avg=245ms  p(50)=180ms p(90)=480ms p(95)=720ms p(99)=1200ms
✓ p_exact_resolve_ms...........: avg=55ms   p(50)=42ms  p(90)=95ms  p(95)=130ms p(99)=280ms
✓ p_fuzzy_resolve_ms...........: avg=290ms  p(50)=210ms p(90)=550ms p(95)=780ms p(99)=1400ms
✓ p_semantic_resolve_ms........: avg=480ms  p(50)=420ms p(90)=880ms p(95)=1100ms p(99)=2100ms
✓ p_batch_resolve_ms...........: avg=620ms  p(50)=540ms p(90)=1100ms p(95)=1400ms p(99)=2800ms
✓ http_req_failed..............: 0.00%  0 out of 1840
✓ resolution_errors............: 0.00%  0 out of 1840
```

- `✓` = threshold passed
- `✗` = threshold breached (investigate the scenario)
- `cache_hit_responses` counter shows L0/L1 cache effectiveness
- `new_entity_responses` counter confirms NEW_ENTITY path is working
