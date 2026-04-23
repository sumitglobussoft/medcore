#!/usr/bin/env tsx
/**
 * ABDM Sandbox Mock Server — zero-dep HTTP server that mimics the subset of
 * `https://dev.abdm.gov.in/gateway` endpoints needed to exercise MedCore's
 * ABDM integration end-to-end without real sandbox credentials.
 *
 * ── What's mocked ─────────────────────────────────────────────────────────
 *   POST /v0.5/sessions
 *   POST /v0.5/users/auth/init
 *   POST /v0.5/users/auth/confirmWithAadhaarOtp
 *   POST /v0.5/users/auth/confirmWithMobileOtp
 *   POST /v0.5/consent-requests/init         (fires webhook after 3s)
 *   POST /v0.5/health-information/cm/request (fires webhook after 5s)
 *   GET  /gateway/v0.5/certs                 (JWKS; RS256 key)
 *
 *   All webhooks are signed with an RS256 JWT whose public half is the one
 *   key published in the JWKS. The private key is generated at server start
 *   and kept in memory — never written to disk.
 *
 * ── Run ───────────────────────────────────────────────────────────────────
 *   npx tsx scripts/abdm-mock-server.ts --port=4020 --verbose
 *
 * ── Not covered ───────────────────────────────────────────────────────────
 * See `scripts/README-abdm-local.md` for the list of omissions (real HIU
 * crypto round-trips, multi-HIU consent artefacts, CM-side digest validation,
 * etc.). This is a convenience mock, not a conformance test harness.
 */

import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

// ── CLI ──────────────────────────────────────────────────────────────────

interface Args {
  port: number;
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
    port: Number(out.port ?? 4020),
    verbose: Boolean(out.verbose),
  };
}

// ── In-memory RSA keypair (never hits disk) ──────────────────────────────

export interface KeyMaterial {
  publicJwk: crypto.JsonWebKey & { kid: string; alg: string; use: string };
  privateKey: crypto.KeyObject;
  kid: string;
}

export function generateKeyMaterial(): KeyMaterial {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  // JWK export is built in from Node 16+ for KeyObject.export({format: "jwk"}).
  const jwk = publicKey.export({ format: "jwk" }) as crypto.JsonWebKey;
  // Stable kid derived from the modulus so tests can assert on it.
  const kid = crypto
    .createHash("sha256")
    .update(String(jwk.n ?? ""))
    .digest("base64url")
    .slice(0, 16);
  return {
    publicJwk: { ...jwk, kid, alg: "RS256", use: "sig" },
    privateKey,
    kid,
  };
}

// ── JWT signer (RS256) ───────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signJwt(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid: string
): string {
  const header = { alg: "RS256", typ: "JWT", kid };
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + 300, iss: "abdm-mock", ...payload };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(body));
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const sig = crypto.sign("RSA-SHA256", signingInput, privateKey);
  const sigB64 = base64url(sig);
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

// ── Logging ──────────────────────────────────────────────────────────────

function log(msg: string, ...extra: unknown[]): void {
  process.stderr.write(
    `[abdm-mock ${new Date().toISOString()}] ${msg}${extra.length ? " " + extra.map((x) => JSON.stringify(x)).join(" ") : ""}\n`
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ── Webhook sender ───────────────────────────────────────────────────────

export async function fireWebhook(
  targetUrl: string,
  body: Record<string, unknown>,
  keys: KeyMaterial,
  verbose: boolean
): Promise<void> {
  try {
    const jwt = signJwt(body, keys.privateKey, keys.kid);
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    log("webhook sent", { url: targetUrl, status: res.status });
    if (verbose) log("webhook payload", body);
  } catch (err) {
    log("webhook error", {
      url: targetUrl,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Route handlers ───────────────────────────────────────────────────────

export interface HandlerContext {
  keys: KeyMaterial;
  verbose: boolean;
  /** Exposed so tests can swap out the webhook firer. */
  fireWebhook: (url: string, body: Record<string, unknown>) => Promise<void>;
}

export function handleSessions(body: any): { status: number; payload: unknown } {
  const clientId = body?.clientId;
  const clientSecret = body?.clientSecret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    return {
      status: 400,
      payload: { error: "clientId and clientSecret required" },
    };
  }
  if (!clientId.startsWith("TEST_")) {
    return {
      status: 401,
      payload: { error: "Invalid client credentials" },
    };
  }
  return {
    status: 200,
    payload: {
      accessToken: `mock-access-${crypto.randomBytes(8).toString("hex")}`,
      tokenType: "bearer",
      expiresIn: 3600,
    },
  };
}

export function handleAuthInit(body: any): { status: number; payload: unknown } {
  const healthid = body?.healthid ?? body?.healthId;
  if (typeof healthid !== "string" || !healthid.endsWith("@abdm")) {
    return {
      status: 404,
      payload: { error: `No such ABHA address: ${healthid ?? "<missing>"}` },
    };
  }
  return {
    status: 200,
    payload: {
      authInitResponse: {
        transactionId: crypto.randomUUID(),
      },
    },
  };
}

export function handleAuthConfirm(body: any): { status: number; payload: unknown } {
  const otp = body?.otp ?? body?.authCode;
  if (otp !== "123456") {
    return {
      status: 401,
      payload: { error: "Invalid OTP" },
    };
  }
  return {
    status: 200,
    payload: {
      id: crypto.randomUUID(),
      fullName: "Test Patient",
      gender: "M",
      yearOfBirth: 1990,
      address: "221B Baker Street, Mumbai",
      abhaAddress: body?.healthid ?? "test@abdm",
    },
  };
}

export function handleConsentInit(
  body: any,
  ctx: HandlerContext
): { status: number; payload: unknown } {
  const callbackUrl = body?.callbackUrl ?? body?.consent?.callbackUrl;
  const consentRequestId = crypto.randomUUID();
  if (typeof callbackUrl === "string") {
    // Fire webhook after 3s — non-blocking.
    setTimeout(() => {
      void ctx.fireWebhook(callbackUrl, {
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        consentRequest: {
          id: consentRequestId,
          status: "GRANTED",
        },
        notification: {
          consentRequestId,
          status: "GRANTED",
          consentArtefact: {
            id: crypto.randomUUID(),
            signature: base64url(crypto.randomBytes(32)),
          },
        },
      });
    }, 3000).unref();
  }
  return {
    status: 200,
    payload: {
      consentRequest: { id: consentRequestId },
    },
  };
}

export function handleHealthInfoRequest(
  body: any,
  ctx: HandlerContext
): { status: number; payload: unknown } {
  const callbackUrl = body?.callbackUrl ?? body?.hiRequest?.callbackUrl;
  const requestId = crypto.randomUUID();
  if (typeof callbackUrl === "string") {
    setTimeout(() => {
      void ctx.fireWebhook(callbackUrl, {
        requestId,
        timestamp: new Date().toISOString(),
        hiRequest: {
          transactionId: crypto.randomUUID(),
          consent: { id: body?.hiRequest?.consent?.id ?? crypto.randomUUID() },
          dataPushUrl: "https://mock-hiu.invalid/push",
          keyMaterial: {
            cryptoAlg: "ECDH",
            curve: "Curve25519",
            dhPublicKey: {
              keyValue: base64url(crypto.randomBytes(32)),
              expiry: new Date(Date.now() + 3600_000).toISOString(),
              parameters: "Curve25519/32byte",
            },
            nonce: base64url(crypto.randomBytes(16)),
          },
          hiTypes: body?.hiRequest?.hiTypes ?? ["OPConsultation"],
          dateRange: body?.hiRequest?.dateRange ?? {
            from: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(),
            to: new Date().toISOString(),
          },
          // Mock encrypted bundle — in real ABDM this is a cipher text of a FHIR bundle.
          encryptedBundle: base64url(
            crypto.randomBytes(256) // stand-in for an encrypted FHIR Bundle
          ),
        },
      });
    }, 5000).unref();
  }
  return {
    status: 200,
    payload: { requestId },
  };
}

// ── Server ───────────────────────────────────────────────────────────────

export function createMockServer(opts: { verbose?: boolean } = {}): {
  server: http.Server;
  keys: KeyMaterial;
} {
  const keys = generateKeyMaterial();
  const verbose = Boolean(opts.verbose);

  const ctx: HandlerContext = {
    keys,
    verbose,
    fireWebhook: (url, body) => fireWebhook(url, body, keys, verbose),
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://localhost`);
    log(`${method} ${url.pathname}`);

    try {
      // JWKS endpoint — GET only, no body.
      if (method === "GET" && url.pathname === "/gateway/v0.5/certs") {
        send(res, 200, { keys: [keys.publicJwk] });
        return;
      }

      if (method !== "POST") {
        send(res, 405, { error: `Method ${method} not allowed on ${url.pathname}` });
        return;
      }

      const body = await readJson(req).catch(() => ({}));
      if (verbose) log("request body", body);

      let result: { status: number; payload: unknown };
      switch (url.pathname) {
        case "/v0.5/sessions":
          result = handleSessions(body);
          break;
        case "/v0.5/users/auth/init":
          result = handleAuthInit(body);
          break;
        case "/v0.5/users/auth/confirmWithAadhaarOtp":
        case "/v0.5/users/auth/confirmWithMobileOtp":
          result = handleAuthConfirm(body);
          break;
        case "/v0.5/consent-requests/init":
          result = handleConsentInit(body, ctx);
          break;
        case "/v0.5/health-information/cm/request":
          result = handleHealthInfoRequest(body, ctx);
          break;
        default:
          result = { status: 404, payload: { error: `No mock for ${url.pathname}` } };
      }
      send(res, result.status, result.payload);
    } catch (err) {
      log("handler error", { message: err instanceof Error ? err.message : String(err) });
      send(res, 500, { error: "internal mock error" });
    }
  });

  return { server, keys };
}

// ── Entrypoint ───────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv);
  const { server, keys } = createMockServer({ verbose: args.verbose });
  server.listen(args.port, () => {
    log(`listening on :${args.port} (kid=${keys.kid}, verbose=${args.verbose})`);
    log(`JWKS → http://localhost:${args.port}/gateway/v0.5/certs`);
  });

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    // Hard-exit after 2s in case keep-alive sockets hang.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Only auto-start when invoked directly. Tests import functions above.
// `import.meta.url` is the canonical way to detect CLI execution in ESM.
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1] ?? "";
    return import.meta.url === new URL(`file://${entry}`).href ||
      import.meta.url.endsWith(entry.replace(/\\/g, "/"));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
