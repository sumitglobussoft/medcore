import { describe, it, expect } from "vitest";
import { checkRedFlags, buildEmergencyResponse } from "./red-flag";

describe("checkRedFlags — cardiac", () => {
  it("detects chest pain", () => {
    const r = checkRedFlags("I have severe chest pain");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/cardiac/i);
  });

  it("detects chest tightness", () => {
    expect(checkRedFlags("There is chest tightness and sweating").detected).toBe(true);
  });

  it("detects heart attack keyword", () => {
    expect(checkRedFlags("I think I'm having a heart attack").detected).toBe(true);
  });

  it("detects crushing chest", () => {
    expect(checkRedFlags("crushing chest pressure since 20 minutes").detected).toBe(true);
  });

  it("detects jaw pain pattern", () => {
    expect(checkRedFlags("jaw pain radiating to my left arm").detected).toBe(true);
  });
});

describe("checkRedFlags — neurological", () => {
  it("detects stroke keyword", () => {
    const r = checkRedFlags("my husband might be having a stroke");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/stroke/i);
  });

  it("detects slurred speech", () => {
    expect(checkRedFlags("she has slurred speech and can't lift her arm").detected).toBe(true);
  });

  it("detects thunderclap headache", () => {
    const r = checkRedFlags("thunderclap headache started suddenly");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/subarachnoid/i);
  });

  it("detects worst headache", () => {
    expect(checkRedFlags("worst headache of my life right now").detected).toBe(true);
  });

  it("detects seizure", () => {
    const r = checkRedFlags("she had a seizure and fell down");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/seizure/i);
  });

  it("detects convulsion", () => {
    expect(checkRedFlags("the patient is having convulsions").detected).toBe(true);
  });

  it("detects loss of consciousness", () => {
    const r = checkRedFlags("he is unconscious and not responding");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/consciousness/i);
  });

  it("detects unresponsive", () => {
    expect(checkRedFlags("patient is unresponsive on the floor").detected).toBe(true);
  });
});

describe("checkRedFlags — respiratory", () => {
  it("detects can't breathe", () => {
    const r = checkRedFlags("I can't breathe properly");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/respiratory/i);
  });

  it("detects severe breathlessness", () => {
    expect(checkRedFlags("severe breathlessness for last 10 minutes").detected).toBe(true);
  });

  it("detects choking", () => {
    const r = checkRedFlags("my child is choking on food");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/airway/i);
  });
});

describe("checkRedFlags — bleeding", () => {
  it("detects heavy bleeding", () => {
    const r = checkRedFlags("heavy bleeding from wound that won't stop");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/haemorrhage/i);
  });

  it("detects vomiting blood", () => {
    const r = checkRedFlags("patient is vomiting blood since morning");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/haematemesis/i);
  });

  it("detects blood in stool", () => {
    expect(checkRedFlags("blood in stool since yesterday").detected).toBe(true);
  });
});

describe("checkRedFlags — allergic", () => {
  it("detects anaphylaxis", () => {
    const r = checkRedFlags("anaphylaxis after bee sting");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/anaphylaxis/i);
  });

  it("detects throat swelling", () => {
    expect(checkRedFlags("throat swelling after eating nuts").detected).toBe(true);
  });
});

describe("checkRedFlags — mental health", () => {
  it("detects suicidal ideation", () => {
    const r = checkRedFlags("I want to kill myself");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/suicidal/i);
  });

  it("detects want to die", () => {
    expect(checkRedFlags("I want to die, can't take it anymore").detected).toBe(true);
  });

  it("detects self harm", () => {
    expect(checkRedFlags("thoughts of self harm are getting worse").detected).toBe(true);
  });
});

describe("checkRedFlags — Hindi patterns", () => {
  it("detects seene mein dard", () => {
    const r = checkRedFlags("seene mein dard ho raha hai");
    expect(r.detected).toBe(true);
    expect(r.reason).toMatch(/Hindi/i);
  });

  it("detects sans nahi", () => {
    expect(checkRedFlags("sans nahi aa rahi hai").detected).toBe(true);
  });

  it("detects behoshi", () => {
    expect(checkRedFlags("behoshi aa gayi unhe").detected).toBe(true);
  });
});

describe("checkRedFlags — non-emergency", () => {
  it("returns false for mild headache", () => {
    const r = checkRedFlags("I have a mild headache for 2 days");
    expect(r.detected).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it("returns false for common cold", () => {
    expect(checkRedFlags("runny nose and sore throat since yesterday").detected).toBe(false);
  });

  it("returns false for back pain", () => {
    expect(checkRedFlags("lower back pain for 3 weeks, worse in morning").detected).toBe(false);
  });

  it("returns false for fever", () => {
    expect(checkRedFlags("fever of 100.4 F and body ache").detected).toBe(false);
  });

  it("returns false for skin rash", () => {
    expect(checkRedFlags("skin rash on my arm since 2 days").detected).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(checkRedFlags("").detected).toBe(false);
  });
});

describe("checkRedFlags — case insensitivity", () => {
  it("matches uppercase CHEST PAIN", () => {
    expect(checkRedFlags("CHEST PAIN SEVERE").detected).toBe(true);
  });

  it("matches mixed-case Seizure", () => {
    expect(checkRedFlags("Seizure started 5 minutes ago").detected).toBe(true);
  });

  it("matches SUICID prefix", () => {
    expect(checkRedFlags("Suicidal thoughts all day").detected).toBe(true);
  });
});

describe("buildEmergencyResponse", () => {
  it("includes the provided reason", () => {
    const msg = buildEmergencyResponse("Possible acute cardiac event");
    expect(msg).toContain("Possible acute cardiac event");
  });

  it("defaults to 112 when no phone provided", () => {
    const msg = buildEmergencyResponse("stroke");
    expect(msg).toContain("112");
  });

  it("uses the custom hospital phone when provided", () => {
    const msg = buildEmergencyResponse("bleeding", "1800-222-333");
    expect(msg).toContain("1800-222-333");
    expect(msg).not.toContain("112");
  });

  it("contains EMERGENCY alert marker", () => {
    const msg = buildEmergencyResponse("test");
    expect(msg.toUpperCase()).toContain("EMERGENCY");
  });

  it("instructs not to wait for appointment", () => {
    const msg = buildEmergencyResponse("test");
    expect(msg).toContain("Do not wait for an appointment");
  });
});
