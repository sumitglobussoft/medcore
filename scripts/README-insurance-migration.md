# Insurance Claims — Legacy → v2 Migration

One-way migration of historical rows from the legacy `InsuranceClaim` table
(`insurance_claims`) into the new TPA-aware `InsuranceClaim2` table
(`insurance_claims_v2`). After this runs successfully on a live cluster,
v2 becomes the single source of truth for claims data.

## Files

| Path | Purpose |
| --- | --- |
| `scripts/migrate-insurance-claims-to-v2.ts`    | The migration driver. Defaults to dry-run. |
| `scripts/verify-insurance-claims-migration.ts` | Read-only verifier — counts + field-level spot-check. |

Both are tsx-runnable and pull `DATABASE_URL` from the repo-root `.env`
or `apps/api/.env` (in that order).

## Field mapping (legacy → v2)

| Legacy `InsuranceClaim` | v2 `InsuranceClaim2`           | Notes |
| --- | --- | --- |
| `id`                   | (embedded in `providerClaimRef`) | v2 uses `providerClaimRef = "LEGACY-<legacyId>"` as the idempotency key. |
| `invoiceId`            | `billId`                         | 1:1 rename. |
| `patientId`            | `patientId`                      | 1:1. |
| `insuranceProvider`    | `insurerName`                    | Free-text carry-over. |
| `policyNumber`         | `policyNumber`                   | 1:1. |
| `claimAmount`          | `amountClaimed`                  | 1:1. |
| `approvedAmount`       | `amountApproved`                 | 1:1 (nullable). |
| `status` (`ClaimStatus`) | `status` (`NormalisedClaimStatus`) | Mapped via `mapStatus()` — see below. |
| `submittedAt`          | `submittedAt`                    | 1:1. |
| `resolvedAt`           | `approvedAt` / `settledAt`       | Routed based on mapped status. Also preserved verbatim inside the embedded notes blob. |
| *(none)*               | `tpaProvider`                    | **Synthesised:** `"MOCK"` (v2 enum has no OTHER). Flagged in log. |
| *(none)*               | `diagnosis`                      | **Synthesised:** `"(migrated from legacy — diagnosis unknown)"`. |
| *(none)*               | `createdBy`                      | **Synthesised:** `"SYSTEM_MIGRATION"`. |
| *(none)*               | `providerClaimRef`               | **Synthesised:** `"LEGACY-<legacyId>"` (idempotency key). |
| *(none)*               | `icd10Codes`                     | Default `[]`. |
| *(none)*               | `memberId`, `procedureName`, `admissionDate`, `dischargeDate`, `cancelledAt`, `lastSyncedAt` | Left `null`. |
| *(none)*               | `deniedReason`                   | `"(migrated — reason unknown)"` only when status maps to `DENIED`. |
| *(none)*               | `preAuthRequestId`               | Best-effort lookup against `PreAuthRequest` by `(patientId, policyNumber)` — only linked when exactly one candidate matches. Null otherwise. |
| *(none)*               | `notes`                          | `"Migrated from legacy insurance_claims on <YYYY-MM-DD> \| {JSON blob of the full legacy row}"`. Every legacy column is preserved here verbatim so nothing is silently lost. |

### Status mapping

```
Legacy ClaimStatus       v2 NormalisedClaimStatus
────────────────────     ────────────────────────
SUBMITTED             →  SUBMITTED
APPROVED              →  APPROVED
REJECTED              →  DENIED     (semantic rename)
SETTLED               →  SETTLED
<anything else>       →  throws     (guarded against silent surprises)
```

The migration script throws loudly on an unknown legacy status instead of
guessing — add the case to `mapStatus()` and re-run.

### Relations (legacy model has none to carry over)

The legacy `InsuranceClaim` model in `packages/db/prisma/schema.prisma`
only declares two relations: `invoice` and `patient`. There is **no**
`InsurancePreAuth`, no "cashless workflow docs", and no `ClaimStatusEvent`
reference on the legacy side. So the brief's step (e) is effectively a
no-op at the schema level.

What the script still does for auditability:

* Scans `PreAuthRequest` rows that share `(patientId, policyNumber)` with
  the legacy claim — if exactly one approved/partial match exists, its id
  is written into v2's `preAuthRequestId`. Zero or 2+ matches means no link
  (avoids false joins).
* Writes a `ClaimStatusEvent` row with
  `note: "Migrated from legacy insurance_claims on <date>"` so the history
  trail shows the migration explicitly.

## Rollout

All commands below are run from the repo root.

### 1. Dry-run (default, no writes)

```bash
npx tsx scripts/migrate-insurance-claims-to-v2.ts
```

The script logs every intended upsert to stderr and emits a JSON summary
on stdout. Pipe to `jq` to inspect:

```bash
npx tsx scripts/migrate-insurance-claims-to-v2.ts 2>/dev/null | jq '.'
```

Review the synthesised fields. If any look wrong for your data, stop and
adjust `transform()` in the script.

### 2. Review

* Confirm the row count lines up with what you expect.
* Eyeball the `skippedSample` / `failedSample` arrays — both should be
  empty for a clean dry-run.
* Grep the stderr log for lines containing `synthesised=[tpaProvider,...]`
  — this is normal for legacy rows because the legacy schema has no TPA
  column. If it's flagged for fields you didn't expect, investigate.

### 3. Apply

```bash
npx tsx scripts/migrate-insurance-claims-to-v2.ts --apply
```

Each batch is wrapped in a single `prisma.$transaction` — a failing row
rolls back only that batch, earlier batches stay committed. Re-run after
a partial failure is safe (idempotent upsert on `providerClaimRef`).

Tune batch size if you hit lock contention:

```bash
npx tsx scripts/migrate-insurance-claims-to-v2.ts --apply --batch-size=50
```

### 4. Verify

```bash
npx tsx scripts/verify-insurance-claims-migration.ts
# or with a bigger sample:
npx tsx scripts/verify-insurance-claims-migration.ts --sample=50
```

This is read-only. It:

* Confirms `COUNT(insurance_claims) == COUNT(insurance_claims_v2 WHERE providerClaimRef LIKE 'LEGACY-%')`.
* Samples 10 (or `--sample=N`) migrated rows and diffs them field-by-field
  back to the legacy source.
* Exits non-zero if any mismatch or count gap exists, so it can be wired
  into CI.

### 5. (Later) Archive legacy

**Not performed by these scripts.** Once the verifier is green for a full
grace period (e.g. one release), archive `insurance_claims` via a
timestamped DB dump, then drop writes to the legacy table at the
application layer. Only after that should you consider a schema migration
to remove the legacy model.

## Rollback

Because the migration is pure INSERT/UPSERT into v2 — legacy rows are
never touched or deleted — rollback is straightforward:

```sql
-- v2 rows introduced by the migration have notes starting with this marker:
DELETE FROM insurance_claims_v2
 WHERE notes LIKE 'Migrated from legacy insurance_claims on%';
```

Because of the FK cascade on `claim_status_events.claimId`, the migration
status-event rows are removed automatically.

If you prefer Prisma:

```bash
npx tsx -e "
  import('@medcore/db').then(async ({ prisma }) => {
    const { count } = await prisma.insuranceClaim2.deleteMany({
      where: { providerClaimRef: { startsWith: 'LEGACY-' } },
    });
    console.log('rolled back', count);
    await prisma.\$disconnect();
  });
"
```

Either form is safe to re-run and idempotent.

## Operational notes

* **Logs go to stderr, summary to stdout.** So `... 2>/dev/null | jq '.'`
  gives you a clean machine-parseable result.
* **DATABASE_URL** is read from `.env` (repo root) first, then
  `apps/api/.env`. Shell vars still win.
* **Never commit output** — the JSON summary contains row counts and
  sample legacy IDs that may be considered sensitive PHI metadata.
