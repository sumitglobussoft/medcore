/**
 * Login smoke test.
 *
 * This avoids react-test-renderer / RNTL host-component detection (both
 * are version-pinned to specific React Native internals that are still
 * stabilising for SDK 53 + new architecture) and instead verifies the
 * screen module loads cleanly and exposes the expected default export.
 *
 * The render path itself is exercised in Detox / Maestro e2e suites;
 * here we just want a fast unit-level guard against the component
 * file going missing or its imports breaking.
 */

// Mock expo-router so the module can be required without a router context.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// Mock the auth context — login screen consumes useAuth().
jest.mock("../lib/auth", () => ({
  useAuth: () => ({ login: jest.fn(), user: null, isLoading: false }),
}));

describe("LoginScreen module", () => {
  it("exports a default React component", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../app/login");
    expect(mod).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("references the expected email placeholder text", () => {
    // Read the source to confirm the email input placeholder we rely on
    // in real e2e tests still exists. This is a quick sanity check.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "app", "login.tsx"),
      "utf8"
    );
    expect(src).toContain("you@example.com");
    expect(src).toContain("Enter your password");
  });
});
