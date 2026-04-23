/**
 * Lightweight tests for the ABDM mock server. Intentionally avoid going
 * through the real `http` socket for most assertions — we exercise the pure
 * handlers directly and round-trip only the JWT / JWKS bits that require the
 * full crypto integration.
 *
 * Run with:
 *   npx vitest run scripts/abdm-mock-server.test.ts
 */

import { describe, it, expect } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { AddressInfo } from "node:net";
import {
  createMockServer,
  generateKeyMaterial,
  handleSessions,
  handleAuthInit,
  signJwt,
} from "./abdm-mock-server";

function listenOnRandom(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

describe("abdm-mock-server", () => {
  it("POST /v0.5/sessions — valid credentials return token+expiry", () => {
    const result = handleSessions({
      clientId: "TEST_CLIENT_1",
      clientSecret: "sekret",
    });
    expect(result.status).toBe(200);
    const payload = result.payload as { accessToken: string; expiresIn: number; tokenType: string };
    expect(payload.accessToken).toMatch(/^mock-access-/);
    expect(payload.expiresIn).toBe(3600);
    expect(payload.tokenType).toBe("bearer");
  });

  it("POST /v0.5/sessions — invalid credentials return 401", () => {
    const result = handleSessions({
      clientId: "NOT_ALLOWED",
      clientSecret: "sekret",
    });
    expect(result.status).toBe(401);
  });

  it("POST /v0.5/users/auth/init — @abdm suffix returns transactionId", () => {
    const ok = handleAuthInit({ healthid: "sumit@abdm" });
    expect(ok.status).toBe(200);
    const payload = ok.payload as { authInitResponse: { transactionId: string } };
    expect(payload.authInitResponse.transactionId).toMatch(/[0-9a-f-]{36}/);

    const bad = handleAuthInit({ healthid: "sumit@sbx" });
    expect(bad.status).toBe(404);
  });

  it("GET /gateway/v0.5/certs — returns a well-formed JWK", async () => {
    const { server } = createMockServer();
    const port = await listenOnRandom(server);
    try {
      const res = await fetch(`http://localhost:${port}/gateway/v0.5/certs`);
      expect(res.status).toBe(200);
      const jwks = (await res.json()) as { keys: any[] };
      expect(Array.isArray(jwks.keys)).toBe(true);
      expect(jwks.keys.length).toBeGreaterThan(0);
      const k = jwks.keys[0];
      expect(k.kty).toBe("RSA");
      expect(typeof k.kid).toBe("string");
      expect(k.kid.length).toBeGreaterThan(0);
      expect(typeof k.n).toBe("string");
      expect(typeof k.e).toBe("string");
      expect(k.alg).toBe("RS256");
    } finally {
      server.close();
    }
  });

  it("webhook JWT verifies against the published JWKS", () => {
    const keys = generateKeyMaterial();
    const jwt = signJwt({ foo: "bar" }, keys.privateKey, keys.kid);

    // Reconstruct the verifier exactly the way apps/api/src/services/abdm/jwks.ts
    // would: build a public KeyObject from the JWK, verify RS256 signature.
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe(keys.kid);

    const publicKey = crypto.createPublicKey({ key: keys.publicJwk as any, format: "jwk" });
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(Buffer.from(`${headerB64}.${payloadB64}`, "utf8"));
    verifier.end();
    const sig = Buffer.from(sigB64, "base64url");
    expect(verifier.verify(publicKey, sig)).toBe(true);

    // A tampered signature must fail.
    const tampered = Buffer.from(sig);
    tampered[0] = tampered[0] ^ 0x01;
    const badVerifier = crypto.createVerify("RSA-SHA256");
    badVerifier.update(Buffer.from(`${headerB64}.${payloadB64}`, "utf8"));
    badVerifier.end();
    expect(badVerifier.verify(publicKey, tampered)).toBe(false);
  });

  it("OTP confirm — 123456 unlocks a mock profile, other OTP returns 401", async () => {
    const { server } = createMockServer();
    const port = await listenOnRandom(server);
    try {
      const good = await fetch(`http://localhost:${port}/v0.5/users/auth/confirmWithMobileOtp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: "123456", healthid: "sumit@abdm" }),
      });
      expect(good.status).toBe(200);
      const profile = (await good.json()) as { fullName: string; abhaAddress: string };
      expect(profile.fullName).toBe("Test Patient");
      expect(profile.abhaAddress).toBe("sumit@abdm");

      const bad = await fetch(`http://localhost:${port}/v0.5/users/auth/confirmWithMobileOtp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: "000000" }),
      });
      expect(bad.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
