import { describe, it, expect } from "vitest";
import {
  createPatientSchema,
  updatePatientSchema,
  mergePatientSchema,
  recordVitalsSchema,
} from "../patient";

const validPatient = {
  name: "Bob Smith",
  gender: "MALE" as const,
  phone: "9000000000",
};

describe("createPatientSchema", () => {
  it("accepts minimum valid patient", () => {
    expect(createPatientSchema.safeParse(validPatient).success).toBe(true);
  });
  it("accepts with optional email empty string", () => {
    expect(createPatientSchema.safeParse({ ...validPatient, email: "" }).success).toBe(true);
  });
  it("rejects missing name", () => {
    expect(createPatientSchema.safeParse({ ...validPatient, name: "" }).success).toBe(false);
  });
  it("rejects bad gender enum", () => {
    expect(
      createPatientSchema.safeParse({ ...validPatient, gender: "ALIEN" as any }).success
    ).toBe(false);
  });
  it("rejects invalid blood group", () => {
    expect(
      createPatientSchema.safeParse({ ...validPatient, bloodGroup: "Z+" as any }).success
    ).toBe(false);
  });
  it("rejects out-of-range age", () => {
    expect(createPatientSchema.safeParse({ ...validPatient, age: 200 }).success).toBe(false);
  });
  it("accepts with valid photoUrl", () => {
    expect(
      createPatientSchema.safeParse({ ...validPatient, photoUrl: "https://example.com/a.jpg" })
        .success
    ).toBe(true);
  });
  it("rejects bad photoUrl", () => {
    expect(
      createPatientSchema.safeParse({ ...validPatient, photoUrl: "not a url" }).success
    ).toBe(false);
  });

  // Issue #104 (Apr 2026): name regex.
  describe("name regex", () => {
    it("accepts honorifics with dots", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, name: "Dr. R.K. Sharma" }).success
      ).toBe(true);
    });
    it("accepts apostrophes", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, name: "O'Brien" }).success
      ).toBe(true);
    });
    it("accepts hyphenated double-barrelled names", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, name: "K. Anand-Kumar" }).success
      ).toBe(true);
    });
    it("accepts Devanagari script for Hindi names", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, name: "रामेश शर्मा" }).success
      ).toBe(true);
    });
    it("rejects digits in name", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, name: "John1" }).success
      ).toBe(false);
    });
    it("rejects @, #, or other symbols", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, name: "John@home" }).success
      ).toBe(false);
    });
    it("rejects email-shaped paste", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, name: "a@b.com" }).success
      ).toBe(false);
    });
  });

  // Issue #103 (Apr 2026): phone regex tightened.
  describe("phone regex", () => {
    it("accepts a 10-digit phone", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, phone: "9876543210" }).success
      ).toBe(true);
    });
    it("accepts a +country-code phone", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, phone: "+919876543210" })
          .success
      ).toBe(true);
    });
    it("rejects 'abc'", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, phone: "abc" }).success
      ).toBe(false);
    });
    it("rejects spaces in phone", () => {
      expect(
        createPatientSchema.safeParse({ ...validPatient, phone: "987 654 3210" })
          .success
      ).toBe(false);
    });
  });
});

describe("updatePatientSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(updatePatientSchema.safeParse({}).success).toBe(true);
  });
  it("accepts a partial update", () => {
    expect(updatePatientSchema.safeParse({ name: "New Name" }).success).toBe(true);
  });
});

describe("mergePatientSchema", () => {
  it("accepts a valid uuid", () => {
    expect(
      mergePatientSchema.safeParse({ otherPatientId: "11111111-1111-1111-1111-111111111111" })
        .success
    ).toBe(true);
  });
  it("rejects non-uuid", () => {
    expect(mergePatientSchema.safeParse({ otherPatientId: "abc" }).success).toBe(false);
  });
});

describe("recordVitalsSchema", () => {
  const valid = {
    appointmentId: "11111111-1111-1111-1111-111111111111",
    patientId: "22222222-2222-2222-2222-222222222222",
  };
  it("accepts minimal vitals", () => {
    expect(recordVitalsSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects out-of-range systolic BP", () => {
    expect(
      recordVitalsSchema.safeParse({ ...valid, bloodPressureSystolic: 999 }).success
    ).toBe(false);
  });
  it("rejects pain scale > 10", () => {
    expect(recordVitalsSchema.safeParse({ ...valid, painScale: 11 }).success).toBe(false);
  });
  it("accepts realistic vitals", () => {
    expect(
      recordVitalsSchema.safeParse({
        ...valid,
        bloodPressureSystolic: 120,
        bloodPressureDiastolic: 80,
        pulseRate: 72,
        spO2: 98,
        temperature: 98.6,
        temperatureUnit: "F",
        weight: 70,
        height: 175,
      }).success
    ).toBe(true);
  });
});
