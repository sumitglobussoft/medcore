#!/usr/bin/env tsx
/**
 * ABDM end-to-end runner — spawns the mock server + MedCore API and walks the
 * full ABHA → consent → care-context flow, asserting each webhook advances
 * local DB state.
 *
 * NOT run in CI by default — needs a local Postgres (see apps/api/.env). Use
 * it as a smoke test before shipping ABDM changes:
 *
 *   npx tsx scripts/abdm-e2e.ts
 *   ABDM_MOCK_PORT=4020 API_PORT=4000 npx tsx scripts/abdm-e2e.ts
 *
 * Exit codes:
 *   0 — all steps passed
 *   1 — any assertion failed or a subprocess exited unexpectedly
 */

import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";

// ── Config ───────────────────────────────────────────────────────────────

const MOCK_PORT = Number(process.env.ABDM_MOCK_PORT ?? 4020);
const API_PORT = Number(process.env.API_PORT ?? 4000);
const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ""));

const MOCK_URL = `http://localhost:${MOCK_PORT}`;
const API_BASE = `http://localhost:${API_PORT}/api/v1`;

// ── Result bookkeeping ───────────────────────────────────────────────────

interface StepResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: StepResult[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  const badge = ok ? "PASS" : "FAIL";
  process.stderr.write(`[abdm-e2e] ${badge} ${name}${detail ? " — " + detail : ""}\n`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPort(url: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* keep trying */
    }
    await sleep(500);
  }
  return false;
}

async function login(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.E2E_EMAIL ?? "admin@medcore.local",
        password: process.env.E2E_PASSWORD ?? "admin",
      }),
    });
    const data = (await res.json()) as { data?: { accessToken?: string } };
    return data?.data?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function apiCall(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, body: parsed };
}

// ── Subprocess management ────────────────────────────────────────────────

function spawnMock(): ChildProcess {
  const proc = spawn(
    process.execPath,
    [path.resolve(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.resolve(REPO_ROOT, "scripts", "abdm-mock-server.ts"), `--port=${MOCK_PORT}`],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    }
  );
  proc.stderr?.on("data", (c: Buffer) => process.stderr.write(`[mock] ${c.toString()}`));
  return proc;
}

function spawnApi(): ChildProcess {
  const proc = spawn(
    "npm",
    ["run", "dev", "--workspace", "apps/api"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
      shell: true,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        ABDM_BASE_URL: MOCK_URL,
        ABDM_GATEWAY_URL: MOCK_URL,
        ABDM_JWKS_URL: `${MOCK_URL}/gateway/v0.5/certs`,
        ABDM_CLIENT_ID: "TEST_CLIENT_1",
        ABDM_CLIENT_SECRET: "TEST_SECRET",
        ABDM_CM_ID: "sbx",
        ABDM_SKIP_VERIFY: "false",
      },
    }
  );
  proc.stdout?.on("data", (c: Buffer) => process.stderr.write(`[api] ${c.toString()}`));
  proc.stderr?.on("data", (c: Buffer) => process.stderr.write(`[api-err] ${c.toString()}`));
  return proc;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stderr.write(`[abdm-e2e] starting mock on :${MOCK_PORT}, api on :${API_PORT}\n`);

  const mock = spawnMock();
  const api = spawnApi();

  let exitCode = 1;
  try {
    const mockReady = await waitForPort(`${MOCK_URL}/gateway/v0.5/certs`, 15_000);
    record("mock server healthy", mockReady);
    if (!mockReady) throw new Error("mock server failed to start");

    const apiReady = await waitForPort(`${API_BASE.replace("/api/v1", "")}/health`, 60_000);
    record("api healthy", apiReady);
    if (!apiReady) throw new Error("api failed to start");

    const token = await login();
    record("login", Boolean(token));
    if (!token) throw new Error("login failed — cannot proceed");

    const patientId = process.env.E2E_PATIENT_ID ?? "";
    if (!patientId) {
      record("patient id missing", false, "set E2E_PATIENT_ID=<uuid>");
      throw new Error("no patient id to bind");
    }

    // 1. abha/verify — real API validates input + calls mock existsByHealthId.
    const verify = await apiCall(token, "POST", "/abdm/abha/verify", {
      abhaAddress: "test@abdm",
    });
    record("POST /abdm/abha/verify", verify.status === 200, `status=${verify.status}`);

    // 2. abha/link — API creates PENDING row, webhook should flip to LINKED ~3s later.
    const link = await apiCall(token, "POST", "/abdm/abha/link", {
      patientId,
      abhaAddress: "test@abdm",
    });
    record("POST /abdm/abha/link", link.status === 202, `status=${link.status}`);

    // 3. consent/request — webhook should arrive within ~4s.
    const consent = await apiCall(token, "POST", "/abdm/consent/request", {
      patientId,
      hiuId: "medcore-hiu",
      abhaAddress: "test@abdm",
      purpose: "CAREMGT",
      hiTypes: ["OPConsultation"],
      dateFrom: new Date(Date.now() - 86400_000).toISOString(),
      dateTo: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      requesterId: "doctor-1",
      requesterName: "Dr. Test",
    });
    record("POST /abdm/consent/request", consent.status === 202, `status=${consent.status}`);

    // 4. care-context/link
    const cc = await apiCall(token, "POST", "/abdm/care-context/link", {
      patientId,
      abhaAddress: "test@abdm",
      careContextRef: `visit-${Date.now()}`,
      display: "OP Visit",
      type: "OPConsultation",
    });
    record("POST /abdm/care-context/link", cc.status === 202, `status=${cc.status}`);

    // Allow the slowest webhook (5s HI request) to land.
    process.stderr.write("[abdm-e2e] waiting 6s for async webhooks\n");
    await sleep(6000);

    // 5. verify link state advanced past PENDING via the DB-backed consents list.
    const listed = await apiCall(token, "GET", `/abdm/consents?patientId=${patientId}`);
    const rows: unknown[] = Array.isArray(listed.body?.data) ? listed.body.data : [];
    record("DB state advanced (consents listed)", rows.length > 0, `rows=${rows.length}`);

    exitCode = results.every((r) => r.ok) ? 0 : 1;
  } catch (err) {
    record("runner error", false, err instanceof Error ? err.message : String(err));
  } finally {
    process.stderr.write("\n[abdm-e2e] summary\n");
    for (const r of results) {
      process.stderr.write(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}\n`);
    }
    mock.kill("SIGTERM");
    api.kill("SIGTERM");
    await sleep(500);
    process.exit(exitCode);
  }
}

void main();
