# MedCore AI endpoint load-test baseline

> **Important:** the numbers below were captured against the bundled
> **`mock-server.ts`**, not real Sarvam. Latency here is synthetic
> (cubic-skewed uniform between endpoint-specific bounds, see
> `LATENCY_PROFILE` in `mock-server.ts`) and error rate is a fixed 3%
> mix of 429/500/503. These numbers are a **harness-level reference**
> for future regression comparisons (e.g. "did we accidentally break
> the orchestrator so throughput halved at the same concurrency?"),
> not an SLO for production Sarvam behaviour.
>
> Re-run against real Sarvam + authenticated prod with lower
> concurrency + rate-limit-aware parameters once creds are verified,
> and replace / supplement this file with those numbers.

- Captured: 2026-04-24
- Harness: `scripts/load-tests/run-load-test.ts`
- Mock:    `scripts/load-tests/mock-server.ts` on `--port=4010` (defaults:
  `--error-rate=0.03`, `--min-latency=100`, `--max-latency=5000`)
- Runtime: Node v24.15.0, tsx 4.21.0, Windows 11
- Cost model: flat 2000 tokens/call, 1500 in / 500 out, Sarvam public
  generalist prices ($0.0005 in / $0.0015 out per 1K). Order of
  magnitude only.

---

## Triage (`POST /api/v1/ai/triage/:id/message`)

| concurrency | requests | p50 (ms) | p95 (ms) | p99 (ms) | throughput (req/s) | error rate | est. cost (USD) |
| ----------- | -------- | -------- | -------- | -------- | ------------------ | ---------- | --------------- |
| 5           | 50       | 564      | 2819     | 2909     | 3.98               | 4.00%      | $0.0720         |
| 10          | 100      | 516      | 2697     | 2944     | 8.13               | 5.00%      | $0.1425         |
| 25          | 250      | 454      | 2555     | 2914     | 21.65              | 2.80%*     | $0.3645         |

*concurrency=25 also logged 1 `prepare` (triage/start) failure counted
 separately from the 7 request-level errors.

## Scribe (`POST /api/v1/ai/scribe/generate-soap`)

| concurrency | requests | p50 (ms) | p95 (ms) | p99 (ms) | throughput (req/s) | error rate | est. cost (USD) |
| ----------- | -------- | -------- | -------- | -------- | ------------------ | ---------- | --------------- |
| 5           | 50       | 684      | 4516     | 4616     | 3.18               | 2.00%      | $0.0735         |
| 10          | 100      | 903      | 4642     | 4853     | 5.64               | 0.00%      | $0.1500         |
| 25          | 250      | 777      | 4007     | 4706     | 15.12              | 2.00%      | $0.3675         |

## Chart-search (`POST /api/v1/ai/chart-search/patient/:id`)

| concurrency | requests | p50 (ms) | p95 (ms) | p99 (ms) | throughput (req/s) | error rate | est. cost (USD) |
| ----------- | -------- | -------- | -------- | -------- | ------------------ | ---------- | --------------- |
| 5           | 50       | 639      | 3323     | 3449     | 3.93               | 2.00%      | $0.0735         |
| 10          | 100      | 437      | 3421     | 3823     | 8.20               | 1.00%      | $0.1485         |
| 25          | 250      | 561      | 3554     | 3937     | 18.37              | 3.20%      | $0.3630         |

---

## Interpretation

- **Triage held p95 under 3 s at every concurrency level tested
  (5/10/25).** Expected: it's the fastest latency profile in the mock
  (`minMul=1.0, maxMul=0.6` → ~100–3000 ms).
- **Scribe p95 sits in the 4.0–4.7 s band**, markedly slower than
  triage — also expected: the scribe profile is the heaviest
  (`minMul=3.0, maxMul=1.0` → ~300–5000 ms), mirroring the real
  tool-calling + longer-output nature of SOAP generation.
- **Chart-search lands in the middle** (`minMul=1.5, maxMul=0.8` →
  ~150–4000 ms) with p95 around 3.3–3.6 s.
- **Throughput scales near-linearly with concurrency** on all three
  endpoints (triage ~4 → 8 → 22, scribe ~3 → 6 → 15, chart-search
  ~4 → 8 → 18), confirming the orchestrator isn't self-bottlenecking
  inside the test range. Scribe's lower absolute numbers are purely
  driven by per-call latency, not harness contention.
- **Error rate hovers around the mock's built-in 3%** across all
  runs, with slight variance from the small sample sizes. The
  orchestrator correctly categorises 429 / 500 / 503 separately, so
  real-API rate-limit vs upstream-blip can be distinguished at a
  glance.
- **p99 is within ~400 ms of p95** on every row — the cubic skew on
  the mock means the long tail rarely pushes past the configured
  max. Real Sarvam will almost certainly have a fatter tail; treat
  this as an optimistic floor, not a target.

## Commands used (reproducibility)

```bash
# Shell 1 — mock server (one-shot, shared across all 9 runs)
npx tsx scripts/load-tests/mock-server.ts --port=4010

# Shell 2 — triage
npx tsx scripts/load-tests/run-load-test.ts --endpoint=triage       --concurrency=5  --requests=50  --mock-port=4010
npx tsx scripts/load-tests/run-load-test.ts --endpoint=triage       --concurrency=10 --requests=100 --mock-port=4010
npx tsx scripts/load-tests/run-load-test.ts --endpoint=triage       --concurrency=25 --requests=250 --mock-port=4010

# scribe
npx tsx scripts/load-tests/run-load-test.ts --endpoint=scribe       --concurrency=5  --requests=50  --mock-port=4010
npx tsx scripts/load-tests/run-load-test.ts --endpoint=scribe       --concurrency=10 --requests=100 --mock-port=4010
npx tsx scripts/load-tests/run-load-test.ts --endpoint=scribe       --concurrency=25 --requests=250 --mock-port=4010

# chart-search (mock uses a literal "mock-patient" id; no --patient-id needed)
npx tsx scripts/load-tests/run-load-test.ts --endpoint=chart-search --concurrency=5  --requests=50  --mock-port=4010
npx tsx scripts/load-tests/run-load-test.ts --endpoint=chart-search --concurrency=10 --requests=100 --mock-port=4010
npx tsx scripts/load-tests/run-load-test.ts --endpoint=chart-search --concurrency=25 --requests=250 --mock-port=4010
```

## Next step

When real Sarvam credentials + admin auth are verified end-to-end on a
non-prod environment:

1. Drop `--mock-port` and pass `--base-url=<staging API root>`.
2. Start at **lower concurrency** (1, 3, 5) — Sarvam public/dev-tier
   rate-limits kick in past ~20 concurrent requests per shared key.
3. Keep `--requests` modest (~25 per run) to cap Sarvam spend. A full
   250-request scribe run against real Sarvam is ~500K tokens ≈ $0.60
   at current prices; cheap but adds up with repeated regressions.
4. For `chart-search`, pass a real `--patient-id=<uuid>` the test
   admin can read — the mock accepts any string but the real endpoint
   will authorise against the patient's clinic.
5. Re-run this full matrix + note the delta vs mock numbers here.
   Anywhere the real p95 exceeds the mock p95 by >2x, investigate
   (likely Sarvam tail latency or retry-storm from `withRetry`).
