// Vitals analysis helper — computes BMI and flags abnormal readings.
// Used by both the Vitals POST route and any other code that creates vitals.

export type VitalsInput = {
  bloodPressureSystolic?: number | null;
  bloodPressureDiastolic?: number | null;
  temperature?: number | null; // value in the unit below
  temperatureUnit?: "F" | "C" | null;
  weight?: number | null; // kg
  height?: number | null; // cm
  pulseRate?: number | null;
  spO2?: number | null;
  respiratoryRate?: number | null;
  painScale?: number | null;
};

export type VitalsAnalysis = {
  bmi: number | null;
  bmiCategory: string | null;
  flags: string[]; // e.g. ["HIGH_BP","LOW_SPO2"]
  critical: string[]; // subset of flags that are critical
  isAbnormal: boolean;
  isCritical: boolean;
};

export function computeVitalsFlags(v: VitalsInput): VitalsAnalysis {
  const flags: string[] = [];
  const critical: string[] = [];

  // BMI
  let bmi: number | null = null;
  let bmiCategory: string | null = null;
  if (v.weight && v.height && v.height > 0) {
    const m = v.height / 100;
    bmi = Math.round((v.weight / (m * m)) * 10) / 10;
    if (bmi < 18.5) bmiCategory = "Underweight";
    else if (bmi < 25) bmiCategory = "Normal";
    else if (bmi < 30) bmiCategory = "Overweight";
    else bmiCategory = "Obese";
    if (bmi < 16 || bmi >= 35) flags.push("ABNORMAL_BMI");
  }

  // Blood pressure
  const sys = v.bloodPressureSystolic;
  const dia = v.bloodPressureDiastolic;
  if (sys != null && sys >= 180) {
    flags.push("HYPERTENSIVE_CRISIS");
    critical.push("HYPERTENSIVE_CRISIS");
  } else if (sys != null && sys >= 140) {
    flags.push("HIGH_BP");
  } else if (sys != null && sys < 90) {
    flags.push("LOW_BP");
    if (sys < 80) critical.push("LOW_BP");
  }
  if (dia != null && dia >= 120) {
    if (!flags.includes("HYPERTENSIVE_CRISIS")) flags.push("HYPERTENSIVE_CRISIS");
    critical.push("HYPERTENSIVE_CRISIS");
  } else if (dia != null && dia >= 90) {
    if (!flags.includes("HIGH_BP")) flags.push("HIGH_BP");
  }

  // SpO2
  if (v.spO2 != null) {
    if (v.spO2 < 90) {
      flags.push("LOW_SPO2");
      critical.push("LOW_SPO2");
    } else if (v.spO2 < 95) {
      flags.push("LOW_SPO2");
    }
  }

  // Pulse rate
  if (v.pulseRate != null) {
    if (v.pulseRate > 130) {
      flags.push("TACHYCARDIA");
      critical.push("TACHYCARDIA");
    } else if (v.pulseRate > 100) flags.push("TACHYCARDIA");
    if (v.pulseRate < 50) {
      flags.push("BRADYCARDIA");
      if (v.pulseRate < 40) critical.push("BRADYCARDIA");
    }
  }

  // Temperature — normalise to Fahrenheit for comparison
  let tempF: number | null = null;
  if (v.temperature != null) {
    tempF =
      (v.temperatureUnit ?? "F") === "C"
        ? v.temperature * 9 / 5 + 32
        : v.temperature;
    if (tempF >= 103) {
      flags.push("HIGH_FEVER");
      critical.push("HIGH_FEVER");
    } else if (tempF >= 100.4) flags.push("FEVER");
    else if (tempF < 95) {
      flags.push("HYPOTHERMIA");
      critical.push("HYPOTHERMIA");
    }
  }

  // Respiratory rate
  if (v.respiratoryRate != null) {
    if (v.respiratoryRate > 24) flags.push("TACHYPNEA");
    if (v.respiratoryRate < 10) {
      flags.push("BRADYPNEA");
      critical.push("BRADYPNEA");
    }
  }

  // Pain scale
  if (v.painScale != null && v.painScale >= 7) flags.push("SEVERE_PAIN");

  return {
    bmi,
    bmiCategory,
    flags,
    critical,
    isAbnormal: flags.length > 0,
    isCritical: critical.length > 0,
  };
}

/**
 * Extended analysis that also compares values against a patient's personal
 * baseline. Values deviating by more than 20% from baseline are flagged with
 * "SIGNIFICANT_CHANGE_FROM_BASELINE".
 */
export function computeVitalsFlagsWithBaseline(
  v: VitalsInput,
  baseline: {
    bpSystolic?: { baseline: number | null } | null;
    bpDiastolic?: { baseline: number | null } | null;
    pulse?: { baseline: number | null } | null;
    spO2?: { baseline: number | null } | null;
  } | null
): VitalsAnalysis & { baselineDeviations: string[] } {
  const base = computeVitalsFlags(v);
  const deviations: string[] = [];

  function check(
    label: string,
    value: number | null | undefined,
    b: number | null | undefined
  ) {
    if (
      typeof value === "number" &&
      typeof b === "number" &&
      b !== 0 &&
      Math.abs((value - b) / b) > 0.2
    ) {
      deviations.push(label);
    }
  }

  if (baseline) {
    check("bpSystolic", v.bloodPressureSystolic, baseline.bpSystolic?.baseline);
    check(
      "bpDiastolic",
      v.bloodPressureDiastolic,
      baseline.bpDiastolic?.baseline
    );
    check("pulse", v.pulseRate, baseline.pulse?.baseline);
    check("spO2", v.spO2, baseline.spO2?.baseline);
  }

  const flags = [...base.flags];
  if (deviations.length > 0 && !flags.includes("SIGNIFICANT_CHANGE_FROM_BASELINE")) {
    flags.push("SIGNIFICANT_CHANGE_FROM_BASELINE");
  }

  return {
    ...base,
    flags,
    isAbnormal: flags.length > 0,
    baselineDeviations: deviations,
  };
}
