# ABDM Local Sandbox Mock

A zero-dependency Node HTTP server that stands in for
`https://dev.abdm.gov.in/gateway` so you can exercise MedCore's ABDM flows
end-to-end without real sandbox credentials.

## Run

```bash
npx tsx scripts/abdm-mock-server.ts --port=4020
npx tsx scripts/abdm-mock-server.ts --port=4020 --verbose   # dump payloads
```

Startup logs every request plus every webhook sent, to **stderr**. In verbose
mode it also dumps the request body and the webhook JSON.

## Point MedCore at the mock

Add these to `apps/api/.env`:

```bash
ABDM_CLIENT_ID=TEST_CLIENT_1
ABDM_CLIENT_SECRET=any-value-will-do
ABDM_BASE_URL=http://localhost:4020
ABDM_GATEWAY_URL=http://localhost:4020
ABDM_JWKS_URL=http://localhost:4020/gateway/v0.5/certs
ABDM_CM_ID=sbx
ABDM_SKIP_VERIFY=false   # leave real signature verification on
```

Then restart the API (`npm run dev --workspace apps/api`).

## Test accounts / magic values

| Field            | Mock accepts                             | Otherwise       |
|------------------|------------------------------------------|-----------------|
| `clientId`       | anything starting with `TEST_`           | → 401           |
| `healthid`       | anything ending with `@abdm`             | → 404           |
| OTP              | exactly `123456`                         | → 401           |

So `TEST_CLIENT_1` / `sumit@abdm` / `123456` is the canonical happy path.

## Webhook timing

| Endpoint                                 | Webhook delay |
|------------------------------------------|---------------|
| `POST /v0.5/consent-requests/init`       | 3s            |
| `POST /v0.5/health-information/cm/request` | 5s          |

Each webhook is signed with an RS256 JWT. The public key is served at
`GET /gateway/v0.5/certs` — the private half never leaves memory.

## Manual probing

```bash
# 1. Token exchange
curl -s -XPOST http://localhost:4020/v0.5/sessions \
  -H 'Content-Type: application/json' \
  -d '{"clientId":"TEST_CLIENT_1","clientSecret":"foo"}'

# 2. ABHA init
curl -s -XPOST http://localhost:4020/v0.5/users/auth/init \
  -H 'Content-Type: application/json' \
  -d '{"authMode":"MOBILE_OTP","purpose":"KYC","healthid":"sumit@abdm"}'

# 3. OTP confirm
curl -s -XPOST http://localhost:4020/v0.5/users/auth/confirmWithMobileOtp \
  -H 'Content-Type: application/json' \
  -d '{"otp":"123456","healthid":"sumit@abdm"}'

# 4. Consent request (fires webhook to http://localhost:4000/api/v1/abdm/gateway/callback after 3s)
curl -s -XPOST http://localhost:4020/v0.5/consent-requests/init \
  -H 'Content-Type: application/json' \
  -d '{"callbackUrl":"http://localhost:4000/api/v1/abdm/gateway/callback"}'

# 5. JWKS
curl -s http://localhost:4020/gateway/v0.5/certs | jq .
```

## End-to-end runner

`scripts/abdm-e2e.ts` spawns the mock, boots the MedCore API with the env
vars wired up, walks ABHA verify → link → consent → care-context, and checks
that DB state advances. Needs a live Postgres and at least one seeded
patient — set `E2E_PATIENT_ID=<uuid>` before running:

```bash
E2E_PATIENT_ID=00000000-0000-0000-0000-000000000001 npx tsx scripts/abdm-e2e.ts
```

## What the mock does **not** cover

- **Real encryption round-trips at the HIU end.** The `encryptedBundle` we
  emit is just random bytes; nothing decrypts to a FHIR bundle. If you're
  testing our ECDH + AES-GCM implementation, write a focused unit test
  against `services/abdm/crypto.ts` instead.
- **Multi-HIU consent artefacts.** The real gateway fans artefacts out to
  every HIU the patient has authorised; we only send one copy to the
  caller's `callbackUrl`.
- **Full consent artefact lifecycle** — grant → notify → expire → revoke.
  We only send a single GRANTED notification.
- **CM-side digest header validation** (the `X-HIP-ID` / `X-HIU-ID`
  signature challenge). The mock does not check these, and only signs the
  callback body JWT.
- **Sandbox rate limiting / 429 / Retry-After backoff.** Mock always
  responds immediately.
- **Refresh-token rotation** — `expiresIn: 3600` is returned but tokens do
  not actually expire inside the mock.
- **Key rotation.** A single kid is generated at startup and reused for the
  life of the process. Restart the mock to rotate.

## Gotchas

- **Webhook tuning.** Default delays are 3s and 5s. If you bump Node's
  `--max-old-space-size` or hit CI hosts with long fsync latency, bump the
  e2e runner's settle window (currently `6s`) to at least `max(delay) +
  2s`.
- **Firewall.** The mock binds to the loopback interface only if you pass
  `--host=127.0.0.1`; by default it uses Node's implicit `0.0.0.0` so
  container runners on WSL/Docker can reach it.
- **`ABDM_SKIP_VERIFY=true`.** Works, but then the mock's JWT signing is
  no longer exercised. Keep it `false` for realistic local runs.
- **Port clash.** 4020 is not otherwise reserved in the MedCore stack;
  4000 (API) and 3000 (web) are. Change `--port` if your host uses 4020
  for something else.
