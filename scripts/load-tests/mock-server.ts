#!/usr/bin/env tsx
/**
 * Tiny zero-dependency mock server that mimics the MedCore AI endpoints
 * with realistic-looking latency (100ms – 5s) and occasional errors.
 *
 * Lets developers run `run-load-test.ts` without burning real Sarvam
 * quota or needing the full MedCore API stack running.
 *
 * Implementation uses Node's built-in `http` module only — no Express,
 * no npm installs.
 *
 * Usage:
 *   tsx scripts/load-tests/mock-server.ts            # listens on 4010
 *   tsx scripts/load-tests/mock-server.ts --port=5000
 *
 * Then from another shell:
 *   tsx scripts/load-tests/run-load-test.ts \
 *     --endpoint=triage --mock-port=4010 --requests=50 --concurrency=5
 */

import http from "node:http";
import { URL } from "node:url";

interface Args {
  port: number;
  errorRate: number; // 0..1
  // Base latency range in ms. Shape per endpoint is derived from these.
  minLatencyMs: number;
  maxLatencyMs: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string | boolean> = {};
  for (const a of argv.slice(2)) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) out[a.slice(2)] = true;
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return {
    port: Number(out.port ?? 4010),
    errorRate: Number(out["error-rate"] ?? 0.03),
    minLatencyMs: Number(out["min-latency"] ?? 100),
    maxLatencyMs: Number(out["max-latency"] ?? 5000),
    verbose: Boolean(out.verbose),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Skewed latency: most requests land near the low end, a tail drags toward
// max. Implemented as max-latency * u^3 where u ~ Uniform(0,1). Cube keeps
// the distribution heavily left-biased, like a real upstream would look.
function sampleLatency(min: number, max: number): number {
  const u = Math.random();
  const span = max - min;
  return Math.round(min + span * Math.pow(u, 3));
}

// Endpoint-specific latency profiles. Values are multipliers on the base
// [min, max] range from CLI flags, so a single knob tunes everything.
const LATENCY_PROFILE: Record<string, { minMul: number; maxMul: number }> = {
  triage: { minMul: 1.0, maxMul: 0.6 },          // fastest: ~100-3000ms
  scribe: { minMul: 3.0, maxMul: 1.0 },          // slowest: ~300-5000ms
  "chart-search": { minMul: 1.5, maxMul: 0.8 },  // middle
  letters: { minMul: 2.0, maxMul: 0.9 },
  "lab-explainer": { minMul: 1.5, maxMul: 0.8 },
  default: { minMul: 1.0, maxMul: 1.0 },
};

interface Handler {
  method: "GET" | "POST";
  matcher: RegExp;
  profile: keyof typeof LATENCY_PROFILE;
  respond: (body: any, match: RegExpMatchArray) => unknown;
}

const handlers: Handler[] = [
  // Auth — immediate, no latency simulation.
  {
    method: "POST",
    matcher: /^\/api\/v1\/auth\/login$/,
    profile: "default",
    respond: () => ({
      success: true,
      data: {
        accessToken: "mock-load-test-token",
        refreshToken: "mock-refresh-token",
        user: { id: "mock-user", email: "admin@medcore.local", role: "ADMIN" },
      },
      error: null,
    }),
  },

  // Triage — start
  {
    method: "POST",
    matcher: /^\/api\/v1\/ai\/triage\/start$/,
    profile: "default",
    respond: () => ({
      success: true,
      data: {
        sessionId: `mock-session-${Math.random().toString(36).slice(2, 10)}`,
        greeting: "Mock greeting — ready for load test.",
      },
      error: null,
    }),
  },

  // Triage — message
  {
    method: "POST",
    matcher: /^\/api\/v1\/ai\/triage\/[^/]+\/message$/,
    profile: "triage",
    respond: (body) => {
      const msg = (body as any)?.message ?? "";
      return {
        success: true,
        data: {
          message: `Mock triage reply acknowledging "${String(msg).slice(0, 60)}..."`,
          isEmergency: false,
          sessionStatus: "ACTIVE",
        },
        error: null,
      };
    },
  },

  // Scribe — fake generate-soap endpoint (only used by load harness).
  {
    method: "POST",
    matcher: /^\/api\/v1\/ai\/scribe\/generate-soap$/,
    profile: "scribe",
    respond: (body) => ({
      success: true,
      data: {
        soap: {
          subjective: { hpi: "Mock HPI synthesised from transcript." },
          objective: { vitals: "Mock vitals." },
          assessment: { impression: "Mock impression." },
          plan: {
            medications: [],
            followUp: "2 weeks",
          },
        },
        tokensUsed: 2000,
        transcriptLength: String((body as any)?.transcript ?? "").length,
      },
      error: null,
    }),
  },

  // Chart-search (per-patient)
  {
    method: "POST",
    matcher: /^\/api\/v1\/ai\/chart-search\/patient\/[^/]+$/,
    profile: "chart-search",
    respond: (body) => ({
      success: true,
      data: {
        results: [
          { snippet: "Mock document snippet 1.", score: 0.92 },
          { snippet: "Mock document snippet 2.", score: 0.87 },
        ],
        synthesis: (body as any)?.synthesize
          ? "Mock synthesised answer combining retrieved snippets."
          : null,
      },
      error: null,
    }),
  },

  // Letters
  {
    method: "POST",
    matcher: /^\/api\/v1\/ai\/letters\/referral$/,
    profile: "letters",
    respond: () => ({
      success: true,
      data: { letterMarkdown: "# Mock referral letter\n\n..." },
      error: null,
    }),
  },

  // Lab explainer (report explainer)
  {
    method: "POST",
    matcher: /^\/api\/v1\/ai\/reports\/explain$/,
    profile: "lab-explainer",
    respond: () => ({
      success: true,
      data: { explanation: "Mock plain-language report explanation." },
      error: null,
    }),
  },

  // Health probe
  {
    method: "GET",
    matcher: /^\/health$/,
    profile: "default",
    respond: () => ({ success: true, data: { status: "ok" }, error: null }),
  },
];

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve(null);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function buildServer(args: Args): http.Server {
  let reqCount = 0;
  return http.createServer(async (req, res) => {
    reqCount++;
    const myId = reqCount;
    const url = new URL(req.url ?? "/", `http://localhost:${args.port}`);
    const method = (req.method ?? "GET").toUpperCase();

    const handler = handlers.find(
      (h) => h.method === method && h.matcher.test(url.pathname)
    );

    const body = await readBody(req);

    if (!handler) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          data: null,
          error: `No mock handler for ${method} ${url.pathname}`,
        })
      );
      if (args.verbose) {
        process.stdout.write(
          `  [#${myId}] 404 ${method} ${url.pathname}\n`
        );
      }
      return;
    }

    // Latency shaping per profile
    const profile =
      LATENCY_PROFILE[handler.profile] ?? LATENCY_PROFILE.default;
    const min = Math.max(0, args.minLatencyMs * profile.minMul);
    const max = Math.max(min + 1, args.maxLatencyMs * profile.maxMul);
    const latency = sampleLatency(min, max);

    await sleep(latency);

    // Occasional synthetic errors: mix of 429 (rate-limit, most common),
    // 500 (upstream blip), and 503 (timeout-ish).
    if (Math.random() < args.errorRate) {
      const r = Math.random();
      const status = r < 0.7 ? 429 : r < 0.9 ? 500 : 503;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          data: null,
          error:
            status === 429
              ? "Rate limited (mock)"
              : status === 500
              ? "Upstream model error (mock)"
              : "Upstream timeout (mock)",
        })
      );
      if (args.verbose) {
        process.stdout.write(
          `  [#${myId}] ${status} ${method} ${url.pathname} +${latency}ms (error)\n`
        );
      }
      return;
    }

    const match = url.pathname.match(handler.matcher)!;
    const payload = handler.respond(body, match);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    if (args.verbose) {
      process.stdout.write(
        `  [#${myId}] 200 ${method} ${url.pathname} +${latency}ms\n`
      );
    }
  });
}

function main(): void {
  const args = parseArgs(process.argv);
  const server = buildServer(args);
  server.listen(args.port, () => {
    process.stdout.write(
      `MedCore AI mock server listening on http://localhost:${args.port}\n`
    );
    process.stdout.write(
      `  latency shaping: ${args.minLatencyMs}–${args.maxLatencyMs}ms (per-endpoint multipliers)\n`
    );
    process.stdout.write(
      `  error rate:      ${(args.errorRate * 100).toFixed(1)}% (mix of 429/500/503)\n`
    );
    process.stdout.write(
      `  handlers:        ${handlers.map((h) => `${h.method} ${h.matcher.source}`).join(", ")}\n`
    );
    process.stdout.write(
      `  verbose:         ${args.verbose ? "on" : "off (pass --verbose to enable)"}\n`
    );
    process.stdout.write(
      `\nPoint the load harness at this server with --mock-port=${args.port}.\n`
    );
  });

  const shutdown = (signal: string) => {
    process.stdout.write(`\nReceived ${signal}, closing mock server...\n`);
    server.close(() => process.exit(0));
    // Hard-exit after 2s in case of lingering sockets.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
