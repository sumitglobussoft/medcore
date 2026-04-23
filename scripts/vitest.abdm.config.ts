import { defineConfig } from "vitest/config";

/**
 * Dedicated vitest config for the ABDM mock server tests — the repo root
 * config excludes `scripts/**` so this provides an override to actually run
 * `scripts/abdm-mock-server.test.ts`.
 *
 * Run:  npx vitest run --config scripts/vitest.abdm.config.ts
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["scripts/abdm-mock-server.test.ts"],
    testTimeout: 10_000,
  },
});
