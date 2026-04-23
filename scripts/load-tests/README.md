# MedCore AI endpoint load tests

Lightweight, zero-dependency load/perf harness for characterising MedCore's
Sarvam-backed AI endpoints under concurrent load. Use it to answer:

- Where do latencies sit at p50/p95/p99 under N concurrent clients?
- When does Sarvam rate-limit us, and does `withRetry` absorb it?
- What's the rough per-run Sarvam cost before shipping a feature?

No npm deps were added. Runs under tsx via `node >= 20` (`fetch`,
`perf_hooks`, `http` are all built-ins).

---

## Files

| File               | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `run-load-test.ts` | Orchestrator: spawns N workers, records latencies, prints summary   |
| `payloads.ts`      | Triage prompts, scribe transcripts, chart-search queries            |
| `auth-helper.ts`   | Logs in as seeded admin, caches bearer token                        |
| `mock-server.ts`   | Zero-dep HTTP server mimicking AI endpoints with realistic latency  |

---

## Quick start (mock mode — no Sarvam cost)

Open two shells.

**Shell 1 — start the mock server:**

```bash
tsx scripts/load-tests/mock-server.ts --port=4010 --verbose
```

**Shell 2 — run a triage load test against the mock:**

```bash
tsx scripts/load-tests/run-load-test.ts \
  --endpoint=triage \
  --concurrency=10 \
  --requests=100 \
  --mock-port=4010
```

Or via the npm script:

```bash
npm run test:load -- --endpoint=triage --mock-port=4010 --requests=50
```

## Against a real (local or staging) API

Start the MedCore API normally, then:

```bash
tsx scripts/load-tests/run-load-test.ts \
  --endpoint=triage \
  --concurrency=5 \
  --requests=25 \
  --base-url=http://localhost:4000
```

For chart-search you must supply a real patient id the test account can read:

```bash
tsx scripts/load-tests/run-load-test.ts \
  --endpoint=chart-search \
  --patient-id=00000000-0000-0000-0000-000000000001 \
  --concurrency=5 --requests=25
```

---

## CLI flags (run-load-test.ts)

| Flag             | Default                 | Notes                                                               |
| ---------------- | ----------------------- | ------------------------------------------------------------------- |
| `--endpoint`     | **required**            | `triage` \| `scribe` \| `chart-search`                              |
| `--concurrency`  | `10`                    | Number of in-flight workers                                         |
| `--requests`     | `100`                   | Total requests across all workers                                   |
| `--base-url`     | `http://localhost:4000` | Target MedCore API root                                             |
| `--mock-port`    | _(unset)_               | If set, overrides base-url to `http://localhost:<port>` and bypasses real login |
| `--patient-id`   | _(unset)_               | Required by `chart-search` against a real API                       |
| `--verbose`      | _(off)_                 | Log per-request result lines                                        |

### mock-server.ts flags

| Flag              | Default | Notes                                                    |
| ----------------- | ------- | -------------------------------------------------------- |
| `--port`          | `4010`  | Listen port                                              |
| `--error-rate`    | `0.03`  | Fraction of requests that return 429/500/503             |
| `--min-latency`   | `100`   | ms — lower bound before per-endpoint multiplier          |
| `--max-latency`   | `5000`  | ms — upper bound before per-endpoint multiplier          |
| `--verbose`       | _(off)_ | Log per-request to stdout                                |

---

## Expected baselines (guidance, not SLA)

These are targets to watch for; **actual numbers depend on the Sarvam tier
we're on and whether retries kick in.** Treat as smell-test thresholds, not
contract-level SLOs.

| Endpoint / scenario          | Target p95 | Notes                                                       |
| ---------------------------- | ---------- | ----------------------------------------------------------- |
| Triage (one turn)            | **< 3 s**  | Short prompt, single LLM call                               |
| SOAP generation              | **< 15 s** | Large prompt, tool-calling, longer output                   |
| Chart search                 | **< 4 s**  | Retrieval + short synthesis                                 |
| Error rate @ concurrency=10  | **< 1 %**  | Transport or 5xx only — not counting intentional red-flags  |
| Error rate @ concurrency=50  | _expect rate limits_ | Sarvam 429s are normal here; `withRetry` should swallow most |

If any of these slip by >2x or error rate >10% at concurrency=10, something
regressed — open an incident before the next release.

---

## What the summary prints

At the end of a run you get:

- Wall time, total completed, ok count, error count, **error rate**
- **Throughput** in req/s
- **Latency** (min, p50, p95, p99, max) over successful requests only
- **Cost estimate** in USD assuming ~2000 tokens/call at current Sarvam
  generalist-tier prices (1500 in / 500 out split, input $0.0005/1K,
  output $0.0015/1K)
- Error status breakdown + sample error messages

> The cost numbers are **order-of-magnitude**, not billing-accurate.
> Re-check Sarvam's pricing page before quoting figures in a review.

---

## Sarvam quota notes

- Public / dev tier rate-limits kick in aggressively past ~20 concurrent
  requests. Don't run 50+ concurrency against real Sarvam without warning
  the team — we share one API key.
- The `scribe` endpoint eats the most tokens per call; 100 requests ≈ 200k
  tokens ≈ ~$0.25 at current prices. Small per run, but easy to burn if
  you leave a loop going.
- **Always run mock mode first** to validate the harness before pointing
  it at real Sarvam.

---

## Deliberately skipped (open tickets if you need these)

- **Coordinated-omission correction.** We record latency as
  `end - start` per request. A slow request *does* delay subsequent work
  for its worker, but we don't back-fill expected-start times à la
  wrk2/HdrHistogram. Fine for smoke sizing; not publishable p99s.
- **Histogram export.** Summary prints percentiles computed from a sorted
  list. We don't write an HdrHistogram / `.hgrm` file for merging across
  runs.
- **Ramp / warmup phase.** Workers start simultaneously — no ramp-up. For
  cold-start curves, run sequentially with low concurrency first.
- **Per-endpoint cost multipliers.** Cost estimate uses a flat 2000
  tokens/call. Scribe + long-transcript cases are under-estimated.
- **Distributed / multi-host runs.** Single-process only.
- **Scribe real-API happy path.** The real scribe flow needs a pre-seeded
  appointment + session; against a real API the harness will 4xx on
  `/generate-soap` unless you wire in a matching route or use mock mode.
