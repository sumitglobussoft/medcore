// Unit tests for tenant-provisioning pure helpers (subdomain validation,
// config-key namespacing). No database required.
import { describe, it, expect } from "vitest";
import {
  validateSubdomain,
  RESERVED_SUBDOMAINS,
  tenantConfigKey,
} from "./tenant-provisioning";

describe("validateSubdomain", () => {
  it("accepts valid subdomains", () => {
    expect(validateSubdomain("sunrise")).toBeNull();
    expect(validateSubdomain("apollo-hospitals")).toBeNull();
    expect(validateSubdomain("clinic-42")).toBeNull();
    expect(validateSubdomain("a1b")).toBeNull();
  });

  it("rejects too-short / too-long", () => {
    expect(validateSubdomain("")).not.toBeNull();
    expect(validateSubdomain("ab")).not.toBeNull();
    expect(validateSubdomain("a".repeat(31))).not.toBeNull();
  });

  it("rejects illegal characters", () => {
    expect(validateSubdomain("HELLO")).not.toBeNull();
    expect(validateSubdomain("hi there")).not.toBeNull();
    expect(validateSubdomain("hi_there")).not.toBeNull();
    expect(validateSubdomain("-leading")).not.toBeNull();
    expect(validateSubdomain("trailing-")).not.toBeNull();
  });

  it("rejects every reserved name", () => {
    for (const s of RESERVED_SUBDOMAINS) {
      expect(validateSubdomain(s)).not.toBeNull();
    }
    // Key legacy names are definitely in the list.
    for (const legacy of ["www", "api", "app", "admin", "medcore", "default"]) {
      expect(RESERVED_SUBDOMAINS.has(legacy)).toBe(true);
    }
  });
});

describe("tenantConfigKey", () => {
  it("prefixes keys with tenant:<id>:", () => {
    expect(tenantConfigKey("abc", "hospital_name")).toBe("tenant:abc:hospital_name");
    expect(tenantConfigKey("uuid-123", "onboarding_step_x_completed_at")).toBe(
      "tenant:uuid-123:onboarding_step_x_completed_at",
    );
  });
});
