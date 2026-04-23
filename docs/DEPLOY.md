# MedCore Production Deploy Runbook

> **Single authoritative runbook for deploying MedCore to prod.**
> Host: `163.227.174.141` (Ubuntu 22.04). nginx terminates TLS and proxies to
> PM2 processes `medcore-api` (port 4100) and `medcore-web` (port 3200).
> PostgreSQL runs in Docker (`medcore-postgres`) bound to host port 5433.
>
> Companion docs:
> - Ops details & health checks: [`DEPLOYMENT.md`](DEPLOYMENT.md)
> - Migration policy: [`MIGRATIONS.md`](MIGRATIONS.md)
> - Architecture overview: [`ARCHITECTURE.md`](ARCHITECTURE.md)
> - AI subsystems: [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md)
> - Dev onboarding: [`ONBOARDING.md`](ONBOARDING.md)

---

## 1. Pre-deploy checklist (run locally)

Do all of this on your laptop **before** SSHing into prod.

- [ ] `git fetch && git status` — working tree clean, on `main`, up to date.
- [ ] `scripts/pre-deploy-check.sh` passes (green summary).
- [ ] Release notes / CHANGELOG updated for any schema or breaking change.
- [ ] Any new env var documented in `apps/api/.env.example`.
- [ ] Confirmed the migration list in section 2 matches what is pending.
- [ ] You have SSH access to `163.227.174.141` as `empcloud-development`.
- [ ] You know the last verified-healthy SHA (section 7) so you can roll back.
- [ ] Backups have run within 24 h: `ls -lh /var/backups/medcore/ | head -3`.
- [ ] A teammate is reachable on Slack in case rollback is needed.

Do **not** deploy when:

- The CI pipeline on `main` is red.
- Any `prisma migrate dev` has been run against the dev DB but the resulting
  migration folder is not committed.
- There are local modifications to `packages/db/prisma/schema.prisma` that
  have not been materialised as a migration folder.

---

## 2. Outstanding migrations

The following migrations live in `packages/db/prisma/migrations/` and are
currently pending on prod (as of 2026-04-23):

| Folder | Introduces |
|---|---|
| `20260423000001_ai_features_models` | AI Triage / Scribe / Drug-safety data models |
| `20260423000002_abdm_insurance_jitsi_rag_models` | ABDM linkage, InsuranceClaim2 (TPA-aware), Jitsi rooms, RAG ingest tables |
| `20260423000003_adherence_dose_log` | Medication-adherence dose-log + reminder queue |
| `20260423000004_tenant_scoping` | *(pending — tenant agent finishing; do NOT deploy until merged to `main` and covered by `pre-deploy-check.sh`)* |

`prisma migrate deploy` applies them in lexical (timestamp) order. Never edit
a migration folder after it has landed on prod — add a forward-only fix.

---

## 3. Step-by-step deploy sequence

Nine ordered steps. Every step must succeed before moving to the next.

```bash
ssh empcloud-development@163.227.174.141
cd /home/empcloud-development/medcore
```

1. **Record the current SHA** (rollback target):
   ```bash
   git rev-parse HEAD | tee /tmp/medcore-prev-sha
   ```
2. **Pull latest `main`:**
   ```bash
   git fetch origin && git checkout main && git pull --ff-only origin main
   ```
3. **Install dependencies (clean, lockfile-exact):**
   ```bash
   npm ci --ignore-scripts
   ```
4. **Show pending migrations** (read-only confirmation):
   ```bash
   npx prisma migrate status --schema packages/db/prisma/schema.prisma
   ```
5. **Apply migrations (forward-only, never resets):**
   ```bash
   npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
   ```
6. **Regenerate Prisma client** (schema may have new models/enums):
   ```bash
   npx prisma generate --schema packages/db/prisma/schema.prisma
   ```
7. **Build web bundle:**
   ```bash
   npm --prefix apps/web run build
   ```
8. **Restart PM2 processes:**
   ```bash
   pm2 restart medcore-api medcore-web && pm2 save
   ```
9. **Health check + smoke test:**
   ```bash
   scripts/verify-deploy.sh
   npx tsx scripts/prod-smoke-test.ts
   ```

Prefer the wrapper script which chains 2-9 with pre-flight guards:

```bash
scripts/deploy.sh
```

---

## 4. Rollback plan

If any step 5-9 fails or post-deploy verification finds a regression:

```bash
# 1. Stop serving bad code
pm2 stop medcore-api medcore-web

# 2. Revert working tree to the recorded previous SHA
cd /home/empcloud-development/medcore
git reset --hard "$(cat /tmp/medcore-prev-sha)"

# 3. Reinstall (lockfile may have moved)
npm ci --ignore-scripts

# 4. Regenerate Prisma client for the OLD schema
npx prisma generate --schema packages/db/prisma/schema.prisma

# 5. Rebuild web and bring processes back up
npm --prefix apps/web run build
pm2 restart medcore-api medcore-web
pm2 save

# 6. Verify
scripts/verify-deploy.sh
```

**Migrations are additive and NOT rolled back automatically.** The
`20260423*` migrations only add tables/columns — old application code
ignores them safely. If a migration ever needs to be reverted:

1. Restore from backup (section 4 of `DEPLOYMENT.md`) — always prefer this.
2. Or hand-write a forward-only fix migration; never edit a committed one.

Never run `prisma migrate reset`, `db push --force-reset`, or
`--accept-data-loss` in prod. Ever.

---

## 5. Data migration — insurance claims v2

The legacy `insurance_claims` table is being migrated into the TPA-aware
`insurance_claims_v2` table. Script:
`scripts/migrate-insurance-claims-to-v2.ts`. Detailed field-map in
[`scripts/README-insurance-migration.md`](../scripts/README-insurance-migration.md).

Run this **after** step 9 of section 3 — never during the deploy window.

```bash
# (A) Dry-run — prints what would change, writes nothing:
npx tsx scripts/migrate-insurance-claims-to-v2.ts

# (B) Review the summary JSON on stdout + stderr log:
#     - total legacy rows, planned inserts, skipped rows, synthesised fields
#     - any rows with ambiguous PreAuthRequest linkage (must be accepted)

# (C) Apply (idempotent via providerClaimRef = "LEGACY-<id>"):
npx tsx scripts/migrate-insurance-claims-to-v2.ts --apply

# (D) Verify parity:
npx tsx scripts/verify-insurance-claims-migration.ts
```

The migration never deletes legacy rows. Only after the verifier reports
green (row-count + field spot-checks match) do we consider the legacy table
safe to drop — and that drop is a separate, future, reviewed migration.

Tunables: `--batch-size=<N>` (default 100). Each batch is one
`prisma.$transaction` so a bad row only rolls back its own batch.

---

## 6. Post-deploy verification

Two scripted checks + four manual spot-checks.

### Scripted

```bash
scripts/verify-deploy.sh
#   - GET /api/health returns 200 {status:"ok"}
#   - OPTIONS against 10 AI routes — none return 5xx
#   - psql SELECT 1 succeeds

npx tsx scripts/prod-smoke-test.ts
#   - GETs 7 dashboard pages; accepts 200/302/307
```

Both must exit 0.

### Manual spot-checks

Log in as a test doctor and walk through:

| Page | What to check |
|---|---|
| `/dashboard/abdm` | ABDM status tile renders; "Link ABHA" flow opens without 500. |
| `/dashboard/fhir-export` | Patient picker loads; test export to scratch patient returns a downloadable bundle. |
| `/dashboard/insurance-claims` | Table loads from `insurance_claims_v2` (TPA column visible); "New claim" form accepts submit. |
| `/dashboard/ai/chart-search` | Search bar returns results; answer cites 1+ source chart row. |

If any fail, see section 8 before rolling back — most are nginx cache or
Prisma-client-regen issues, not data corruption.

---

## 7. Known-good baseline

| Field | Value |
|---|---|
| Last verified-healthy SHA | `b69da68` (`docs: add AI Triage, AI Scribe, Drug Safety to README; update stats`) |
| Verified on | 2026-04-22 |
| Env-var template in use | `apps/api/.env.example` at that SHA (no new required vars since) |
| `prisma migrate status` at that SHA | all applied through `20260422000001_triage_consent_fields`, none pending |
| Pending at time of next deploy | `20260423000001`, `20260423000002`, `20260423000003`, (`20260423000004` once merged) |

Record the new SHA here after each green deploy — this file is the source
of truth for "what is actually on the box right now".

---

## 8. Environment variables

Canonical template: `apps/api/.env.example` (never commit real values).
Prod `.env` lives at `/home/empcloud-development/medcore/.env` (chmod 600,
git-ignored). Mobile is built-time; values baked via EAS.

Legend: **SM** = secret-management (vault / sealed), **CM** = config-management
(plaintext in `.env`, non-sensitive), **R** = required, **r** = recommended,
**o** = optional (feature falls back to mock / disabled).

### API (`/home/empcloud-development/medcore/.env`)

| Var | Class | Level | Notes |
|---|---|---|---|
| `DATABASE_URL` | SM | R | Postgres DSN — server refuses to start without. |
| `JWT_SECRET` | SM | R | Access-token HS256 secret. |
| `JWT_REFRESH_SECRET` | SM | R | Refresh-token HS256 secret. |
| `UPLOAD_SIGNING_SECRET` | SM | R | Signed-URL HMAC secret for uploads. |
| `PORT` | CM | R | 4100 in prod (see `ecosystem.medcore.config.js`). |
| `NODE_ENV` | CM | R | `production`. |
| `CORS_ORIGIN` | CM | R | `https://medcore.globusdemos.com`. |
| `SARVAM_API_KEY` | SM | r | AI features fall back to mock responses if unset. |
| `RAZORPAY_KEY_ID` | SM | r | Billing runs in mock mode without this pair. |
| `RAZORPAY_KEY_SECRET` | SM | r | Paired with `RAZORPAY_KEY_ID`. |
| `RAZORPAY_WEBHOOK_SECRET` | SM | R-if-live | Required if Razorpay is live; webhook rejects everything otherwise. |
| `WHATSAPP_API_KEY` / `WHATSAPP_API_URL` | SM | o | Mock logs message if unset. |
| `SMS_API_KEY` / `SMS_API_URL` / `SMS_PROVIDER` / `SMS_SENDER_ID` | SM/CM | o | MSG91 or Twilio-compat. |
| `EMAIL_API_KEY` / `EMAIL_API_URL` / `EMAIL_FROM` | SM/CM | o | SendGrid. |
| `EXPO_ACCESS_TOKEN` | SM | o | Push throughput; basic Expo push works without. |
| `STORAGE_PROVIDER` | CM | o | `s3` activates S3 adapter; unset = local disk. |
| `AWS_REGION` / `AWS_S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_ENDPOINT` | SM/CM | r-if-S3 | Required when `STORAGE_PROVIDER=s3`. |
| `JITSI_DOMAIN` | CM | r | `meet.jit.si` for dev, self-hosted/JaaS domain for prod. |
| `JITSI_APP_ID` / `JITSI_APP_SECRET` | SM | r-if-prod-JaaS | Unsigned rooms otherwise. |
| `TPA_MEDIASSIST_API_KEY` / `..._HOSPITAL_ID` / `..._API_URL` | SM/CM | o | Only set for TPAs your hospital is actually contracted with. |
| `TPA_PARAMOUNT_API_KEY` / `..._CLIENT_CODE` / `..._API_URL` | SM/CM | o | Same. |
| `TPA_VIDAL_API_KEY` / `..._PROVIDER_ID` | SM | o | Same. |
| `TPA_FHPL_API_KEY` / `..._PROVIDER_ID` | SM | o | Same. |
| `TPA_ICICI_LOMBARD_API_KEY` / `..._AGENT_CODE` | SM | o | Same. |
| `TPA_STAR_HEALTH_API_KEY` / `..._HOSPITAL_CODE` | SM | o | Same. |
| `SENTRY_DSN` | SM | r | Error reporting. |
| `ABDM_CLIENT_ID` / `ABDM_CLIENT_SECRET` | SM | r-if-ABDM-live | ABDM /dashboard/abdm features disabled without. |
| `ABDM_BASE_URL` / `ABDM_GATEWAY_URL` / `ABDM_CM_ID` / `ABDM_JWKS_URL` | CM | r-if-ABDM-live | Sandbox defaults in `.env.example`. |
| `ABDM_SKIP_VERIFY` | CM | o | **NEVER** true in prod. Dev-only. |

### Web (baked into Next.js build — change means a rebuild)

| Var | Class | Level | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | CM | R | Points browser at API base. `https://medcore.globusdemos.com/api/v1`. |
| `NEXT_PUBLIC_SENTRY_DSN` | CM | r | Client-side Sentry. |
| `NEXT_PUBLIC_ABDM_MODE` | CM | o | `production` hides sandbox-only banners on `/dashboard/abdm`. |

### Mobile (EAS build-time, baked into JS bundle)

| Var | Class | Level | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | CM | R | Already set per-profile in `apps/mobile/eas.json`. |
| `EAS_PROJECT_ID` | CM | R | Expo project linkage. |
| `GOOGLE_SERVICES_JSON` | SM | r-if-push | Path to Firebase config for Android push. |

When rotating an SM value: change it in the vault, redeploy the API
(`pm2 restart medcore-api` after updating `.env`), and invalidate any signed
URLs that used the old signing secret.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `verify-deploy.sh` reports 500 on an AI route. | Prisma client out of sync with DB (missing new table). | Re-run `npx prisma generate`, `pm2 restart medcore-api`. |
| `migrate deploy` says "no pending migrations" but new ones exist in the folder. | Git pull didn't actually fast-forward; `HEAD` still points at old SHA. | `git log -1 --oneline`, confirm, then `git pull --ff-only`. |
| `migrate deploy` says "drift detected". | Someone ran `db push` against prod. Schema ≠ migration history. | Stop. Read `DEPLOYMENT.md` section 3 ("First-time adoption"). Do **not** auto-resolve. Pair with DBA. |
| `/dashboard/*` returns old bundle after deploy. | nginx static cache stale OR web process didn't restart. | `pm2 restart medcore-web`, then `sudo nginx -s reload`. Hard-refresh browser (cache-busted by Next.js hash but CDN may cache index). |
| PM2 shows process as `online` but port 4100 refuses connections ("zombie"). | Previous process hung on shutdown; PM2 thinks new one is up. | `pm2 delete medcore-api && pm2 start ecosystem.medcore.config.js --only medcore-api && pm2 save`. |
| `prisma migrate status` shows pending after `migrate deploy` returned 0. | Separate `.env` loaded (DATABASE_URL pointed at wrong DB). | `echo $DATABASE_URL` — must match the one in `/home/empcloud-development/medcore/.env`. |
| Web build OOMs on the host. | Next.js type-check + build exceeds default Node heap. | `NODE_OPTIONS=--max-old-space-size=4096 npm --prefix apps/web run build`. |
| Insurance-claims v2 page shows empty rows. | Data migration (section 5) not yet applied. | Run the dry-run, review, then `--apply`. |
| ABDM callbacks 401 in prod. | `ABDM_SKIP_VERIFY=true` leaked in; or `ABDM_JWKS_URL` unreachable. | Ensure `ABDM_SKIP_VERIFY` unset/false; curl the JWKS URL from the host. |
| `pm2 logs medcore-api` shows `SARVAM_API_KEY not set`. | Soft-fail; AI features return mock data. | Set key and restart only if the feature is expected live. |

When in doubt: roll back (section 4), open an incident, investigate with
fresh eyes. A 10-minute rollback is cheaper than a 2-hour forward-fix.
